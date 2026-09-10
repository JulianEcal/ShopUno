<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Voucher extends Model
{
    protected $fillable = [
        'seller_id', 'code', 'type', 'value', 'max_discount_amount',
        'min_order_amount', 'valid_from', 'max_uses', 'per_user_limit',
        'used_count', 'valid_until', 'is_active',
    ];

    protected $casts = [
        'value' => 'decimal:2',
        'max_discount_amount' => 'decimal:2',
        'min_order_amount' => 'decimal:2',
        'valid_from' => 'datetime',
        'valid_until' => 'datetime',
        'is_active' => 'boolean',
    ];

    public function seller(): BelongsTo
    {
        return $this->belongsTo(Seller::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    /**
     * True if this voucher can currently be applied to an order of the
     * given subtotal, for the given buyer.
     *
     * $buyerId is optional so contexts without a buyer in hand can still
     * get the non-buyer-specific checks, but any real checkout call MUST
     * pass the buyer id, or a per_user_limit voucher would never actually
     * be enforced.
     */
    public function isValidFor(float $subtotal, ?int $buyerId = null): bool
    {
        if (! $this->is_active) {
            return false;
        }

        if ($this->valid_from && $this->valid_from->isFuture()) {
            return false;
        }

        if ($this->valid_until && $this->valid_until->isPast()) {
            return false;
        }

        if ($this->max_uses !== null && $this->used_count >= $this->max_uses) {
            return false;
        }

        if ($this->min_order_amount !== null && $subtotal < (float) $this->min_order_amount) {
            return false;
        }

        if ($this->per_user_limit !== null && $buyerId !== null
            && $this->usesByBuyer($buyerId) >= $this->per_user_limit) {
            return false;
        }

        return true;
    }

    /** How many times the given buyer has already redeemed this voucher,
     * counted from actual orders rather than a running counter — a buyer
     * can have several past orders against the same code, so this can't be
     * a simple boolean flag. */
    public function usesByBuyer(int $buyerId): int
    {
        return $this->id ? $this->orders()->where('buyer_id', $buyerId)->count() : 0;
    }

    /** Discount amount for a given subtotal — never exceeds the subtotal
     * itself, and for percent vouchers never exceeds max_discount_amount
     * when one is set (e.g. "20% off, up to ₱1,000"). A fixed voucher's
     * value already IS the cap, so max_discount_amount is only meaningful
     * for percent. */
    public function discountFor(float $subtotal): float
    {
        $discount = $this->type === 'percent'
            ? $subtotal * ((float) $this->value / 100)
            : (float) $this->value;

        if ($this->type === 'percent' && $this->max_discount_amount !== null) {
            $discount = min($discount, (float) $this->max_discount_amount);
        }

        return round(min($discount, $subtotal), 2);
    }
}
