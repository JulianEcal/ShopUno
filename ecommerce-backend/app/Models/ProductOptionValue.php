<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One selectable value within a ProductOption group — e.g. "S" under "Size". */
class ProductOptionValue extends Model
{
    protected $fillable = ['product_option_id', 'value', 'position', 'product_image_id'];

    public function option(): BelongsTo
    {
        return $this->belongsTo(ProductOption::class, 'product_option_id');
    }

    /** Optional reference photo for this value (e.g. the "Only jersey" swatch). */
    public function image(): BelongsTo
    {
        return $this->belongsTo(ProductImage::class, 'product_image_id');
    }
}
