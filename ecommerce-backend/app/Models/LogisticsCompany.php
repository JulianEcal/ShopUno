<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class LogisticsCompany extends Model
{
    protected $fillable = ['user_id', 'company_name', 'business_permit_path', 'contact_person'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function couriers(): HasMany
    {
        return $this->hasMany(Courier::class);
    }

    /** Riders who've applied but this company hasn't reviewed yet. */
    public function pendingRiders(): HasMany
    {
        return $this->couriers()->whereHas('user', fn ($q) => $q->where('status', 'pending'));
    }
}
