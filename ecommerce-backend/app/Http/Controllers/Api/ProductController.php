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

        return response()->json([
            'data' => ProductResource::collection($query->latest()->paginate(24)),
        ]);
    }

    public function show(Product $product): JsonResponse
    {
        return response()->json([
            'product' => new ProductResource($product->load(['category', 'seller', 'variations', 'images'])),
        ]);
    }
}
