<?php

namespace App\Http\Controllers\Api\Buyer;

use App\Http\Controllers\Controller;
use App\Http\Requests\Buyer\RateOrderRequest;
use App\Http\Resources\OrderResource;
use App\Models\Order;
use App\Models\OrderStatusHistory;
use App\Models\Rating;
use App\Models\Voucher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class OrderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $orders = $request->user()->orders()
            ->with(['seller', 'items', 'logisticsCompany', 'voucher'])
            ->latest()
            ->paginate(20);

        return $this->paginatedResponse(OrderResource::collection($orders), $orders);
    }

    public function show(Request $request, Order $order): JsonResponse
    {
        $this->ensureOwnedByBuyer($request, $order);

        return response()->json([
            'order' => new OrderResource($order->load(['seller', 'items', 'statusHistory', 'logisticsCompany', 'voucher'])),
        ]);
    }

    /**
     * POST /orders — checkout.
     * A cart can span multiple sellers; this splits it into one Order per
     * seller (each with its own status/tracking), all created atomically.
     * Body: { "address_id": 1, "vouchers": [...], "logistics_choices": [{ "seller_id": 1, "logistics_company_id": 2 }] }
     * — address_id is REQUIRED: it's one of the buyer's own saved
     * addresses (see Buyer\AddressController), and its fields are
     * snapshotted onto every order created here (same address for all of
     * them — Shopee-style checkout picks one delivery address for the
     * whole cart, not per seller).
     * logistics_choices is TEMPORARILY OPTIONAL: the "buyer picks a
     * logistics company per seller at checkout" flow (see README
     * "Logistics-Reviewed Delivery Flow") isn't built on the frontend yet,
     * so an order with no choice for a given seller is just created with
     * logistics_company_id left null for that seller — checkout shouldn't
     * hard-block on a step that doesn't exist yet. Any choices that ARE
     * sent are still validated and applied normally. Re-tighten this back
     * to required once the frontend has a real picker.
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'address_id' => [
                'required',
                'exists:addresses,id',
                function ($attribute, $value, $fail) use ($request) {
                    $owned = \App\Models\Address::where('id', $value)->where('user_id', $request->user()->id)->exists();
                    if (! $owned) {
                        $fail('That address does not belong to you.');
                    }
                },
            ],

            'vouchers' => ['nullable', 'array'],
            'vouchers.*.seller_id' => ['required_with:vouchers', 'exists:sellers,id'],
            'vouchers.*.code' => ['required_with:vouchers', 'string'],

            'logistics_choices' => ['nullable', 'array'],
            'logistics_choices.*.seller_id' => ['required', 'exists:sellers,id'],
            'logistics_choices.*.logistics_company_id' => [
                'required',
                'exists:logistics_companies,id',
                function ($attribute, $value, $fail) {
                    $company = \App\Models\LogisticsCompany::find($value);
                    if ($company && $company->user->status !== 'active') {
                        $fail('The selected logistics company is not currently active.');
                    }
                },
            ],
        ]);

        $address = \App\Models\Address::findOrFail($request->input('address_id'));

        $cart = $request->user()->cart()->with('items.product', 'items.variation')->first();

        if (! $cart || $cart->items->isEmpty()) {
            throw ValidationException::withMessages(['cart' => ['Your cart is empty.']]);
        }

        $itemsBySeller = $cart->items->groupBy(fn ($item) => $item->product->seller_id);
        $voucherInputs = collect($request->input('vouchers', []))->keyBy('seller_id');
        $logisticsChoices = collect($request->input('logistics_choices', []))->keyBy('seller_id');

        $orders = DB::transaction(function () use ($request, $itemsBySeller, $voucherInputs, $logisticsChoices, $cart, $address) {
            $createdOrders = [];

            foreach ($itemsBySeller as $sellerId => $items) {
                $this->assertStockAvailable($items);

                $subtotal = $items->sum(fn ($item) => $item->unitPrice() * $item->quantity);
                [$voucher, $discount] = $this->resolveVoucher($sellerId, $subtotal, $voucherInputs, $request->user()->id);

                $order = Order::create([
                    'buyer_id' => $request->user()->id,
                    'seller_id' => $sellerId,
                    'voucher_id' => $voucher?->id,
                    'logistics_company_id' => $logisticsChoices[$sellerId]['logistics_company_id'] ?? null,
                    'subtotal' => $subtotal,
                    'discount' => $discount,
                    'total' => round($subtotal - $discount, 2),
                    'status' => 'to_ship',
                    'payment_method' => 'cod',
                    'is_paid' => false,

                    // Snapshotted from the buyer's chosen address book entry
                    // — see the shipping snapshot migration's note on why
                    // this is copied rather than left as a live reference.
                    'shipping_address_id' => $address->id,
                    'shipping_label' => $address->label,
                    'shipping_recipient_name' => $address->recipient_name,
                    'shipping_recipient_phone' => $address->recipient_phone,
                    'shipping_province' => $address->province,
                    'shipping_municipality' => $address->municipality,
                    'shipping_barangay' => $address->barangay,
                    'shipping_street' => $address->street,
                    'shipping_house_number' => $address->house_number,
                ]);

                foreach ($items as $item) {
                    $order->items()->create([
                        'product_id' => $item->product_id,
                        'product_variation_id' => $item->product_variation_id,
                        'product_name' => $item->product->name,
                        'unit_price' => $item->unitPrice(),
                        // Snapshotted alongside unit_price so order history
                        // can still show "was ₱X" even after the seller's
                        // discount later changes or expires — see the
                        // migration note on this column.
                        'original_unit_price' => $item->originalUnitPrice(),
                        'quantity' => $item->quantity,
                        'subtotal' => $item->unitPrice() * $item->quantity,
                    ]);

                    $this->decrementStock($item);
                }

                if ($voucher) {
                    $voucher->increment('used_count');
                }

                OrderStatusHistory::create([
                    'order_id' => $order->id,
                    'status' => 'to_ship',
                    'note' => 'Order placed.',
                    'changed_by_user_id' => $request->user()->id,
                ]);

                $createdOrders[] = $order;
            }

            $cart->items()->delete();

            return $createdOrders;
        });

        return response()->json([
            'message' => count($orders) > 1
                ? 'Checkout complete — split into ' . count($orders) . ' orders (one per seller).'
                : 'Order placed.',
            'orders' => OrderResource::collection(
                collect($orders)->map(fn ($o) => $o->load(['seller', 'items', 'logisticsCompany', 'voucher']))
            ),
        ], 201);
    }

    /**
     * Looks up and validates a voucher for one seller's portion of checkout.
     * Returns [null, 0] if no code was given for this seller. Throws if a
     * code WAS given but doesn't exist or isn't currently usable — a
     * silently-ignored bad code would be a confusing, hard-to-notice bug.
     * $buyerId is required (not just for the message) so a per_user_limit
     * voucher is actually enforced here — see Voucher::isValidFor().
     */
    protected function resolveVoucher(int $sellerId, float $subtotal, $voucherInputs, int $buyerId): array
    {
        if (! $voucherInputs->has($sellerId)) {
            return [null, 0];
        }

        $code = $voucherInputs[$sellerId]['code'];
        $voucher = Voucher::where('seller_id', $sellerId)->where('code', $code)->first();

        if (! $voucher || ! $voucher->isValidFor($subtotal, $buyerId)) {
            throw ValidationException::withMessages([
                'vouchers' => ["The voucher code \"{$code}\" is invalid, expired, already used up, or doesn't apply to this order."],
            ]);
        }

        return [$voucher, $voucher->discountFor($subtotal)];
    }

    /**
     * POST /orders/{order}/rating — only after delivery, and only once per order.
     * For now this always rates the seller (rated_user_id = seller's user) —
     * once couriers exist, a second rating targeting the courier would use
     * the same table/endpoint pattern, just a different rated_user_id.
     */
    public function rate(RateOrderRequest $request, Order $order): JsonResponse
    {
        $this->ensureOwnedByBuyer($request, $order);

        if ($order->status !== 'delivered') {
            abort(409, 'You can only rate an order after it has been delivered.');
        }

        $sellerUserId = $order->seller()->first()->user_id;

        if (Rating::where('order_id', $order->id)->where('rated_user_id', $sellerUserId)->exists()) {
            abort(409, 'You have already rated this order.');
        }

        $rating = Rating::create([
            'order_id' => $order->id,
            'rated_by_user_id' => $request->user()->id,
            'rated_user_id' => $sellerUserId,
            'score' => $request->validated('score'),
            'feedback' => $request->validated('feedback'),
        ]);

        return response()->json([
            'message' => 'Thanks for your feedback!',
            'rating' => [
                'id' => $rating->id,
                'score' => $rating->score,
                'feedback' => $rating->feedback,
            ],
        ], 201);
    }

    protected function assertStockAvailable($items): void
    {
        foreach ($items as $item) {
            $available = $item->variation?->stock ?? $item->product->stock;

            if ($item->quantity > $available) {
                throw ValidationException::withMessages([
                    'cart' => ["Not enough stock for \"{$item->product->name}\" — only {$available} left."],
                ]);
            }
        }
    }

    /**
     * Decrements the actual stock pool for this line item. When it's a
     * specific variation, that also nudges products.stock back in sync
     * (see Product::syncStockFromVariations) — otherwise the inventory
     * table/low-stock filters would keep showing pre-order numbers forever,
     * since those read products.stock directly and this order never
     * touches that column on its own.
     */
    protected function decrementStock($item): void
    {
        if ($item->variation) {
            $item->variation->decrement('stock', $item->quantity);
            $item->product->syncStockFromVariations();
        } else {
            $item->product->decrement('stock', $item->quantity);
        }
    }

    protected function ensureOwnedByBuyer(Request $request, Order $order): void
    {
        if ($order->buyer_id !== $request->user()->id) {
            abort(403, 'This order does not belong to you.');
        }
    }
}
