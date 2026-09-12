<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DeliveryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'confirmed_at' => $this->confirmed_at?->toIso8601String(),
            'accepted_at' => $this->accepted_at?->toIso8601String(),
            'picked_up_at' => $this->picked_up_at?->toIso8601String(),
            'out_for_delivery_at' => $this->out_for_delivery_at?->toIso8601String(),
            'delivered_at' => $this->delivered_at?->toIso8601String(),

            'logistics_company' => $this->whenLoaded('logisticsCompany', fn () => [
                'id' => $this->logisticsCompany->id,
                'company_name' => $this->logisticsCompany->company_name,
            ]),

            'order' => $this->whenLoaded('order', fn () => [
                'id' => $this->order->id,
                'total' => (float) $this->order->total,
                'payment_method' => $this->order->payment_method,
            ]),

            'seller' => $this->whenLoaded('order', fn () => $this->order->relationLoaded('seller') ? [
                'business_name' => $this->order->seller->business_name,
            ] : null),

            'buyer' => $this->whenLoaded('order', fn () => $this->order->relationLoaded('buyer') ? [
                'name' => "{$this->order->buyer->first_name} {$this->order->buyer->last_name}",
                'contact_no' => $this->order->buyer->contact_no,
                // The courier needs to know where to actually deliver —
                // pulled from the order's own shipping snapshot (see the
                // shipping-snapshot migration), same as OrderResource.
                'address' => $this->order->shipping_province ? [
                    'recipient_name' => $this->order->shipping_recipient_name,
                    'recipient_phone' => $this->order->shipping_recipient_phone,
                    'full_line' => $this->order->shippingLine(),
                ] : null,
            ] : null),
        ];
    }
}
