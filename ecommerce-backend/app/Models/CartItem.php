<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CartItem extends Model
{
    protected $fillable = ['cart_id', 'product_id', 'product_variation_id', 'quantity'];

    public function cart(): BelongsTo
    {
        return $this->belongsTo(Cart::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function variation(): BelongsTo
    {
        return $this->belongsTo(ProductVariation::class, 'product_variation_id');
    }

    /** Full price including any variation price adjustment, before any discount. */
    public function originalUnitPrice(): float
    {
        return round((float) $this->product->base_price + (float) ($this->variation?->price_adjustment ?? 0), 2);
    }

    /**
     * The price actually charged — originalUnitPrice() with the product's
     * discount applied if one is currently active. This is what checkout
     * (Buyer\OrderController::store()) sums into the order, so a discount
     * that's live at add-to-cart time but expires before checkout is
     * re-evaluated fresh here rather than being locked in early.
     */
    public function unitPrice(): float
    {
        return $this->product->discountedPrice($this->originalUnitPrice());
    }
}
