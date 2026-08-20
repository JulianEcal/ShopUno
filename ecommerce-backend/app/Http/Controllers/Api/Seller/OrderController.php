<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Http\Requests\Seller\UpdateOrderStatusRequest;
use App\Http\Resources\OrderResource;
use App\Models\Order;
use App\Models\OrderStatusHistory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class OrderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $orders = $request->user()->seller
            ->orders()
            ->with(['buyer', 'items'])
            ->latest()
            ->paginate(20);

        return response()->json(['data' => OrderResource::collection($orders)]);
    }

    public function show(Request $request, Order $order): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $order);

        return response()->json([
            'order' => new OrderResource($order->load(['buyer', 'items', 'statusHistory'])),
        ]);
    }

    /**
     * Only allows moving forward one step at a time (or cancelling from to_ship),
     * so a seller can't accidentally skip "in_transit" straight to "delivered".
     *
     * NOTE: once the courier/delivery flow exists, this "mark delivered ->
     * mark paid" responsibility should move to the courier's confirm-delivery
     * action instead, since they're the one physically collecting the cash.
     * Kept here for now since sellers are the ones advancing order status
     * until deliveries are built — see README "Cash on Delivery".
     */
    public function updateStatus(UpdateOrderStatusRequest $request, Order $order): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $order);

        $newStatus = $request->validated('status');
        $this->assertValidTransition($order->status, $newStatus);

        DB::transaction(function () use ($request, $order, $newStatus) {
            $order->update([
                'status' => $newStatus,
                ...($newStatus === 'delivered' ? ['is_paid' => true, 'paid_at' => now()] : []),
            ]);

            OrderStatusHistory::create([
                'order_id' => $order->id,
                'status' => $newStatus,
                'note' => $request->validated('note'),
                'changed_by_user_id' => $request->user()->id,
            ]);
        });

        return response()->json([
            'message' => 'Order status updated.',
            'order' => new OrderResource($order->fresh(['buyer', 'items', 'statusHistory'])),
        ]);
    }

    protected function assertValidTransition(string $current, string $next): void
    {
        if ($current === 'cancelled' || $current === 'delivered') {
            abort(409, "Order is already {$current} and cannot be changed further.");
        }

        if ($next === 'cancelled') {
            if ($current !== 'to_ship') {
                abort(409, 'Orders can only be cancelled while still to_ship.');
            }

            return;
        }

        $sequence = \App\Models\Order::STATUS_SEQUENCE;
        $currentIndex = array_search($current, $sequence);
        $nextIndex = array_search($next, $sequence);

        if ($nextIndex !== $currentIndex + 1) {
            abort(422, "Cannot move an order from '{$current}' directly to '{$next}' — statuses must advance one step at a time.");
        }
    }

    protected function ensureOwnedBySeller(Request $request, Order $order): void
    {
        if ($order->seller_id !== $request->user()->seller->id) {
            abort(403, 'This order does not belong to you.');
        }
    }
}
