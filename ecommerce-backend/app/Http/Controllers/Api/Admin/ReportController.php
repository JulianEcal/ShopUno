<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

class ReportController extends Controller
{
    /**
     * GET /admin/reports/sales?from=&to=
     * Per-seller order counts + revenue, plus a platform-wide total.
     * Defaults to the last 30 days if no range is given.
     */
    public function sales(Request $request): JsonResponse
    {
        [$from, $to] = $this->resolveRange($request);
        $bySeller = $this->sellerBreakdown($from, $to);

        return response()->json([
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'total_orders' => $bySeller->sum('order_count'),
            'total_sales' => round($bySeller->sum('total_sales'), 2),

            // COD-specific: "sales" (placed) and "collected" (cash actually
            // in hand, i.e. delivered) are two different numbers — worth
            // showing both since the gap between them is real money still
            // out on undelivered orders, not just a rounding footnote.
            'total_collected' => round(
                Order::billable()->paid()->whereBetween('created_at', [$from, $to])->sum('total'), 2
            ),

            'by_seller' => $bySeller->map->except('commission_amount')->values(),
        ]);
    }

    /**
     * GET /admin/reports/commission?from=&to=
     * Same underlying order set as Sales Summary, but focused on what the
     * platform is owed — 10% of each seller's total (see config/commission.php).
     */
    public function commission(Request $request): JsonResponse
    {
        [$from, $to] = $this->resolveRange($request);
        $bySeller = $this->sellerBreakdown($from, $to);
        $rate = config('commission.rate');

        $collectedSales = (float) Order::billable()->paid()
            ->whereBetween('created_at', [$from, $to])->sum('total');

        return response()->json([
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'commission_rate' => $rate,
            'total_sales' => round($bySeller->sum('total_sales'), 2),
            'total_commission' => round($bySeller->sum('commission_amount'), 2),

            // Same COD distinction as Sales Summary: commission on orders
            // placed vs. commission actually collectible right now (i.e.
            // cash already in hand on delivered orders).
            'total_commission_collected' => round($collectedSales * $rate, 2),

            'by_seller' => $bySeller->values(),
        ]);
    }

    protected function resolveRange(Request $request): array
    {
        $from = $request->query('from')
            ? Carbon::parse($request->query('from'))->startOfDay()
            : now()->subDays(30)->startOfDay();

        $to = $request->query('to')
            ? Carbon::parse($request->query('to'))->endOfDay()
            : now()->endOfDay();

        return [$from, $to];
    }

    protected function sellerBreakdown(Carbon $from, Carbon $to): Collection
    {
        $rate = config('commission.rate');

        return Order::billable()
            ->whereBetween('created_at', [$from, $to])
            ->with('seller:id,business_name')
            ->get()
            ->groupBy('seller_id')
            ->map(function ($orders) use ($rate) {
                $totalSales = (float) $orders->sum('total');
                $seller = $orders->first()->seller;

                return [
                    'seller_id' => $seller->id,
                    'business_name' => $seller->business_name,
                    'order_count' => $orders->count(),
                    'total_sales' => round($totalSales, 2),
                    'commission_amount' => round($totalSales * $rate, 2),
                ];
            });
    }
}
