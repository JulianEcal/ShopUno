<?php

namespace App\Http\Controllers\Api\Logistics;

use App\Http\Controllers\Controller;
use App\Http\Resources\DeliveryResource;
use App\Models\Delivery;
use App\Models\DeliveryStatusHistory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DeliveryController extends Controller
{
    /**
     * GET /logistics/deliveries?status=awaiting_logistics_confirmation
     * Scoped to this company only — never another company's orders.
     * Defaults to the review queue (awaiting_logistics_confirmation);
     * pass ?status=pending to see what's already been confirmed and is
     * now sitting in this company's own rider pool.
     */
    public function index(Request $request): JsonResponse
    {
        $company = $request->user()->logisticsCompany;

        $deliveries = Delivery::where('logistics_company_id', $company->id)
            ->where('status', $request->query('status', 'awaiting_logistics_confirmation'))
            ->with(['order.seller', 'order.buyer'])
            ->latest()
            ->paginate(20);

        return $this->paginatedResponse(DeliveryResource::collection($deliveries), $deliveries);
    }

    public function show(Request $request, Delivery $delivery): JsonResponse
    {
        $this->ensureOwnCompany($request, $delivery);

        return response()->json([
            'delivery' => new DeliveryResource($delivery->load(['order.seller', 'order.buyer', 'statusHistory'])),
        ]);
    }

    /**
     * POST /logistics/deliveries/{id}/confirm
     * The "Product Ready to Ship? Yes -> Assign Sorting Center -> Starts
     * Order Transfer -> Order Arrives Sorting Center" sequence from the
     * flowchart, deliberately collapsed into ONE action (a status flag,
     * not a real sorting-center entity — project decision, see README).
     * This is what makes the order actually appear on this company's own
     * riders' available-deliveries list.
     *
     * There's no separate "not ready" rejection action on purpose — the
     * flowchart's "No" branch just means the reviewer waits and checks
     * back later, not that anything gets rejected or sent back to the seller.
     */
    public function confirm(Request $request, Delivery $delivery): JsonResponse
    {
        $this->ensureOwnCompany($request, $delivery);

        if ($delivery->status !== 'awaiting_logistics_confirmation') {
            abort(409, "This delivery is '{$delivery->status}', not awaiting confirmation.");
        }

        DB::transaction(function () use ($request, $delivery) {
            $delivery->update([
                'status' => 'pending',
                'confirmed_by_user_id' => $request->user()->id,
                'confirmed_at' => now(),
            ]);

            DeliveryStatusHistory::create([
                'delivery_id' => $delivery->id,
                'status' => 'pending',
                'note' => 'Logistics company confirmed ready to ship — now available to riders.',
                'changed_by_user_id' => $request->user()->id,
            ]);
        });

        return response()->json([
            'message' => 'Order confirmed and transferred — now visible to your riders.',
            'delivery' => new DeliveryResource($delivery->fresh(['order.seller'])),
        ]);
    }

    protected function ensureOwnCompany(Request $request, Delivery $delivery): void
    {
        if ($delivery->logistics_company_id !== $request->user()->logisticsCompany->id) {
            abort(403, 'This delivery was not routed to your company.');
        }
    }
}
