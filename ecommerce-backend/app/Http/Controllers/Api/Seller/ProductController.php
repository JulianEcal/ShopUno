<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Http\Requests\Seller\StoreProductRequest;
use App\Http\Requests\Seller\UpdateProductRequest;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    /** GET /seller/products — the authenticated seller's own inventory, including archived. */
    public function index(Request $request): JsonResponse
    {
        $products = $request->user()->seller
            ->products()
            ->with('category')
            ->latest()
            ->paginate(20);

        return response()->json(['data' => ProductResource::collection($products)]);
    }

    public function store(StoreProductRequest $request): JsonResponse
    {
        $product = $request->user()->seller->products()->create($request->validated());

        return response()->json([
            'message' => 'Product created.',
            'product' => new ProductResource($product->load('category')),
        ], 201);
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

    /** Archives rather than hard-deletes — past orders may still reference this product. */
    public function destroy(Request $request, Product $product): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $product);

        $product->update(['is_archived' => true]);

        return response()->json(['message' => 'Product archived.']);
    }

    protected function ensureOwnedBySeller(Request $request, Product $product): void
    {
        if ($product->seller_id !== $request->user()->seller->id) {
            abort(403, 'You can only manage your own products.');
        }
    }
}
