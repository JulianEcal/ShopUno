<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Delivery extends Model
{
    protected $fillable = [
        'order_id', 'logistics_company_id', 'courier_id', 'status',
        'confirmed_by_user_id', 'confirmed_at',
        'accepted_at', 'picked_up_at', 'out_for_delivery_at', 'delivered_at',
    ];

    protected $casts = [
        'confirmed_at' => 'datetime',
        'accepted_at' => 'datetime',
        'picked_up_at' => 'datetime',
        'out_for_delivery_at' => 'datetime',
        'delivered_at' => 'datetime',
    ];

    /**
     * Delivery status -> the order status it should be reflected as.
     * 'awaiting_logistics_confirmation'/'pending'/'accepted' have no
     * order-visible change yet — from the buyer's side, the order just
     * stays 'to_ship' through the entire seller-confirm -> logistics-review
     * -> rider-accept pipeline, until a courier actually starts moving it.
     */
    public const ORDER_STATUS_MAP = [
        'picked_up' => 'in_transit',
        'out_for_delivery' => 'out_for_delivery',
        'delivered' => 'delivered',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function logisticsCompany(): BelongsTo
    {
        return $this->belongsTo(LogisticsCompany::class);
    }

    public function courier(): BelongsTo
    {
        return $this->belongsTo(Courier::class);
    }

    public function confirmedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'confirmed_by_user_id');
    }

    public function statusHistory(): HasMany
    {
        return $this->hasMany(DeliveryStatusHistory::class)->latest();
    }
}
