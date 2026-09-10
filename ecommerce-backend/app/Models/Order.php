<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Order extends Model
{
    protected $fillable = [
        'buyer_id', 'seller_id', 'voucher_id', 'logistics_company_id', 'subtotal', 'discount', 'total', 'status',
        'payment_method', 'is_paid', 'paid_at', 'waybill_number', 'waybill_generated_at',
        'shipping_address_id', 'shipping_label', 'shipping_recipient_name', 'shipping_recipient_phone',
        'shipping_province', 'shipping_municipality', 'shipping_barangay', 'shipping_street', 'shipping_house_number',
    ];

    protected $casts = [
        'subtotal' => 'decimal:2',
        'discount' => 'decimal:2',
        'total' => 'decimal:2',
        'is_paid' => 'boolean',
        'paid_at' => 'datetime',
        'waybill_generated_at' => 'datetime',
    ];

    public function buyer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'buyer_id');
    }

    public function seller(): BelongsTo
    {
        return $this->belongsTo(Seller::class);
    }

    /** The voucher (if any) whose discount this order's 'discount' column
     * came from — see the voucher_id migration for why this exists
     * (per-buyer usage limits need real order history, not just a counter). */
    public function voucher(): BelongsTo
    {
        return $this->belongsTo(Voucher::class);
    }

    public function logisticsCompany(): BelongsTo
    {
        return $this->belongsTo(LogisticsCompany::class);
    }

    /** One-line shipping address, built from this order's own snapshot
     * (never the buyer's current/live address — see the migration note on
     * shipping_address_id for why those must never be confused). */
    public function shippingLine(): string
    {
        return collect([
            $this->shipping_house_number, $this->shipping_street, $this->shipping_barangay,
            $this->shipping_municipality, $this->shipping_province,
        ])->filter()->implode(', ');
    }

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    public function statusHistory(): HasMany
    {
        return $this->hasMany(OrderStatusHistory::class)->latest();
    }

    public function complaints(): HasMany
    {
        return $this->hasMany(Complaint::class);
    }

    public function delivery(): HasOne
    {
        return $this->hasOne(Delivery::class);
    }

    /**
     * Orders that count toward sales/commission reporting.
     * Cancelled orders are excluded — everything else counts as a sale the
     * moment it's placed, regardless of whether cash has actually changed
     * hands yet (COD is only "collected" on delivery — see scopePaid).
     */
    public function scopeBillable($query)
    {
        return $query->where('status', '!=', 'cancelled');
    }

    /** Orders where COD cash has actually been collected (i.e. delivered). */
    public function scopePaid($query)
    {
        return $query->where('is_paid', true);
    }
}
