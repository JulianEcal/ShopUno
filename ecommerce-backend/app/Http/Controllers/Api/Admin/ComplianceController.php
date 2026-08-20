<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ProductFlagActionRequest;
use App\Http\Resources\ProductResource;
use App\Mail\ProductComplianceNotice;
use App\Models\Product;
use App\Models\ProductFlag;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;

class ComplianceController extends Controller
{
    /**
     * GET /admin/compliance/products?flagged=1&category=&search=
     *
     * Deliberately no automated category-matching — an admin reads the
     * seller's registered line_of_business against the product's category
     * and decides. See README for why this is manual, not a classifier.
     */
    public function index(Request $request): JsonResponse
    {
        $query = Product::query()
            ->active()
            ->with(['category', 'seller', 'flags' => fn ($q) => $q->latest()->limit(1)]);

        if ($category = $request->query('category')) {
            $query->where('category_id', $category);
        }

        if ($search = $request->query('search')) {
            $query->where('name', 'like', "%{$search}%");
        }

        $products = $query->latest()->paginate(20);

        if ($request->boolean('flagged')) {
            $products->setCollection(
                $products->getCollection()->filter(fn ($p) => $p->isCurrentlyFlagged())->values()
            );
        }

        return response()->json(['data' => ProductResource::collection($products)]);
    }

    public function show(Product $product): JsonResponse
    {
        return response()->json([
            'product' => new ProductResource($product->load(['category', 'seller.user'])),
            'flag_history' => $product->flags()->with('admin:id,first_name,last_name')->latest()->get(),
        ]);
    }

    public function flag(ProductFlagActionRequest $request, Product $product): JsonResponse
    {
        $this->recordAndNotify($request, $product, 'flag');

        return response()->json(['message' => 'Product flagged for review.']);
    }

    public function resolve(ProductFlagActionRequest $request, Product $product): JsonResponse
    {
        $this->recordAndNotify($request, $product, 'resolve');

        return response()->json(['message' => 'Flag resolved.']);
    }

    /** Force-removes the listing — used for confirmed prohibited/violating products. */
    public function archive(ProductFlagActionRequest $request, Product $product): JsonResponse
    {
        $product->update(['is_archived' => true]);

        $this->recordAndNotify($request, $product, 'archive');

        return response()->json(['message' => 'Product archived.']);
    }

    protected function recordAndNotify(ProductFlagActionRequest $request, Product $product, string $type): void
    {
        $note = $request->validated('note');

        ProductFlag::create([
            'product_id' => $product->id,
            'admin_id' => $request->user()->id,
            'type' => $type,
            'note' => $note,
        ]);

        $product->loadMissing('seller.user');
        Mail::to($product->seller->user->email)->send(new ProductComplianceNotice($product, $type, $note));
    }
}
