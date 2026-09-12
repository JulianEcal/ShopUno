<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\VoucherResource;
use App\Models\Voucher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class VoucherController extends Controller
{
    /** GET /vouchers?seller_id= — only currently-usable vouchers, never
     * expired/not-yet-started/inactive/exhausted ones. */
    public function index(Request $request): JsonResponse
    {
        // Compared against the exact current moment, not just the calendar
        // date — valid_from/valid_until can carry a specific time of day
        // now, so a voucher starting at 6 PM shouldn't show up at 9 AM on
        // the same day, and one ending at 9 AM shouldn't still show at 6 PM.
        $query = Voucher::query()->where('is_active', true)
            ->where(fn ($q) => $q->whereNull('valid_from')->orWhere('valid_from', '<=', now()))
            ->where(fn ($q) => $q->whereNull('valid_until')->orWhere('valid_until', '>=', now()))
            ->where(fn ($q) => $q->whereNull('max_uses')->orWhereColumn('used_count', '<', 'max_uses'));

        if ($sellerId = $request->query('seller_id')) {
            $query->where('seller_id', $sellerId);
        }

        $vouchers = $query->get();

        // Every route in this file's group requires auth (see routes/api.php),
        // so $request->user() is always present here. Annotate each voucher
        // with how many times THIS buyer has already redeemed it, so the
        // cart's voucher picker can grey out one they've hit the
        // per_user_limit on instead of only finding out at checkout.
        $buyerId = $request->user()->id;
        $vouchers->each(function (Voucher $voucher) use ($buyerId) {
            if ($voucher->per_user_limit !== null) {
                $voucher->used_by_current_user = $voucher->usesByBuyer($buyerId);
            }
        });

        return response()->json(['data' => VoucherResource::collection($vouchers)]);
    }
}
