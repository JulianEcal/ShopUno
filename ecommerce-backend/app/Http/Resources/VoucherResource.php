<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class VoucherResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'type' => $this->type,
            'value' => (float) $this->value,
            'min_order_amount' => $this->min_order_amount ? (float) $this->min_order_amount : null,
            'max_uses' => $this->max_uses,
            'used_count' => $this->used_count,
            'valid_until' => $this->valid_until?->toDateString(),
            'is_active' => $this->is_active,
            'seller_id' => $this->seller_id,
        ];
    }
}
