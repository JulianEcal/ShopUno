<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Product extends Model
{
    protected $fillable = [
        'seller_id', 'category_id', 'name', 'description',
        'base_price', 'stock', 'is_archived',
    ];

    protected $casts = [
        'base_price' => 'decimal:2',
        'is_archived' => 'boolean',
    ];

    public function seller(): BelongsTo
    {
        return $this->belongsTo(Seller::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function variations(): HasMany
    {
        return $this->hasMany(ProductVariation::class);
    }

    public function images(): HasMany
    {
        return $this->hasMany(ProductImage::class)->orderBy('sort_order');
    }

    public function flags(): HasMany
    {
        return $this->hasMany(ProductFlag::class);
    }

    /** True if the most recent flag action was 'flag' (i.e. still open, not resolved/archived). */
    public function isCurrentlyFlagged(): bool
    {
        $latest = $this->flags()->latest()->first();

        return $latest && $latest->type === 'flag';
    }

    public function scopeActive($query)
    {
        return $query->where('is_archived', false);
    }
}
