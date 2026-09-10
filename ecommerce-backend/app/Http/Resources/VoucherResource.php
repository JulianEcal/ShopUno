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
            // Only ever meaningful for 'percent' — see Voucher::discountFor().
            'max_discount_amount' => $this->max_discount_amount !== null ? (float) $this->max_discount_amount : null,
            'min_order_amount' => $this->min_order_amount ? (float) $this->min_order_amount : null,
            // Full ISO 8601 datetime (not just a date) now that vouchers
            // can start/end at a specific time of day, not only at
            // midnight. The frontend renders these with formatDateTime().
            'valid_from' => $this->valid_from?->toIso8601String(),
            'max_uses' => $this->max_uses,
            'per_user_limit' => $this->per_user_limit,
            'used_count' => $this->used_count,
            'valid_until' => $this->valid_until?->toIso8601String(),
            'is_active' => $this->is_active,
            'seller_id' => $this->seller_id,

            // Set only by the public buyer-facing VoucherController, which
            // annotates each voucher with how many times the CURRENT buyer
            // has already redeemed it, so the picker UI can grey out a
            // code the buyer has already used up rather than let them tap
            // it and get a checkout-time error instead. Absent (and so
            // omitted here) anywhere else a Voucher is serialized, e.g. the
            // seller's own "my vouchers" list — a seller isn't "a buyer" of
            // their own voucher.
            'used_by_current_user' => $this->when(
                isset($this->used_by_current_user),
                fn () => $this->used_by_current_user
            ),
        ];
    }
}
