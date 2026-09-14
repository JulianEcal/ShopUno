<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Seller extends Model
{
    protected $fillable = [
        'user_id', 'business_name', 'line_of_business', 'business_permit_path',
        'shop_description', 'banner_path', 'logo_path',
        'payout_method', 'payout_account_name', 'payout_account_number', 'payout_bank_name',
    ];

    /**
     * Same pass-through-if-already-a-URL / resolve-from-public-disk pattern
     * as User::getAvatarUrlAttribute — a null banner just means the
     * storefront hasn't set one yet, so the frontend falls back to a plain
     * background instead of a broken image.
     */
    public function getBannerUrlAttribute(): ?string
    {
        if (! $this->banner_path) {
            return null;
        }

        return \App\Support\StorageUrl::for($this->banner_path);
    }

    /**
     * The shop's own logo — deliberately separate from
     * User::getAvatarUrlAttribute. A seller's personal avatar (used for
     * their own nav/messages as a person) and their shop's public logo
     * (shown on the storefront and in messages when they're addressed as
     * a seller) are independent images now; this is the latter. Null
     * means the shop hasn't set one, and callers fall back to the user's
     * avatar or initials from there.
     */
    public function getLogoUrlAttribute(): ?string
    {
        if (! $this->logo_path) {
            return null;
        }

        return \App\Support\StorageUrl::for($this->logo_path);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function products(): HasMany
    {
        return $this->hasMany(Product::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    public function vouchers(): HasMany
    {
        return $this->hasMany(Voucher::class);
    }

    /** Ratings target the user account, not the seller row directly — mapped through user_id. */
    public function ratingsReceived(): HasMany
    {
        return $this->hasMany(Rating::class, 'rated_user_id', 'user_id');
    }

    public function averageRating(): ?float
    {
        $avg = $this->ratingsReceived()->avg('score');

        return $avg ? round($avg, 1) : null;
    }

    public function ratingsCount(): int
    {
        return $this->ratingsReceived()->count();
    }
}