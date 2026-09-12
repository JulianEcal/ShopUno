<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Courier extends Model
{
    protected $fillable = [
        'user_id', 'logistics_company_id', 'vehicle_type', 'plate_number',
        'or_cr_path', 'license_path', 'is_available',
        'reviewed_by_user_id', 'reviewed_at', 'rejection_reason',
    ];

    protected $casts = [
        'is_available' => 'boolean',
        'reviewed_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function logisticsCompany(): BelongsTo
    {
        return $this->belongsTo(LogisticsCompany::class);
    }

    public function reviewedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by_user_id');
    }

    public function deliveries(): HasMany
    {
        return $this->hasMany(Delivery::class);
    }
}
