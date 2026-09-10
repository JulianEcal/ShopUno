<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'subtotal' => (float) $this->subtotal,
            'discount' => (float) $this->discount,
            'total' => (float) $this->total,
            'payment_method' => $this->payment_method,
            'is_paid' => $this->is_paid,
            'paid_at' => $this->paid_at?->toIso8601String(),
            'waybill_number' => $this->waybill_number,
            'waybill_generated_at' => $this->waybill_generated_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),

            'seller' => $this->whenLoaded('seller', fn () => [
                'id' => $this->seller->id,
                // The seller's *user* id — distinct from the Seller row id
                // above. Needed as `recipient_id` when a buyer messages the
                // seller about this order (POST /conversations).
                'user_id' => $this->seller->user_id,
                'business_name' => $this->seller->business_name,
            ]),

            // Loaded on every Seller\OrderController action specifically so
            // a seller can see who they're shipping to — but this key was
            // missing from the resource entirely, so it never actually
            // reached the response. Mirrors DeliveryResource's buyer block.
            //
            // 'address' here is the order's OWN shipping snapshot (see the
            // shipping-snapshot migration), never the buyer's current/live
            // address — a buyer can have several saved addresses and can
            // edit or delete any of them after ordering, so this must stay
            // frozen to whatever was actually chosen at checkout.
            'buyer' => $this->whenLoaded('buyer', fn () => [
                'id' => $this->buyer->id,
                'name' => "{$this->buyer->first_name} {$this->buyer->last_name}",
                'contact_no' => $this->buyer->contact_no,
                'address' => $this->shipping_province ? [
                    'label' => $this->shipping_label,
                    'recipient_name' => $this->shipping_recipient_name,
                    'recipient_phone' => $this->shipping_recipient_phone,
                    'province' => $this->shipping_province,
                    'municipality' => $this->shipping_municipality,
                    'barangay' => $this->shipping_barangay,
                    'street' => $this->shipping_street,
                    'house_number' => $this->shipping_house_number,
                    'full_line' => $this->shippingLine(),
                ] : null,
            ]),

            // The voucher this order's 'discount' actually came from, if
            // any — snapshotting just the code/type/value here (rather than
            // linking the live voucher) means this still reads correctly
            // even after the seller later edits or deactivates that code.
            'voucher' => $this->whenLoaded('voucher', fn () => $this->voucher ? [
                'code' => $this->voucher->code,
                'type' => $this->voucher->type,
                'value' => (float) $this->voucher->value,
            ] : null),

            'logistics_company' => $this->whenLoaded('logisticsCompany', fn () => $this->logisticsCompany ? [
                'id' => $this->logisticsCompany->id,
                'company_name' => $this->logisticsCompany->company_name,
            ] : null),

            // Only meaningful while order.status is still 'to_ship' — that's
            // the window where the order itself can't tell "not packed yet"
            // apart from "handed off, waiting on logistics/courier." Once a
            // courier updates the delivery, order.status moves past 'to_ship'
            // and reflects it directly (see Delivery::ORDER_STATUS_MAP).
            'delivery' => $this->whenLoaded('delivery', fn () => $this->delivery ? [
                'status' => $this->delivery->status,
                'confirmed_at' => $this->delivery->confirmed_at?->toIso8601String(),
                'accepted_at' => $this->delivery->accepted_at?->toIso8601String(),
                'picked_up_at' => $this->delivery->picked_up_at?->toIso8601String(),
                'out_for_delivery_at' => $this->delivery->out_for_delivery_at?->toIso8601String(),
                'delivered_at' => $this->delivery->delivered_at?->toIso8601String(),
            ] : null),

            'items' => $this->whenLoaded('items', fn () => $this->items->map(function ($item) {
                $original = $item->original_unit_price !== null ? (float) $item->original_unit_price : (float) $item->unit_price;
                $wasDiscounted = $original > (float) $item->unit_price;

                return [
                    'product_id' => $item->product_id,
                    'product_name' => $item->product_name,
                    'unit_price' => (float) $item->unit_price,
                    // Only set when this line was actually bought at a
                    // discount, so a plain "was ₱X" strikethrough only
                    // ever shows up where one really applied — orders
                    // placed before this column existed have no snapshot
                    // and fall back to matching unit_price (never discounted).
                    'original_unit_price' => $wasDiscounted ? $original : null,
                    'quantity' => $item->quantity,
                    'subtotal' => (float) $item->subtotal,
                ];
            })),

            'status_history' => $this->whenLoaded('statusHistory', fn () => $this->statusHistory->map(fn ($h) => [
                'status' => $h->status,
                'note' => $h->note,
                'created_at' => $h->created_at?->toIso8601String(),
            ])),
        ];
    }
}
