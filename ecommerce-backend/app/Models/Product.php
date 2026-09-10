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
        // Not exposed through StoreProductRequest/UpdateProductRequest's
        // validated() rules — only Seller\ProductController::store() (forces
        // false) and ::publish() (forces true) ever set these, so a seller
        // can't flip visibility through the general create/update endpoints.
        'is_published', 'published_at',
        // Likewise not touched by the general update() endpoint — only
        // Seller\ProductController::setDiscount()/removeDiscount() (via
        // Seller\UpdateProductDiscountRequest) ever write these, so a
        // discount can't be smuggled in through a plain product edit.
        'discount_type', 'discount_value', 'discount_starts_at', 'discount_ends_at', 'discount_is_active',
    ];

    protected $casts = [
        'base_price' => 'decimal:2',
        'is_archived' => 'boolean',
        'is_published' => 'boolean',
        'published_at' => 'datetime',
        'discount_value' => 'decimal:2',
        'discount_starts_at' => 'datetime',
        'discount_ends_at' => 'datetime',
        'discount_is_active' => 'boolean',
    ];

    /* ============================================================
     * Discounts
     *
     * A discount only ever affects *price*, never stock or catalog
     * visibility — it's config sitting on top of base_price, checked
     * fresh every time effectivePrice()/isDiscountActive() is called
     * rather than being "applied" once and baked into a column. That's
     * what lets a scheduled discount switch itself on/off exactly at its
     * start/end time with nothing to run in the background, and why
     * removing a discount instantly reverts every price that reads it.
     *
     * unitPrice()-style helpers elsewhere (CartItem, order checkout) call
     * discountedPrice()/effectivePrice() rather than reading discount_*
     * columns directly — see those classes for how the same logic is
     * reused for a specific variation's price (base_price + adjustment).
     * ============================================================ */

    /** A discount has been set up at all, regardless of whether it's currently live. */
    public function hasDiscountConfigured(): bool
    {
        return ! is_null($this->discount_type) && ! is_null($this->discount_value);
    }

    /**
     * True only when the discount is actually knocking money off right
     * now: configured, not paused, and (if scheduled) inside its window.
     * A discount with no starts_at/ends_at is "always on" once configured
     * and un-paused — that's the plain "make this cheaper" case; adding
     * one or both dates turns it into a scheduled/flash-deal window.
     */
    public function isDiscountActive(): bool
    {
        if (! $this->hasDiscountConfigured() || ! $this->discount_is_active) {
            return false;
        }

        $now = now();
        if ($this->discount_starts_at && $now->lt($this->discount_starts_at)) {
            return false;
        }
        if ($this->discount_ends_at && $now->gt($this->discount_ends_at)) {
            return false;
        }

        return true;
    }

    /** 'none' | 'scheduled' | 'active' | 'expired' | 'paused' — what the seller console's badge should say. */
    public function discountStatus(): string
    {
        if (! $this->hasDiscountConfigured()) {
            return 'none';
        }
        if (! $this->discount_is_active) {
            return 'paused';
        }

        $now = now();
        if ($this->discount_starts_at && $now->lt($this->discount_starts_at)) {
            return 'scheduled';
        }
        if ($this->discount_ends_at && $now->gt($this->discount_ends_at)) {
            return 'expired';
        }

        return 'active';
    }

    /**
     * Applies this product's discount to an arbitrary price — used both
     * for the product's own base_price and, by CartItem/ProductVariation,
     * for a specific variation's full price (base_price + adjustment), so
     * a % or fixed-amount discount comes off the *combination's* real
     * price rather than being computed on base_price alone and applied
     * blindly to every variation regardless of its adjustment.
     * Floors at ₱0.01 — a fixed-amount discount larger than the price
     * can't make an item free or negative.
     */
    public function discountedPrice(float $price): float
    {
        if (! $this->isDiscountActive()) {
            return round($price, 2);
        }

        $discounted = $this->discount_type === 'percentage'
            ? $price * (1 - min((float) $this->discount_value, 100) / 100)
            : $price - (float) $this->discount_value;

        return round(max($discounted, 0.01), 2);
    }

    /** The price to actually charge/display for the plain (no-variation) product right now. */
    public function effectivePrice(): float
    {
        return $this->discountedPrice((float) $this->base_price);
    }

    /**
     * Whole-number "-20%" style badge value, derived from the real price
     * difference rather than echoing discount_value directly — so a fixed
     * ₱50-off discount still shows a sensible percentage badge, and a
     * percentage discount never claims a bigger cut than what floor-ing
     * at ₱0.01 actually delivered on a very cheap item.
     */
    public function discountPercentOff(): ?int
    {
        if (! $this->isDiscountActive()) {
            return null;
        }

        $base = (float) $this->base_price;
        if ($base <= 0) {
            return null;
        }

        return (int) round((1 - $this->effectivePrice() / $base) * 100);
    }

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
        return $this->hasMany(ProductVariation::class)->with(['image', 'optionValue1', 'optionValue2']);
    }

    /** The (at most two) option groups buyers choose from, e.g. "Style" and "Size". */
    public function options(): HasMany
    {
        return $this->hasMany(ProductOption::class)->orderBy('position')->with('values.image');
    }

    /**
     * Keeps the flat `stock` column in sync with the sum of this product's
     * variation stocks, so every place that already reads/filters/sorts by
     * products.stock (the inventory table, low/out-of-stock filters, the
     * dashboard, etc.) keeps working without change once a product has
     * variations. Products with no variations keep their own manually-set
     * stock untouched by this.
     */
    public function syncStockFromVariations(): void
    {
        if ($this->variations()->exists()) {
            $this->update(['stock' => (int) $this->variations()->sum('stock')]);
        }
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

    /** Live in front of buyers — not a draft, not archived. */
    public function scopePublished($query)
    {
        return $query->where('is_published', true);
    }

    /**
     * Products whose most recent flag entry is still 'flag' (not resolved
     * or archived since) — done as a query-level scope, not a post-fetch
     * filter, specifically so it can be combined with paginate() safely.
     * Filtering a Collection after paginate() looks like it works but
     * quietly breaks the pagination metadata (total/last_page still
     * reflect the unfiltered count, and later pages can silently drop
     * matching rows that landed on an earlier, now-thinned-out page).
     */
    public function scopeCurrentlyFlagged($query)
    {
        $latestFlagIds = ProductFlag::selectRaw('MAX(id) as id')->groupBy('product_id');

        return $query->whereHas('flags', function ($q) use ($latestFlagIds) {
            $q->whereIn('id', $latestFlagIds)->where('type', 'flag');
        });
    }
}
