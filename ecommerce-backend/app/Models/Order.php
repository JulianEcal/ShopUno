<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Order extends Model
{
    protected $fillable = [
        'buyer_id', 'seller_id', 'subtotal', 'discount', 'total', 'status',
        'payment_method', 'is_paid', 'paid_at',
    ];

    protected $casts = [
        'subtotal' => 'decimal:2',
        'discount' => 'decimal:2',
        'total' => 'decimal:2',
        'is_paid' => 'boolean',
        'paid_at' => 'datetime',
    ];

    /** Statuses in the order they normally progress through. Used to validate transitions. */
    public const STATUS_SEQUENCE = ['to_ship', 'in_transit', 'out_for_delivery', 'delivered'];

    public function buyer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'buyer_id');
    }

    public function seller(): BelongsTo
    {
        return $this->belongsTo(Seller::class);
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
