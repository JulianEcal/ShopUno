<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\VoucherResource;
use App\Models\Voucher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class VoucherController extends Controller
{
    /** GET /vouchers?seller_id= — only currently-usable vouchers, never expired/inactive/exhausted ones. */
    public function index(Request $request): JsonResponse
    {
        $query = Voucher::query()->where('is_active', true)
            ->where(fn ($q) => $q->whereNull('valid_until')->orWhereDate('valid_until', '>=', now()))
            ->where(fn ($q) => $q->whereNull('max_uses')->orWhereColumn('used_count', '<', 'max_uses'));

        if ($sellerId = $request->query('seller_id')) {
            $query->where('seller_id', $sellerId);
        }

        return response()->json(['data' => VoucherResource::collection($query->get())]);
    }
}
