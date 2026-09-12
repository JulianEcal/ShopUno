<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductVariation extends Model
{
    protected $fillable = [
        'product_id', 'product_image_id', 'variation_type', 'value', 'price_adjustment', 'stock',
        'option_value_1_id', 'option_value_2_id', 'sku',
    ];

    protected $casts = [
        'price_adjustment' => 'decimal:2',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /** The photo shown for this specific variant (e.g. the "Red" swatch photo). Optional — falls back to the product's cover image when unset. */
    public function image(): BelongsTo
    {
        return $this->belongsTo(ProductImage::class, 'product_image_id');
    }

    /** First option group's chosen value for this combination (e.g. "Style: Only jersey"). */
    public function optionValue1(): BelongsTo
    {
        return $this->belongsTo(ProductOptionValue::class, 'option_value_1_id')->with(['option', 'image']);
    }

    /** Second option group's chosen value, when the product has two option groups (e.g. "Size: S"). */
    public function optionValue2(): BelongsTo
    {
        return $this->belongsTo(ProductOptionValue::class, 'option_value_2_id')->with(['option', 'image']);
    }

    /**
     * The photo to actually show for this combination: its own photo if one
     * was set directly (rare now — the seller UI tags photos onto option
     * *values*, not individual combo rows), otherwise whichever option
     * value has a tagged photo. In practice this means picking a Style
     * with a tagged photo swaps the picture and it *stays* swapped no
     * matter which Size gets picked afterward, since Size values aren't
     * usually tagged with their own photos — but if a seller tags Size
     * instead of Style, that's honored too rather than assuming groups
     * are always in one particular order.
     */
    public function effectiveImage(): ?ProductImage
    {
        return $this->image ?? $this->optionValue1?->image ?? $this->optionValue2?->image;
    }

    /** This combination's full price before any discount — base_price + this variation's adjustment. */
    public function originalPrice(): float
    {
        return round((float) $this->product->base_price + (float) $this->price_adjustment, 2);
    }

    /** This combination's price right now, with the product's discount (if any is currently active) applied. */
    public function effectivePrice(): float
    {
        return $this->product->discountedPrice($this->originalPrice());
    }
}
