<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Http\Requests\Seller\UpdateProductVariationRequest;
use App\Models\Product;
use App\Models\ProductVariation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Editing for a single generated combination row (its price adjustment,
 * stock, SKU, and photo). Sellers no longer create variations by hand —
 * see Seller\ProductOptionController, which generates one row per
 * combination of option values and keeps them in sync automatically.
 */
class ProductVariationController extends Controller
{
    public function update(UpdateProductVariationRequest $request, Product $product, ProductVariation $variation): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);
        $this->ensureBelongsToProduct($product, $variation);

        $variation->update($request->validated());
        $product->syncStockFromVariations();

        return response()->json(['message' => 'Variation updated.', 'variation' => $this->present($variation->fresh())]);
    }

    /**
     * Saves every combination row's price/stock/sku in one request — the
     * seller's combo grid has one input per cell and posts them all at once
     * instead of one HTTP call per row.
     */
    public function bulkUpdate(Request $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        $data = $request->validate([
            'variations' => ['required', 'array', 'min:1'],
            'variations.*.id' => ['required', 'integer'],
            'variations.*.price_adjustment' => ['nullable', 'numeric'],
            'variations.*.stock' => ['required', 'integer', 'min:0'],
            'variations.*.sku' => ['nullable', 'string', 'max:100'],
        ]);

        $ids = collect($data['variations'])->pluck('id');
        $owned = $product->variations()->whereIn('id', $ids)->get()->keyBy('id');

        foreach ($data['variations'] as $row) {
            $variation = $owned->get($row['id']);
            if (! $variation) {
                continue; // silently skip rows that don't belong to this product
            }
            $variation->update([
                'price_adjustment' => $row['price_adjustment'] ?? 0,
                'stock' => $row['stock'],
                'sku' => $row['sku'] ?? null,
            ]);
        }

        $product->syncStockFromVariations();

        return response()->json([
            'message' => 'Stock and pricing saved.',
            'product' => (new \App\Http\Resources\ProductResource(
                $product->fresh(['category', 'images', 'variations', 'options'])
            ))->resolve(),
        ]);
    }

    /**
     * Shapes a variation for the frontend, including its linked photo (if
     * any) — matches the shape ProductResource uses for the show() payload
     * so the seller UI can treat both responses the same way.
     */
    protected function present(ProductVariation $variation): array
    {
        $variation->loadMissing(['image', 'optionValue1.option', 'optionValue2.option']);
        $image = $variation->effectiveImage();

        return [
            'id' => $variation->id,
            'option_value_1_id' => $variation->option_value_1_id,
            'option_value_2_id' => $variation->option_value_2_id,
            'label' => $variation->value,
            'sku' => $variation->sku,
            'price_adjustment' => (float) $variation->price_adjustment,
            'stock' => $variation->stock,
            'image_id' => $variation->product_image_id,
            'image' => $image ? ['id' => $image->id, 'url' => $image->url] : null,
        ];
    }

    /**
     * Hard delete is fine here (unlike products, which archive) — cart/order
     * items reference product_variation_id with nullOnDelete, so removing a
     * variation never breaks a past order's financial record (product_name
     * and unit_price are already snapshotted there); it just stops showing
     * which specific variation was ordered.
     *
     * Note: deleting a combo row directly is discouraged from the UI now —
     * removing an option *value* (Seller\ProductOptionController) is the
     * normal way to retire a combination, since editing values later would
     * otherwise silently regenerate this row. Kept for API completeness.
     */
    public function destroy(Request $request, Product $product, ProductVariation $variation): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);
        $this->ensureBelongsToProduct($product, $variation);

        $variation->delete();
        $product->syncStockFromVariations();

        return response()->json(['message' => 'Variation removed.']);
    }

    protected function ensureOwnedBySeller(Request $request, Product $product): void
    {
        if ($product->seller_id !== $request->user()->seller->id) {
            abort(403, 'You can only manage your own products.');
        }
    }

    protected function ensureBelongsToProduct(Product $product, ProductVariation $variation): void
    {
        if ($variation->product_id !== $product->id) {
            abort(404, 'This variation does not belong to this product.');
        }
    }
}
