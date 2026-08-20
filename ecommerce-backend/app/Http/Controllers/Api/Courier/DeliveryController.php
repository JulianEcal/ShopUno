<?php

namespace App\Http\Controllers\Api\Courier;

use App\Http\Controllers\Controller;
use App\Http\Resources\DeliveryResource;
use App\Mail\OrderDelivered;
use App\Models\Delivery;
use App\Models\DeliveryStatusHistory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

class DeliveryController extends Controller
{
    /** GET /courier/deliveries/available — unassigned, ready for any courier to accept. */
    public function available(): JsonResponse
    {
        $deliveries = Delivery::query()
            ->where('status', 'pending')
            ->with(['order.seller'])
            ->latest()
            ->paginate(20);

        return response()->json(['data' => DeliveryResource::collection($deliveries)]);
    }

    /** GET /courier/deliveries — this courier's own, accepted-through-delivered. */
    public function index(Request $request): JsonResponse
    {
        $deliveries = $request->user()->courier
            ->deliveries()
            ->with(['order.seller', 'order.buyer'])
            ->latest()
            ->paginate(20);

        return response()->json(['data' => DeliveryResource::collection($deliveries)]);
    }

    public function show(Request $request, Delivery $delivery): JsonResponse
    {
        $this->ensureOwnedByCourier($request, $delivery);

        return response()->json([
            'delivery' => new DeliveryResource($delivery->load(['order.seller', 'order.buyer', 'statusHistory'])),
        ]);
    }

    /**
     * POST /courier/deliveries/{id}/accept — first-come-first-served.
     *
     * The race condition this guards against: two couriers tap "accept" on
     * the same delivery within the same second. lockForUpdate() makes the
     * second request wait for the first transaction to finish, then re-check
     * status — so it sees 'accepted' (not 'pending') and fails cleanly,
     * instead of both couriers silently getting assigned the same delivery.
     */
    public function accept(Request $request): JsonResponse
    {
        $deliveryId = $request->route('delivery');

        $delivery = DB::transaction(function () use ($deliveryId, $request) {
            $delivery = Delivery::lockForUpdate()->findOrFail($deliveryId);

            if ($delivery->status !== 'pending') {
                abort(409, 'This delivery has already been accepted by another courier.');
            }

            $delivery->update([
                'courier_id' => $request->user()->courier->id,
                'status' => 'accepted',
                'accepted_at' => now(),
            ]);

            DeliveryStatusHistory::create([
                'delivery_id' => $delivery->id,
                'status' => 'accepted',
                'changed_by_user_id' => $request->user()->id,
            ]);

            return $delivery;
        });

        return response()->json([
            'message' => 'Delivery accepted.',
            'delivery' => new DeliveryResource($delivery->load('order.seller')),
        ]);
    }

    public function pickup(Request $request, Delivery $delivery): JsonResponse
    {
        $this->advance($request, $delivery, from: 'accepted', to: 'picked_up');

        return response()->json([
            'message' => 'Pickup confirmed.',
            'delivery' => new DeliveryResource($delivery->fresh(['order'])),
        ]);
    }

    public function outForDelivery(Request $request, Delivery $delivery): JsonResponse
    {
        $this->advance($request, $delivery, from: 'picked_up', to: 'out_for_delivery');

        return response()->json([
            'message' => 'Marked out for delivery.',
            'delivery' => new DeliveryResource($delivery->fresh(['order'])),
        ]);
    }

    /**
     * Completes the delivery — this is the courier's "Complete delivery"
     * action, which is also what the seller's "Confirm delivery" requirement
     * actually means (the seller gets notified, they don't perform this
     * themselves — see README "Courier delivery flow").
     */
    public function deliver(Request $request, Delivery $delivery): JsonResponse
    {
        $this->ensureOwnedByCourier($request, $delivery);
        $this->assertStatus($delivery, 'out_for_delivery');

        DB::transaction(function () use ($request, $delivery) {
            $delivery->update(['status' => 'delivered', 'delivered_at' => now()]);
            $delivery->order->update(['status' => 'delivered', 'is_paid' => true, 'paid_at' => now()]);

            DeliveryStatusHistory::create([
                'delivery_id' => $delivery->id,
                'status' => 'delivered',
                'changed_by_user_id' => $request->user()->id,
            ]);
        });

        $delivery->loadMissing('order.seller.user');
        Mail::to($delivery->order->seller->user->email)->send(new OrderDelivered($delivery->order));

        return response()->json([
            'message' => 'Delivery complete.',
            'delivery' => new DeliveryResource($delivery->fresh(['order'])),
        ]);
    }

    protected function advance(Request $request, Delivery $delivery, string $from, string $to): void
    {
        $this->ensureOwnedByCourier($request, $delivery);
        $this->assertStatus($delivery, $from);

        DB::transaction(function () use ($request, $delivery, $to) {
            $timestampField = match ($to) {
                'picked_up' => 'picked_up_at',
                'out_for_delivery' => 'out_for_delivery_at',
                default => null,
            };

            $delivery->update([
                'status' => $to,
                ...($timestampField ? [$timestampField => now()] : []),
            ]);

            $orderStatus = \App\Models\Delivery::ORDER_STATUS_MAP[$to] ?? null;
            if ($orderStatus) {
                $delivery->order->update(['status' => $orderStatus]);
            }

            DeliveryStatusHistory::create([
                'delivery_id' => $delivery->id,
                'status' => $to,
                'changed_by_user_id' => $request->user()->id,
            ]);
        });
    }

    protected function assertStatus(Delivery $delivery, string $expected): void
    {
        if ($delivery->status !== $expected) {
            abort(409, "This delivery must be '{$expected}' before this action — it is currently '{$delivery->status}'.");
        }
    }

    protected function ensureOwnedByCourier(Request $request, Delivery $delivery): void
    {
        if ($delivery->courier_id !== $request->user()->courier->id) {
            abort(403, 'This delivery is not assigned to you.');
        }
    }
}
