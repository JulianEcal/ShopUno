<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CartResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $items = $this->items->map(function ($item) {
            $unitPrice = $item->unitPrice();
            $originalUnitPrice = $item->originalUnitPrice();
            $isDiscounted = $originalUnitPrice > $unitPrice;

            // Prefer the selected variant's own photo (e.g. the "Black" swatch
            // photo, resolved through whichever option value it's tagged on —
            // see ProductVariation::effectiveImage()) so the cart shows what
            // was actually picked, not just whatever happens to be the
            // product's cover image. Falls back to the cover photo for
            // variants with no tagged photo at all, and for line items with
            // no variation at all.
            $image = $item->variation?->effectiveImage()
                ?? $item->product->images->sortBy('sort_order')->first();

            return [
                'id' => $item->id,
                'product_id' => $item->product_id,
                'product_name' => $item->product->name,
                'image' => optional($image)->url,
                'variation' => $item->variation ? [
                    'id' => $item->variation->id,
                    'label' => $this->variationLabel($item->variation),
                ] : null,
                'quantity' => $item->quantity,
                'unit_price' => $unitPrice,
                // Only non-null when a discount is actually knocking the
                // price down — lets the cart UI show a strikethrough price
                // without every line item needing an extra "is this even
                // discounted" check first.
                'original_unit_price' => $isDiscounted ? $originalUnitPrice : null,
                'is_discounted' => $isDiscounted,
                'line_total' => round($unitPrice * $item->quantity, 2),
                'line_savings' => $isDiscounted ? round(($originalUnitPrice - $unitPrice) * $item->quantity, 2) : 0,
                'seller_id' => $item->product->seller_id,
                // Variation stock takes priority when a variation is selected —
                // that's the pool actually being drawn from at checkout.
                'stock' => $item->variation ? $item->variation->stock : $item->product->stock,
            ];
        });

        return [
            'id' => $this->id,
            'items' => $items,
            'total' => round($items->sum('line_total'), 2),
            'discount_savings' => round($items->sum('line_savings'), 2),
        ];
    }

    /**
     * "Style: Only jersey, Size: S" when the option relations are loaded
     * (normal case); falls back to the plain combo label stored on the
     * variation itself (e.g. "Only jersey / S") if they aren't, so this
     * never breaks even if a caller forgets to eager-load them.
     */
    protected function variationLabel($variation): string
    {
        $parts = array_filter([
            $variation->relationLoaded('optionValue1') && $variation->optionValue1
                ? $variation->optionValue1->option->name.': '.$variation->optionValue1->value
                : null,
            $variation->relationLoaded('optionValue2') && $variation->optionValue2
                ? $variation->optionValue2->option->name.': '.$variation->optionValue2->value
                : null,
        ]);

        return $parts ? implode(', ', $parts) : $variation->value;
    }
}
