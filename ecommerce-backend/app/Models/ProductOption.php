<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One "axis" of choice on a product — e.g. "Style" or "Size". A product
 * has at most two of these (see StoreProductOptionRequest); the values
 * under each option are combined pairwise into ProductVariation rows.
 */
class ProductOption extends Model
{
    protected $fillable = ['product_id', 'name', 'position'];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function values(): HasMany
    {
        return $this->hasMany(ProductOptionValue::class)->orderBy('position');
    }
}
