<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Delivery extends Model
{
    protected $fillable = [
        'order_id', 'courier_id', 'status',
        'accepted_at', 'picked_up_at', 'out_for_delivery_at', 'delivered_at',
    ];

    protected $casts = [
        'accepted_at' => 'datetime',
        'picked_up_at' => 'datetime',
        'out_for_delivery_at' => 'datetime',
        'delivered_at' => 'datetime',
    ];

    /** Delivery status -> the order status it should be reflected as. 'pending'/'accepted' have no order-visible change yet. */
    public const ORDER_STATUS_MAP = [
        'picked_up' => 'in_transit',
        'out_for_delivery' => 'out_for_delivery',
        'delivered' => 'delivered',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function courier(): BelongsTo
    {
        return $this->belongsTo(Courier::class);
    }

    public function statusHistory(): HasMany
    {
        return $this->hasMany(DeliveryStatusHistory::class)->latest();
    }
}
