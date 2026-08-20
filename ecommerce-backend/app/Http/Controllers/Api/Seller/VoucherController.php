<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Http\Requests\Seller\StoreVoucherRequest;
use App\Http\Requests\Seller\UpdateVoucherRequest;
use App\Http\Resources\VoucherResource;
use App\Models\Voucher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class VoucherController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $vouchers = $request->user()->seller->vouchers()->latest()->get();

        return response()->json(['data' => VoucherResource::collection($vouchers)]);
    }

    public function store(StoreVoucherRequest $request): JsonResponse
    {
        $voucher = $request->user()->seller->vouchers()->create($request->validated());

        return response()->json([
            'message' => 'Voucher created.',
            'voucher' => new VoucherResource($voucher),
        ], 201);
    }

    public function update(UpdateVoucherRequest $request, Voucher $voucher): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $voucher);

        $voucher->update($request->validated());

        return response()->json([
            'message' => 'Voucher updated.',
            'voucher' => new VoucherResource($voucher->fresh()),
        ]);
    }

    protected function ensureOwnedBySeller(Request $request, Voucher $voucher): void
    {
        if ($voucher->seller_id !== $request->user()->seller->id) {
            abort(403, 'You can only manage your own vouchers.');
        }
    }
}
