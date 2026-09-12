<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\ProductOptionValue;
use App\Models\ProductVariation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Manages a product's Shopee-style option groups (e.g. "Style", "Size")
 * and the values under each (e.g. "S", "M", "L"). Every create/rename/
 * delete here calls regenerateCombinations(), which keeps ProductVariation
 * rows in sync with the current cross-product of option values — sellers
 * never create a "variation" directly, they just manage options/values and
 * the buyable combinations (with their own price + stock) are generated
 * and pruned automatically.
 */
class ProductOptionController extends Controller
{
    /** Shopee caps sellers at two option groups per product; matched here. */
    const MAX_OPTIONS = 2;

    public function storeOption(Request $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        if ($product->options()->count() >= self::MAX_OPTIONS) {
            return response()->json(['message' => 'A product can have at most 2 option groups (e.g. Style and Size).'], 422);
        }

        $data = $request->validate([
            'name' => [
                'required', 'string', 'max:50',
                Rule::unique('product_options', 'name')->where('product_id', $product->id),
            ],
        ], [
            'name.unique' => 'This product already has an option group with that name.',
        ]);

        $option = $product->options()->create([
            'name' => $data['name'],
            'position' => $product->options()->count(),
        ]);

        return response()->json(['message' => 'Option group added.', 'product' => $this->reload($product)], 201);
    }

