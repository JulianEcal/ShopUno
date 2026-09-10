<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\ProductResource;
use App\Models\Category;
use App\Models\Product;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProductController extends Controller
{
    /** GET /products?category=&search=&seller_id= */
    public function index(Request $request): JsonResponse
    {
        $query = Product::query()
            ->active()
            ->published()
            ->with(['category', 'seller', 'images'])
            ->whereHas('seller.user', fn ($q) => $q->where('status', 'active'));

        if ($category = $request->query('category')) {
            $query->where('category_id', $category);
        }

        if ($sellerId = $request->query('seller_id')) {
            $query->where('seller_id', $sellerId);
        }

        if ($search = $request->query('search')) {
            $query->where('name', 'like', "%{$search}%");
        }

        $products = $query->latest()->paginate(24);

        return $this->paginatedResponse(ProductResource::collection($products), $products);
    }

    public function show(Product $product): JsonResponse
    {
        // Same rule as the catalog listing above, just enforced again here
        // since this route is reachable directly by product id — a draft or
        // archived product's page shouldn't be viewable just because a buyer
        // (or a search engine) has the URL.
        abort_unless($product->is_published && ! $product->is_archived, 404);

        return response()->json([
            'product' => new ProductResource($product->load(['category', 'seller', 'options', 'variations', 'images'])),
        ]);
    }
}
