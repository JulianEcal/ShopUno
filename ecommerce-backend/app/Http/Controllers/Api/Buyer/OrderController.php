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
            ->with(['seller', 'items'])
            ->latest()
            ->paginate(20);

        return response()->json(['data' => OrderResource::collection($orders)]);
    }

    public function show(Request $request, Order $order): JsonResponse
    {
        $this->ensureOwnedByBuyer($request, $order);

        return response()->json([
            'order' => new OrderResource($order->load(['seller', 'items', 'statusHistory'])),
        ]);
    }

    /**
     * POST /orders — checkout.
     * A cart can span multiple sellers; this splits it into one Order per
     * seller (each with its own status/tracking), all created atomically.
     * Optional body: { "vouchers": [{ "seller_id": 1, "code": "WELCOME10" }] }
     * — a voucher only applies to that seller's portion of the order, since
     * each seller runs their own vouchers independently.
     */
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'vouchers' => ['nullable', 'array'],
            'vouchers.*.seller_id' => ['required_with:vouchers', 'exists:sellers,id'],
            'vouchers.*.code' => ['required_with:vouchers', 'string'],
        ]);

        $cart = $request->user()->cart()->with('items.product', 'items.variation')->first();

        if (! $cart || $cart->items->isEmpty()) {
            throw ValidationException::withMessages(['cart' => ['Your cart is empty.']]);
        }

        $itemsBySeller = $cart->items->groupBy(fn ($item) => $item->product->seller_id);
        $voucherInputs = collect($request->input('vouchers', []))->keyBy('seller_id');

        $orders = DB::transaction(function () use ($request, $itemsBySeller, $voucherInputs, $cart) {
            $createdOrders = [];

            foreach ($itemsBySeller as $sellerId => $items) {
                $this->assertStockAvailable($items);

                $subtotal = $items->sum(fn ($item) => $item->unitPrice() * $item->quantity);
                [$voucher, $discount] = $this->resolveVoucher($sellerId, $subtotal, $voucherInputs);

                $order = Order::create([
                    'buyer_id' => $request->user()->id,
                    'seller_id' => $sellerId,
                    'subtotal' => $subtotal,
                    'discount' => $discount,
                    'total' => round($subtotal - $discount, 2),
                    'status' => 'to_ship',
                    'payment_method' => 'cod',
                    'is_paid' => false,
                ]);

                foreach ($items as $item) {
                    $order->items()->create([
                        'product_id' => $item->product_id,
                        'product_variation_id' => $item->product_variation_id,
                        'product_name' => $item->product->name,
                        'unit_price' => $item->unitPrice(),
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
                collect($orders)->map(fn ($o) => $o->load(['seller', 'items']))
            ),
        ], 201);
    }

    /**
     * Looks up and validates a voucher for one seller's portion of checkout.
     * Returns [null, 0] if no code was given for this seller. Throws if a
     * code WAS given but doesn't exist or isn't currently usable — a
     * silently-ignored bad code would be a confusing, hard-to-notice bug.
     */
    protected function resolveVoucher(int $sellerId, float $subtotal, $voucherInputs): array
    {
        if (! $voucherInputs->has($sellerId)) {
            return [null, 0];
        }

        $code = $voucherInputs[$sellerId]['code'];
        $voucher = Voucher::where('seller_id', $sellerId)->where('code', $code)->first();

        if (! $voucher || ! $voucher->isValidFor($subtotal)) {
            throw ValidationException::withMessages([
                'vouchers' => ["The voucher code \"{$code}\" is invalid, expired, or doesn't apply to this order."],
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
            $available = $item->variation->stock ?? $item->product->stock;

            if ($item->quantity > $available) {
                throw ValidationException::withMessages([
                    'cart' => ["Not enough stock for \"{$item->product->name}\" — only {$available} left."],
                ]);
            }
        }
    }

    protected function decrementStock($item): void
    {
        if ($item->variation) {
            $item->variation->decrement('stock', $item->quantity);
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
