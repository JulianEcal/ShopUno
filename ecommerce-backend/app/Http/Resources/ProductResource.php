<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'base_price' => (float) $this->base_price,
            // The price to actually show/charge right now — equals
            // base_price whenever there's no active discount, so any UI
            // that only ever wants "the current price" (buyer catalog
            // grid, cart line default, etc.) can read this single field
            // without also checking discount state first.
            'price' => $this->effectivePrice(),
            'stock' => $this->stock,
            'is_archived' => $this->is_archived,

            // Null when no discount is configured at all. `is_active`
            // reflects the live schedule/pause check (Product::isDiscountActive())
            // so the storefront only ever shows a strikethrough price and
            // badge while a discount is genuinely in effect, while the
            // seller console can still see a scheduled/expired/paused
            // discount's numbers to edit or re-activate them.
            'discount' => $this->hasDiscountConfigured() ? [
                'type' => $this->discount_type,
                'value' => (float) $this->discount_value,
                'starts_at' => $this->discount_starts_at?->toIso8601String(),
                'ends_at' => $this->discount_ends_at?->toIso8601String(),
                'is_active' => (bool) $this->discount_is_active,
                'status' => $this->discountStatus(),
                'is_live' => $this->isDiscountActive(),
                'percent_off' => $this->discountPercentOff(),
            ] : null,
            // False = still a private draft, hidden from the storefront.
            // Flips to true only via POST /seller/products/{id}/publish —
            // no admin-approval step involved.
            'is_published' => $this->is_published,
            'published_at' => $this->published_at?->toIso8601String(),

            'category' => $this->whenLoaded('category', fn () => [
                'id' => $this->category->id,
                'name' => $this->category->name,
            ]),

            'seller' => $this->whenLoaded('seller', fn () => [
                'id' => $this->seller->id,
                // The seller's *user* id — distinct from the Seller row id
                // above. Needed as `recipient_id` when a buyer starts a
                // conversation from this product (POST /conversations),
                // since messaging always addresses a user, not a seller row.
                'user_id' => $this->seller->user_id,
                'business_name' => $this->seller->business_name,
                'line_of_business' => $this->seller->line_of_business,
                'average_rating' => $this->seller->averageRating(),
                'ratings_count' => $this->seller->ratingsCount(),
            ]),

            // Option groups (e.g. "Style", "Size") + their values — this is
            // what the buyer picks from, in order. See `variations` below
            // for the actual price/stock behind each combination of picks.
            'options' => $this->whenLoaded('options', fn () => $this->options->map(fn ($o) => [
                'id' => $o->id,
                'name' => $o->name,
                'position' => $o->position,
                'values' => $o->values->map(fn ($val) => [
                    'id' => $val->id,
                    'value' => $val->value,
                    'position' => $val->position,
                    'image' => $val->relationLoaded('image') && $val->image
                        ? ['id' => $val->image->id, 'url' => $val->image->url]
                        : null,
                ]),
            ])),

            // One row per buyable combination of option values (or, for a
            // product with no option groups, no rows at all — it just sells
            // against the flat `stock`/`base_price` above). `option_value_1_id`
            // / `option_value_2_id` are what the buyer's selection is matched
            // against; `label` is a human-readable fallback like "S / Red".
            'variations' => $this->whenLoaded('variations', fn () => $this->variations->map(function ($v) {
                $image = $v->effectiveImage();

                $original = $v->originalPrice();
                $effective = $v->effectivePrice();

                return [
                    'id' => $v->id,
                    'option_value_1_id' => $v->option_value_1_id,
                    'option_value_2_id' => $v->option_value_2_id,
                    'label' => $v->value,
                    'sku' => $v->sku,
                    'price_adjustment' => (float) $v->price_adjustment,
                    // original_price/price mirror the product-level pair
                    // above but computed for *this* combination (base_price
                    // + its own adjustment), since a flat-amount or percent
                    // discount doesn't come off the same rupee/peso amount
                    // for a variation priced above or below the base.
                    'original_price' => $original,
                    'price' => $effective,
                    'stock' => $v->stock,
                    'image_id' => $v->product_image_id,
                    'image' => $image ? ['id' => $image->id, 'url' => $image->url] : null,
                ];
            })),

            'images' => $this->whenLoaded('images', fn () => $this->images->values()->map(fn ($img, $i) => [
                'id' => $img->id,
                'url' => $img->url,
                'sort_order' => $img->sort_order,
                // First in sort order = the cover photo shown in the storefront/catalog thumbnail.
                'is_cover' => $i === 0,
            ])),
        ];
    }
}
