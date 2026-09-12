<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Http\Requests\Seller\UpdateOrderStatusRequest;
use App\Http\Resources\OrderResource;
use App\Models\Delivery;
use App\Models\DeliveryStatusHistory;
use App\Models\Order;
use App\Models\OrderStatusHistory;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

class OrderController extends Controller
{
    /**
     * GET /seller/orders?status=&search=
     * The seller's own orders — every status, newest first. 'delivery' is
     * eager-loaded (not just the order's own 'status' column) because the
     * order stays 'to_ship' throughout the whole confirm-ready ->
     * logistics-confirm -> courier-accept hand-off; without it the UI can't
     * tell "not packed yet" apart from "packed, waiting on logistics."
     */
    public function index(Request $request): JsonResponse
    {
        $query = $request->user()->seller
            ->orders()
            ->with(['buyer', 'items', 'logisticsCompany', 'delivery', 'voucher']);

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('id', 'like', "%{$search}%")
                    ->orWhereHas('buyer', function ($b) use ($search) {
                        $b->where('first_name', 'like', "%{$search}%")
                            ->orWhere('last_name', 'like', "%{$search}%");
                    });
            });
        }

        $orders = $query->latest()->paginate(20);

        return $this->paginatedResponse(OrderResource::collection($orders), $orders);
    }

    public function show(Request $request, Order $order): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $order);

        return response()->json([
            'order' => new OrderResource($order->load(['buyer', 'items', 'statusHistory', 'logisticsCompany', 'delivery', 'voucher'])),
        ]);
    }

    /**
     * A seller can now only CANCEL an order directly — everything from
     * "ready to ship" onward is driven by the Delivery pipeline (logistics
     * review, then courier accept/pickup/deliver), not manual seller
     * status changes. This used to let a seller walk an order all the way
     * to 'delivered' themselves, which quietly meant no Delivery record
     * ever got created and the courier system never had anything to work
     * with — see confirmReady() below for the actual replacement.
     */
    public function updateStatus(UpdateOrderStatusRequest $request, Order $order): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $order);

        $newStatus = $request->validated('status');

        if ($newStatus !== 'cancelled') {
            abort(422, "Sellers can only cancel an order directly. Use POST /seller/orders/{$order->id}/confirm-ready to hand it off for delivery.");
        }

        if ($order->status !== 'to_ship') {
            abort(409, 'Orders can only be cancelled while still to_ship.');
        }

        /*
         * order.status deliberately stays 'to_ship' through the entire
         * confirm-ready -> logistics-confirm -> courier-accept hand-off
         * (see confirmReady() above and README "Logistics-Reviewed
         * Delivery Flow") — nothing buyer-visible changes until a courier
         * actually picks up. That means the status check above, on its
         * own, does NOT catch an order that's already been handed off:
         * a seller could otherwise cancel an order that a courier has
         * already accepted (or that's sitting in a logistics company's
         * confirmed queue), leaving an orphaned Delivery a courier could
         * still complete — flipping is_paid on a "cancelled" order and
         * emailing the seller a delivery-complete notice for it. Block
         * on the Delivery record directly, the same way confirmReady()
         * blocks the reverse case.
         */
        if ($order->delivery) {
            abort(409, 'This order has already been handed off for delivery and can no longer be cancelled directly — contact your logistics company or file a complaint if it needs to be stopped.');
        }

        DB::transaction(function () use ($request, $order, $newStatus) {
            $order->update(['status' => $newStatus]);

            OrderStatusHistory::create([
                'order_id' => $order->id,
                'status' => $newStatus,
                'note' => $request->validated('note'),
                'changed_by_user_id' => $request->user()->id,
            ]);
        });

        return response()->json([
            'message' => 'Order cancelled.',
            'order' => new OrderResource($order->fresh(['buyer', 'items', 'statusHistory'])),
        ]);
    }

    /**
     * POST /seller/orders/{order}/confirm-ready
     * The seller's actual hand-off point: "I've packed this, it's ready
     * for delivery." This is what creates the Delivery record — starting
     * at 'awaiting_logistics_confirmation', visible only to the specific
     * logistics company the buyer chose at checkout, not an open pool.
     * The order's own status stays 'to_ship' throughout — from the
     * buyer's view nothing changes until a courier actually picks it up.
     */
    public function confirmReady(Request $request, Order $order): JsonResponse
    {
        $this->ensureOwnedBySeller($request, $order);

        if ($order->status !== 'to_ship') {
            abort(409, "Order must be 'to_ship' to confirm ready — it is currently '{$order->status}'.");
        }

        if (! $order->logistics_company_id) {
            abort(422, 'This order has no logistics company selected — the buyer must choose one at checkout.');
        }

        if ($order->delivery) {
            abort(409, 'This order has already been handed off for delivery.');
        }

        $delivery = DB::transaction(function () use ($request, $order) {
            $delivery = Delivery::create([
                'order_id' => $order->id,
                'logistics_company_id' => $order->logistics_company_id,
                'status' => 'awaiting_logistics_confirmation',
            ]);

            DeliveryStatusHistory::create([
                'delivery_id' => $delivery->id,
                'status' => 'awaiting_logistics_confirmation',
                'note' => 'Seller confirmed order ready for pickup.',
                'changed_by_user_id' => $request->user()->id,
            ]);

            return $delivery;
        });

        return response()->json([
            'message' => 'Order handed off — awaiting logistics company confirmation.',
            'delivery' => $delivery,
        ], 201);
    }

    /**
     * GET /seller/orders/{order}/waybill
     * The last unbuilt Seller function from the checklist: "Prepare orders
     * — pack items, print waybill/shipping label." This is the packing
     * step, so it deliberately does NOT require confirm-ready to have
     * happened yet — a seller prints the label while packing, then hands
     * off with confirm-ready once it's on the box.
     *
     * The waybill number is generated once and reused on every reprint
     * (it's a durable label/tracking number for the physical package),
     * not regenerated per request. Returns the structured data a frontend
     * would need to render its own label; see printWaybill() below for a
     * ready-to-print HTML version that needs no extra frontend work.
     */
    public function waybill(Request $request, Order $order): JsonResponse
    {
        $order = $this->prepareWaybill($request, $order);

        return response()->json(['waybill' => $this->waybillData($order)]);
    }

    /**
     * GET /seller/orders/{order}/waybill/print
     * Same data as waybill(), rendered as a self-contained, printable HTML
     * label — open it in a new tab and print (or "Save as PDF") straight
     * from the browser. Deliberately not a generated PDF file: this sandbox
     * has no access to packagist.org (see README), so pulling in a PDF
     * library isn't an option here — a plain print-styled HTML view needs
     * no new dependency and gets a seller the same physical result.
     */
    public function printWaybill(Request $request, Order $order): Response
    {
        $order = $this->prepareWaybill($request, $order);

        return response(
            view('waybills.show', ['waybill' => $this->waybillData($order)])->render()
        )->header('Content-Type', 'text/html');
    }

    /** Shared guard + idempotent number generation for both waybill endpoints above. */
    protected function prepareWaybill(Request $request, Order $order): Order
    {
        $this->ensureOwnedBySeller($request, $order);

        if ($order->status === 'cancelled') {
            abort(409, 'This order was cancelled — there is nothing to ship.');
        }

        if (! $order->logistics_company_id) {
            abort(422, 'This order has no logistics company selected — the buyer must choose one at checkout.');
        }

        if (! $order->waybill_number) {
            $order->update([
                'waybill_number' => $this->generateWaybillNumber($order),
                'waybill_generated_at' => now(),
            ]);
        }

        return $order->fresh(['buyer', 'seller.user.address', 'logisticsCompany', 'items']);
    }

    /**
     * WB + year/month + zero-padded order id, e.g. WB2608000042. Derived
     * straight from the order's own id, so it's guaranteed unique without
     * needing a retry-on-collision loop, and it's stable across reprints.
     */
    protected function generateWaybillNumber(Order $order): string
    {
        return 'WB'.$order->created_at->format('ym').str_pad((string) $order->id, 6, '0', STR_PAD_LEFT);
    }

    /** Everything a shipping label needs to show, in one place, for both waybill() and printWaybill(). */
    protected function waybillData(Order $order): array
    {
        $formatAddress = function ($address) {
            if (! $address) {
                return null;
            }

            return collect([
                $address->house_number, $address->street, $address->barangay,
                $address->municipality, $address->province,
            ])->filter()->implode(', ');
        };

        return [
            'waybill_number' => $order->waybill_number,
            'generated_at' => $order->waybill_generated_at?->toIso8601String(),
            'order_id' => $order->id,
            'cod_amount' => (float) $order->total,

            'sender' => [
                'name' => $order->seller->business_name,
                'contact_no' => $order->seller->user->contact_no,
                'address' => $formatAddress($order->seller->user->address),
            ],

            'receiver' => [
                'name' => $order->shipping_recipient_name ?: trim("{$order->buyer->first_name} {$order->buyer->last_name}"),
                'contact_no' => $order->shipping_recipient_phone ?: $order->buyer->contact_no,
                // Always the address snapshotted at checkout (see the
                // shipping-snapshot migration) — never the buyer's current
                // live address, which may have since changed or been
                // deleted entirely. Falls back to null only for orders
                // placed before this snapshot existed.
                'address' => $order->shipping_province ? $order->shippingLine() : null,
            ],

            'logistics_company' => $order->logisticsCompany->company_name,

            'items' => $order->items->map(fn ($item) => [
                'product_name' => $item->product_name,
                'quantity' => $item->quantity,
            ])->all(),

            'platform_name' => Setting::where('key', 'platform_name')->value('value')
                ?? config('app.name'),
        ];
    }

    protected function ensureOwnedBySeller(Request $request, Order $order): void
    {
        if ($order->seller_id !== $request->user()->seller->id) {
            abort(403, 'This order does not belong to you.');
        }
    }
}
