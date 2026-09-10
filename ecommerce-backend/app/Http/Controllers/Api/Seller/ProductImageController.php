<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Http\Requests\Seller\StoreProductImageRequest;
use App\Models\Product;
use App\Models\ProductImage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class ProductImageController extends Controller
{
    /**
     * Product photos are PUBLIC on purpose — buyers browsing need to see
     * them without logging in, unlike IDs/permits which are deliberately
     * private (see README "Document privacy"). Different disk, different
     * threat model: there's nothing sensitive about a photo of a product
     * for sale, and gating it behind a signed URL would just break every
     * <img> tag on the storefront for no security benefit.
     */
    public function store(StoreProductImageRequest $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        $path = $request->file('image')->store('products', 'public');
        $nextSort = $product->images()->max('sort_order') + 1;

        $image = $product->images()->create([
            'path' => $path,
            'sort_order' => $nextSort,
        ]);

        return response()->json([
            'message' => 'Image uploaded.',
            'image' => ['id' => $image->id, 'url' => Storage::disk('public')->url($path), 'sort_order' => $image->sort_order],
        ], 201);
    }

    /**
     * Kept separate from the general ProductResource conversion above:
     * a real upload through this endpoint always produces a local
     * relative path from Storage::store(), so Storage::disk('public')->url()
     * is always correct here — no need for the "already a full URL" check
     * ProductResource has to make for seeded/demo image data.
     */

    public function destroy(Request $request, Product $product, ProductImage $image): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        if ($image->product_id !== $product->id) {
            abort(404, 'This image does not belong to this product.');
        }

        Storage::disk('public')->delete($image->path);
        $image->delete();

        return response()->json(['message' => 'Image removed.']);
    }

    /**
     * Reorders this product's photos. Body: { order: [imageId, imageId, ...] }
     * — every id must belong to this product. The first id in the list
     * becomes the cover photo (sort_order 0), shown as the catalog/storefront
     * thumbnail; the rest follow in the order given.
     */
    public function reorder(Request $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        $ownedIds = $product->images()->pluck('id');

        $validated = $request->validate([
            'order' => ['required', 'array', 'size:' . $ownedIds->count()],
            'order.*' => ['integer', Rule::in($ownedIds->all())],
        ]);

        // Every owned id must appear exactly once — catches duplicates that
        // 'size' + 'in' alone wouldn't (e.g. the same id sent twice).
        if ($ownedIds->diff($validated['order'])->isNotEmpty()) {
            abort(422, 'The photo order must include every existing photo exactly once.');
        }

        foreach ($validated['order'] as $index => $imageId) {
            ProductImage::where('id', $imageId)->update(['sort_order' => $index]);
        }

        return response()->json([
            'message' => 'Photo order updated.',
            'images' => $product->images()->get()->values()->map(fn ($img, $i) => [
                'id' => $img->id,
                'url' => $img->url,
                'sort_order' => $img->sort_order,
                'is_cover' => $i === 0,
            ]),
        ]);
    }

    protected function ensureOwnedBySeller(Request $request, Product $product): void
    {
        if ($product->seller_id !== $request->user()->seller->id) {
            abort(403, 'You can only manage your own products.');
        }
    }
}