    public function updateOption(Request $request, Product $product, ProductOption $option): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);
        $this->ensureOptionBelongsToProduct($product, $option);

        $data = $request->validate([
            'name' => [
                'required', 'string', 'max:50',
                Rule::unique('product_options', 'name')->where('product_id', $product->id)->ignore($option->id),
            ],
        ]);

        $option->update($data);

        return response()->json(['message' => 'Option group renamed.', 'product' => $this->reload($product)]);
    }

    /** Deleting an option cascades to its values, which cascades to any combination rows that used them. */
    public function destroyOption(Request $request, Product $product, ProductOption $option): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);
        $this->ensureOptionBelongsToProduct($product, $option);

        $option->delete();
        $this->reorderOptions($product);
        $this->regenerateCombinations($product->fresh());

        return response()->json(['message' => 'Option group removed.', 'product' => $this->reload($product)]);
    }

    public function storeValue(Request $request, Product $product, ProductOption $option): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);
        $this->ensureOptionBelongsToProduct($product, $option);

        $data = $request->validate([
            'value' => [
                'required', 'string', 'max:100',
                Rule::unique('product_option_values', 'value')->where('product_option_id', $option->id),
            ],
            'image_id' => [
                'nullable', 'integer',
                Rule::exists('product_images', 'id')->where('product_id', $product->id),
            ],
        ], [
            'value.unique' => 'This option already has that value.',
        ]);

        $option->values()->create([
            'value' => $data['value'],
            'position' => $option->values()->count(),
            'product_image_id' => $data['image_id'] ?? null,
        ]);

        $this->regenerateCombinations($product->fresh());

        return response()->json(['message' => 'Value added.', 'product' => $this->reload($product)], 201);
    }

    public function updateValue(Request $request, Product $product, ProductOption $option, ProductOptionValue $value): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);
        $this->ensureOptionBelongsToProduct($product, $option);
        $this->ensureValueBelongsToOption($option, $value);

        $data = $request->validate([
            'value' => [
                'sometimes', 'string', 'max:100',
                Rule::unique('product_option_values', 'value')->where('product_option_id', $option->id)->ignore($value->id),
            ],
            'image_id' => [
                'sometimes', 'nullable', 'integer',
                Rule::exists('product_images', 'id')->where('product_id', $product->id),
            ],
        ]);

        if (array_key_exists('image_id', $data)) {
            $data['product_image_id'] = $data['image_id'];
            unset($data['image_id']);
        }

        $value->update($data);

        return response()->json(['message' => 'Value updated.', 'product' => $this->reload($product)]);
    }

    /** Deleting a value cascades to any combination row that used it (see the FK on product_variations). */
    public function destroyValue(Request $request, Product $product, ProductOption $option, ProductOptionValue $value): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);
        $this->ensureOptionBelongsToProduct($product, $option);
        $this->ensureValueBelongsToOption($option, $value);

        $value->delete();
        $product->fresh()->syncStockFromVariations();

        return response()->json(['message' => 'Value removed.', 'product' => $this->reload($product)]);
    }

    /**
     * Regenerates ProductVariation rows so there's exactly one per
     * combination of the product's current option values — a straight
     * cross-product of group 1's values × group 2's values (or just group
     * 1 alone, if there's only one option group). New combinations start
     * at stock 0 / +₱0 so the seller notices and fills them in; existing
     * combinations that are still valid keep their price/stock untouched;
     * combinations that are no longer possible (a value got renamed away
     * or removed) are deleted.
     */
    protected function regenerateCombinations(Product $product): void
    {
        $options = $product->options()->get();

        if ($options->isEmpty()) {
            // No option groups left — this product sells as a single item again.
            $product->variations()->delete();
            $product->syncStockFromVariations();

            return;
        }

        $axis1 = $options[0]->values;
        $axis2 = $options[1]->values ?? collect();

        $desiredPairs = $axis2->isEmpty()
            ? $axis1->map(fn ($v1) => [$v1->id, null])
            : $axis1->crossJoin($axis2)->map(fn ($pair) => [$pair[0]->id, $pair[1]->id]);

        $pairKey = fn ($a, $b) => $a.':'.($b ?? '-');
        $desiredKeys = $desiredPairs->map(fn ($p) => $pairKey($p[0], $p[1]))->all();

        $existing = $product->variations()->get()->keyBy(fn ($v) => $pairKey($v->option_value_1_id, $v->option_value_2_id));

        DB::transaction(function () use ($product, $desiredPairs, $existing, $pairKey, $desiredKeys) {
            foreach ($desiredPairs as [$id1, $id2]) {
                if ($existing->has($pairKey($id1, $id2))) {
                    continue;
                }

                $product->variations()->create([
                    'option_value_1_id' => $id1,
                    'option_value_2_id' => $id2,
                    'variation_type' => 'options',
                    'value' => $this->comboLabel($id1, $id2),
                    'price_adjustment' => 0,
                    'stock' => 0,
                ]);
            }

            foreach ($existing as $key => $variation) {
                if (! in_array($key, $desiredKeys, true)) {
                    $variation->delete();
                }
            }
        });

        $product->syncStockFromVariations();
    }

    protected function comboLabel(?int $id1, ?int $id2): string
    {
        $labels = array_filter([
            $id1 ? ProductOptionValue::find($id1)?->value : null,
            $id2 ? ProductOptionValue::find($id2)?->value : null,
        ]);

        return implode(' / ', $labels) ?: 'Default';
    }

    protected function reorderOptions(Product $product): void
    {
        $product->options()->orderBy('position')->get()->values()
            ->each(fn ($option, $i) => $option->update(['position' => $i]));
    }

    protected function reload(Product $product): array
    {
        $product = $product->fresh(['category', 'images', 'variations', 'options']);

        return (new \App\Http\Resources\ProductResource($product))->resolve();
    }

    protected function ensureOwnedBySeller(Request $request, Product $product): void
    {
        if ($product->seller_id !== $request->user()->seller->id) {
            abort(403, 'You can only manage your own products.');
        }
    }

    protected function ensureOptionBelongsToProduct(Product $product, ProductOption $option): void
    {
        if ($option->product_id !== $product->id) {
            abort(404, 'This option group does not belong to this product.');
        }
    }

    protected function ensureValueBelongsToOption(ProductOption $option, ProductOptionValue $value): void
    {
        if ($value->product_option_id !== $option->id) {
            abort(404, 'This value does not belong to this option group.');
        }
    }
}
