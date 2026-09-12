<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Models\OrderItem;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportController extends Controller
{
    /**
     * GET /seller/reports/sales?from=&to=
     * Same "billable" definition as the admin report (cancelled orders
     * excluded), scoped to the authenticated seller only. Defaults to the
     * last 30 days if no range is given — matches the admin report's default.
     */
    public function sales(Request $request): JsonResponse
    {
        [$from, $to] = $this->resolveRange($request);
        $seller = $request->user()->seller;

        $orders = $seller->orders()->billable()->whereBetween('created_at', [$from, $to])->get();
        $rate = config('commission.rate');

        $totalSales = (float) $orders->sum('total');
        $totalCollected = (float) $orders->where('is_paid', true)->sum('total');
        $commissionOwed = round($totalCollected * $rate, 2);

        return response()->json([
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],

            'total_orders' => $orders->count(),
            'total_sales' => round($totalSales, 2),

            // Same COD distinction as the admin report: "sales" (placed) vs
            // "collected" (cash actually in hand, i.e. delivered).
            'total_collected' => round($totalCollected, 2),
            'commission_rate' => $rate,
            'commission_owed' => $commissionOwed,
            'net_earnings' => round($totalCollected - $commissionOwed, 2),

            'by_status' => $orders->groupBy('status')->map->count(),

            // Day-by-day trend so the console can chart the range instead of
            // just showing a single flat total — same order set as above,
            // bucketed by calendar day.
            'daily' => $this->dailyBreakdown($orders, $from, $to),

            // "Performance tracking" — which products actually drove revenue
            // in this range, not just totals.
            'top_products' => $this->topProducts($orders->pluck('id')),
        ]);
    }

    /**
     * Buckets the already-fetched order collection by calendar day so the
     * chart has a zero-filled point for every day in range — a day with no
     * orders is a real (low) data point, not a gap in the line.
     */
    protected function dailyBreakdown($orders, Carbon $from, Carbon $to): array
    {
        $byDay = $orders->groupBy(fn ($o) => $o->created_at->toDateString());

        $days = [];
        $cursor = $from->copy()->startOfDay();
        $end = $to->copy()->startOfDay();
        while ($cursor->lte($end)) {
            $key = $cursor->toDateString();
            $dayOrders = $byDay->get($key, collect());

            $days[] = [
                'date' => $key,
                'orders' => $dayOrders->count(),
                'sales' => round((float) $dayOrders->sum('total'), 2),
                'collected' => round((float) $dayOrders->where('is_paid', true)->sum('total'), 2),
            ];

            $cursor->addDay();
        }

        return $days;
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

    protected function topProducts($orderIds)
    {
        if ($orderIds->isEmpty()) {
            return [];
        }

        return OrderItem::query()
            ->whereIn('order_id', $orderIds)
            ->selectRaw('product_id, product_name, SUM(quantity) as qty_sold, SUM(subtotal) as revenue')
            ->groupBy('product_id', 'product_name')
            ->orderByDesc('revenue')
            ->limit(10)
            ->get()
            ->map(fn ($row) => [
                'product_id' => $row->product_id,
                'product_name' => $row->product_name,
                'qty_sold' => (int) $row->qty_sold,
                'revenue' => round((float) $row->revenue, 2),
            ]);
    }
}
