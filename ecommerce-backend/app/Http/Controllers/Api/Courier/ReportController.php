<?php

namespace App\Http\Controllers\Api\Courier;

use App\Http\Controllers\Controller;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportController extends Controller
{
    /**
     * GET /courier/reports/earnings?from=&to=
     * Defaults to the last 30 days, same as every other report in this app.
     */
    public function earnings(Request $request): JsonResponse
    {
        [$from, $to] = $this->resolveRange($request);
        $courier = $request->user()->courier;
        $fee = config('delivery.flat_fee_per_delivery');

        $delivered = $courier->deliveries()
            ->where('status', 'delivered')
            ->whereBetween('delivered_at', [$from, $to])
            ->get(['id', 'delivered_at']);

        $byDay = $delivered->groupBy(fn ($d) => $d->delivered_at->toDateString())
            ->map(fn ($group, $date) => [
                'date' => $date,
                'deliveries' => $group->count(),
                'earnings' => $group->count() * $fee,
            ])
            ->values();

        return response()->json([
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'fee_per_delivery' => $fee,
            'total_deliveries' => $delivered->count(),
            'total_earnings' => $delivered->count() * $fee,
            'by_day' => $byDay,
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
}
