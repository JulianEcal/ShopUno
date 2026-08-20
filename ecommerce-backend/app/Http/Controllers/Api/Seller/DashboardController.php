<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductFlag;
use App\Models\Rating;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    /** Products at or below this stock level are surfaced as "low stock". */
    protected const LOW_STOCK_THRESHOLD = 5;

    /**
     * GET /seller/dashboard
     * Same shape as GET /admin/dashboard (counts / needs_attention /
     * recent_activity) so the two screens feel like one family — but every
     * number here is scoped to just this seller's own store.
     */
    public function index(Request $request): JsonResponse
    {
        $seller = $request->user()->seller;
        $orders = $seller->orders();

        $lowStockCount = $seller->products()->active()
            ->where('stock', '<=', self::LOW_STOCK_THRESHOLD)->count();

        $flaggedCount = $this->currentlyFlaggedProductCount($seller->id);

        return response()->json([
            'counts' => [
                'orders_today' => (clone $orders)->whereDate('created_at', today())->count(),
                'orders_this_week' => (clone $orders)->where('created_at', '>=', now()->startOfWeek())->count(),
                'pending_orders' => (clone $orders)->where('status', 'to_ship')->count(),
                'in_progress_orders' => (clone $orders)->whereIn('status', ['in_transit', 'out_for_delivery'])->count(),
                'total_products' => $seller->products()->active()->count(),
                'low_stock_products' => $lowStockCount,
                'flagged_products' => $flaggedCount,
                'average_rating' => $seller->averageRating(),
            ],

            'needs_attention' => array_filter([
                'pending_orders' => (clone $orders)->where('status', 'to_ship')->count(),
                'low_stock_products' => $lowStockCount,
                'flagged_products' => $flaggedCount,
            ], fn ($count) => $count > 0),

            'recent_activity' => $this->recentActivity($seller),
        ]);
    }

    /** Same "latest flag entry per product is still 'flag'" logic as admin Compliance, scoped to one seller. */
    protected function currentlyFlaggedProductCount(int $sellerId): int
    {
        $productIds = Product::where('seller_id', $sellerId)->pluck('id');

        if ($productIds->isEmpty()) {
            return 0;
        }

        $latestFlagIds = ProductFlag::whereIn('product_id', $productIds)
            ->selectRaw('MAX(id) as id')->groupBy('product_id');

        return ProductFlag::whereIn('id', $latestFlagIds)->where('type', 'flag')->count();
    }

    /** Last 5 new orders + last 5 ratings received, merged and sorted — a seller's "what happened lately" feed. */
    protected function recentActivity($seller): array
    {
        $orders = $seller->orders()->with('buyer:id,first_name,last_name')
            ->latest()->limit(5)->get()
            ->map(fn ($order) => [
                'type' => 'order',
                'summary' => "New order from {$order->buyer->first_name} {$order->buyer->last_name} — ₱" . number_format($order->total, 2),
                'created_at' => $order->created_at,
            ]);

        $ratings = Rating::where('rated_user_id', $seller->user_id)
            ->with('ratedBy:id,first_name,last_name')
            ->latest()->limit(5)->get()
            ->map(fn ($rating) => [
                'type' => 'rating',
                'summary' => "{$rating->ratedBy->first_name} {$rating->ratedBy->last_name} left a {$rating->score}-star rating",
                'created_at' => $rating->created_at,
            ]);

        return $orders->concat($ratings)
            ->sortByDesc('created_at')
            ->take(10)
            ->values()
            ->map(fn ($item) => [...$item, 'created_at' => $item['created_at']?->toIso8601String()])
            ->all();
    }
}
