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
    /**
     * GET /courier/deliveries/available — pending AND scoped to this
     * courier's own logistics company. Previously this showed every
     * pending delivery platform-wide regardless of company — that no
     * longer matches the model: a rider only ever sees and accepts work
     * routed to the company they applied to and were approved by.
     */
    public function available(Request $request): JsonResponse
    {
        $companyId = $request->user()->courier->logistics_company_id;

        $deliveries = Delivery::query()
            ->where('status', 'pending')
            ->where('logistics_company_id', $companyId)
            ->with(['order.seller'])
            ->latest()
            ->paginate(20);

        return $this->paginatedResponse(DeliveryResource::collection($deliveries), $deliveries);
    }

    /** GET /courier/deliveries — this courier's own, accepted-through-delivered. */
    public function index(Request $request): JsonResponse
    {
        $deliveries = $request->user()->courier
            ->deliveries()
            ->with(['order.seller', 'order.buyer'])
            ->latest()
            ->paginate(20);

        return $this->paginatedResponse(DeliveryResource::collection($deliveries), $deliveries);
    }

    public function show(Request $request, Delivery $delivery): JsonResponse
    {
        $this->ensureOwnedByCourier($request, $delivery);

        return response()->json([
            'delivery' => new DeliveryResource($delivery->load(['order.seller', 'order.buyer', 'statusHistory'])),
        ]);
    }

    /**
     * POST /courier/deliveries/{id}/accept — first-come-first-served,
     * scoped to the courier's own company.
     *
     * Two things this guards against:
     * 1. The race condition: two couriers tap "accept" on the same delivery
     *    within the same second. lockForUpdate() makes the second request
     *    wait for the first transaction to finish, then re-check status —
     *    so it sees 'accepted' (not 'pending') and fails cleanly, instead
     *    of both couriers silently getting assigned the same delivery.
     * 2. Company mismatch: available() already filters by company, but
     *    that's just what the UI shows — nothing stops a request hitting
     *    this endpoint directly with a delivery ID from another company.
     *    The check below is the real enforcement, not the filtered list.
     */
    public function accept(Request $request): JsonResponse
    {
        $deliveryId = $request->route('delivery');
        $courier = $request->user()->courier;

        $delivery = DB::transaction(function () use ($deliveryId, $courier, $request) {
            $delivery = Delivery::lockForUpdate()->findOrFail($deliveryId);

            if ($delivery->logistics_company_id !== $courier->logistics_company_id) {
                abort(403, 'This delivery was not routed to your logistics company.');
            }

            if ($delivery->status !== 'pending') {
                abort(409, 'This delivery has already been accepted by another courier.');
            }

            $delivery->update([
                'courier_id' => $courier->id,
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
