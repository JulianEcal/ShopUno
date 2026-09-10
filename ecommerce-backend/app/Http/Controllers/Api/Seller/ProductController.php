<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Http\Requests\Seller\StoreProductRequest;
use App\Http\Requests\Seller\UpdateProductDiscountRequest;
use App\Http\Requests\Seller\UpdateProductRequest;
use App\Http\Resources\ProductResource;
use App\Models\OrderItem;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    /**
     * GET /seller/products?search=&category=&stock=low|out&status=active|archived
     * The authenticated seller's own inventory, including archived. Filters
     * are optional — an unfiltered call still returns everything, newest
     * first, same as before.
     */
    public function index(Request $request): JsonResponse
    {
        $query = $request->user()->seller
            ->products()
            ->with(['category', 'images']);

        if ($status = $request->query('status')) {
            if ($status === 'archived') {
                $query->where('is_archived', true);
            } elseif ($status === 'draft') {
                $query->where('is_archived', false)->where('is_published', false);
            } elseif ($status === 'live') {
                $query->where('is_archived', false)->where('is_published', true);
            }
        }

        if ($search = $request->query('search')) {
            $query->where('name', 'like', "%{$search}%");
        }

        if ($category = $request->query('category')) {
            $query->where('category_id', $category);
        }

        // Applied before paginate() on purpose, same reasoning as
        // Admin\ComplianceController::index() — filtering a Collection
        // after paginate() leaves the pagination metadata (total, last_page)
        // describing the unfiltered set.
        if ($stock = $request->query('stock')) {
            if ($stock === 'low') {
                $query->where('stock', '>', 0)->where('stock', '<=', 5);
            } elseif ($stock === 'out') {
                $query->where('stock', '<=', 0);
            }
        }

        // Same "latest flag entry is still 'flag'" scope Admin\ComplianceController
        // and DashboardController::currentlyFlaggedProductCount() use — kept as a
        // dedicated query-level scope (see Product::scopeCurrentlyFlagged) so it
        // composes safely with paginate().
        if ($request->boolean('flagged')) {
            $query->currentlyFlagged();
        }

        $products = $query->latest()->paginate(20);

        return $this->paginatedResponse(ProductResource::collection($products), $products);
    }

    public function show(Request $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        return response()->json([
            'product' => new ProductResource($product->load(['category', 'images', 'variations', 'options'])),
        ]);
    }

    public function store(StoreProductRequest $request): JsonResponse
    {
        // Stock isn't collected on the create form anymore — it's set per
        // variation (or, for a product with no variations, directly on the
        // Variations tab) right after the product exists.
        //
        // is_published is always forced to false here, regardless of
        // anything in the request body — StoreProductRequest doesn't even
        // validate that field, so $request->validated() can never carry it
        // through. A brand-new product stays a private draft until the
        // seller explicitly hits "Publish" (see publish() below); there's
        // no admin-approval step in between.
        $product = $request->user()->seller->products()->create([
            ...$request->validated(),
            'stock' => $request->validated('stock', 0),
            'is_published' => false,
        ]);

        return response()->json([
            'message' => 'Product created.',
            'product' => new ProductResource($product->load('category')),
        ], 201);
    }

    /**
     * POST /seller/products/{product}/publish
     * Makes a draft listing live — the seller's own call, no admin review.
     * A light readiness check mirrors what the "Add a product" wizard's
     * Review step already checks client-side, so a listing can't be forced
     * live completely empty via a direct API call either.
     */
    public function publish(Request $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        if ($product->is_archived) {
            abort(422, "This product is archived — restore it before publishing.");
        }

        if ($product->is_published) {
            return response()->json([
                'message' => 'Already published.',
                'product' => new ProductResource($product->load(['category', 'images', 'variations', 'options'])),
            ]);
        }

        if ($product->images()->doesntExist()) {
            abort(422, 'Add at least one photo before publishing.');
        }

        $hasStock = $product->variations()->exists()
            ? $product->variations()->where('stock', '>', 0)->exists()
            : $product->stock > 0;

        if (! $hasStock) {
            abort(422, 'Set stock above 0 somewhere before publishing.');
        }

        $product->update([
            'is_published' => true,
            'published_at' => $product->published_at ?? now(),
        ]);

        return response()->json([
            'message' => 'Product published.',
            'product' => new ProductResource($product->fresh(['category', 'images', 'variations', 'options'])),
        ]);
    }

    public function update(UpdateProductRequest $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        $product->update($request->validated());

        return response()->json([
            'message' => 'Product updated.',
            'product' => new ProductResource($product->fresh('category')),
        ]);
    }

    /**
     * PATCH /seller/products/{product}/discount
     * Sets (or replaces) this product's discount. Deliberately a separate
     * endpoint from update() rather than fields on the general edit form —
     * mirrors publish()/restore() as its own focused action with its own
     * validation, and lets the seller console offer a dedicated "Set a
     * discount" panel (like Shopee's own Product Discount tool) instead of
     * burying it in the basic details form.
     */
    public function setDiscount(UpdateProductDiscountRequest $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        $data = $request->validated();

        // A fixed-amount discount can't wipe out (or exceed) the cheapest
        // thing a buyer could actually pay for this product — checked
        // against variation prices too, not just base_price, since a
        // variation can be priced below base via a negative adjustment.
        if ($data['discount_type'] === 'fixed') {
            $lowestPrice = $product->variations()->exists()
                ? (float) $product->base_price + (float) $product->variations()->min('price_adjustment')
                : (float) $product->base_price;

            if ((float) $data['discount_value'] >= $lowestPrice) {
                abort(422, "That's too much off — this product's lowest price is ".number_format($lowestPrice, 2).", so a fixed discount has to be less than that.");
            }
        }

        $product->update([
            'discount_type' => $data['discount_type'],
            'discount_value' => $data['discount_value'],
            'discount_starts_at' => $data['discount_starts_at'] ?? null,
            'discount_ends_at' => $data['discount_ends_at'] ?? null,
            'discount_is_active' => $data['discount_is_active'] ?? true,
        ]);

        return response()->json([
            'message' => 'Discount saved.',
            'product' => new ProductResource($product->fresh(['category', 'variations'])),
        ]);
    }

    /**
     * PATCH /seller/products/{product}/discount/pause
     * PATCH /seller/products/{product}/discount/resume
     * Toggles discount_is_active without touching the configured type/
     * value/schedule — the "temporarily take this deal down" action that's
     * cheaper than deleting and re-entering a discount later.
     */
    public function pauseDiscount(Request $request, Product $product): JsonResponse
    {
        return $this->toggleDiscountActive($request, $product, false);
    }

    public function resumeDiscount(Request $request, Product $product): JsonResponse
    {
        return $this->toggleDiscountActive($request, $product, true);
    }

    protected function toggleDiscountActive(Request $request, Product $product, bool $active): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        if (! $product->hasDiscountConfigured()) {
            abort(422, 'This product doesn\'t have a discount set up yet.');
        }

        $product->update(['discount_is_active' => $active]);

        return response()->json([
            'message' => $active ? 'Discount resumed.' : 'Discount paused.',
            'product' => new ProductResource($product->fresh(['category', 'variations'])),
        ]);
    }

    /**
     * DELETE /seller/products/{product}/discount
     * Removes the discount entirely, reverting the product straight back
     * to base_price. Distinct from pause: this clears the numbers instead
     * of just switching them off.
     */
    public function removeDiscount(Request $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        $product->update([
            'discount_type' => null,
            'discount_value' => null,
            'discount_starts_at' => null,
            'discount_ends_at' => null,
            'discount_is_active' => true,
        ]);

        return response()->json([
            'message' => 'Discount removed.',
            'product' => new ProductResource($product->fresh(['category', 'variations'])),
        ]);
    }

    /** Archives rather than hard-deletes — past orders may still reference this product. */
    public function destroy(Request $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        $product->update(['is_archived' => true]);

        return response()->json(['message' => 'Product archived.']);
    }

    /** Un-archives a listing, putting it back in front of buyers. */
    public function restore(Request $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        $product->update(['is_archived' => false]);

        return response()->json([
            'message' => 'Product restored.',
            'product' => new ProductResource($product->fresh('category')),
        ]);
    }

    /**
     * Permanently removes an already-archived product. Two safeguards:
     * (1) it has to be archived first — no skipping straight from "live"
     * to "gone forever" — and (2) it can never have actually been ordered,
     * since order_items.product_id is a restrict-on-delete foreign key at
     * the database level specifically so a sale's record can't vanish out
     * from under it. That second check exists purely to turn what would
     * otherwise be a raw database constraint error into a clear message.
     * Everything else the product owns — photos, options, option values,
     * generated combinations, and any flags — cascades away with it.
     */
    public function forceDestroy(Request $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        if (! $product->is_archived) {
            abort(422, 'Archive this product first, then you can delete it permanently.');
        }

        if (OrderItem::where('product_id', $product->id)->exists()) {
            abort(422, "This product has been ordered before, so it can't be permanently deleted — that order history depends on it. It'll stay archived and hidden from your storefront instead.");
        }

        $product->delete();

        return response()->json(['message' => 'Product permanently deleted.']);
    }

    protected function ensureOwnedBySeller(Request $request, Product $product): void
    {
        if ($product->seller_id !== $request->user()->seller->id) {
            abort(403, 'You can only manage your own products.');
        }
    }
}
