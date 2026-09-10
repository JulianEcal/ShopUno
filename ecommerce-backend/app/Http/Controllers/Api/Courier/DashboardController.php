<?php

namespace App\Http\Controllers\Api\Courier;

use App\Http\Controllers\Controller;
use App\Models\Delivery;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    /**
     * GET /courier/dashboard
     * Same counts/recent_activity shape as the admin and seller dashboards.
     * Earnings are computed on the fly from config('delivery.flat_fee_per_delivery')
     * — see config/delivery.php for why nothing is stored per-delivery.
     */
    public function index(Request $request): JsonResponse
    {
        $courier = $request->user()->courier;
        $fee = config('delivery.flat_fee_per_delivery');

        $completedToday = $courier->deliveries()->where('status', 'delivered')->whereDate('delivered_at', today())->count();
        $completedThisWeek = $courier->deliveries()->where('status', 'delivered')->where('delivered_at', '>=', now()->startOfWeek())->count();

        return response()->json([
            'counts' => [
                // Scoped to this courier's own logistics company — matching
                // Courier\DeliveryController::available(), which is the only
                // place a rider can actually see or accept these. An
                // unscoped platform-wide count here would tell a courier
                // "N deliveries available" that includes deliveries from
                // other companies they can never see or accept.
                'available_deliveries' => Delivery::where('status', 'pending')
                    ->where('logistics_company_id', $courier->logistics_company_id)
                    ->count(),
                'my_active_deliveries' => $courier->deliveries()->whereIn('status', ['accepted', 'picked_up', 'out_for_delivery'])->count(),
                'completed_today' => $completedToday,
                'completed_this_week' => $completedThisWeek,
                'earnings_today' => $completedToday * $fee,
                'earnings_this_week' => $completedThisWeek * $fee,
                'fee_per_delivery' => $fee,
            ],

            'recent_activity' => $courier->deliveries()
                ->where('status', 'delivered')
                ->with('order.seller:id,business_name')
                ->latest('delivered_at')
                ->limit(10)
                ->get()
                ->map(fn ($delivery) => [
                    'type' => 'delivery',
                    'summary' => "Delivered order for {$delivery->order->seller->business_name} — earned ₱" . number_format($fee, 2),
                    'created_at' => $delivery->delivered_at?->toIso8601String(),
                ]),
        ]);
    }
}
