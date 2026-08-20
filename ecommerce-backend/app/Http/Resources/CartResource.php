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
            $firstImage = $item->product->relationLoaded('images')
                ? $item->product->images->first()?->path
                : null;

            return [
                'id' => $item->id,
                'product_id' => $item->product_id,
                'product_name' => $item->product->name,
                'image' => $firstImage,
                'variation' => $item->variation ? [
                    'id' => $item->variation->id,
                    'variation_type' => $item->variation->variation_type,
                    'value' => $item->variation->value,
                ] : null,
                'quantity' => $item->quantity,
                'unit_price' => $unitPrice,
                'line_total' => round($unitPrice * $item->quantity, 2),
                'stock' => $item->variation->stock ?? $item->product->stock,
                'seller_id' => $item->product->seller_id,
                'seller_name' => $item->product->seller?->business_name,
            ];
        });

        return [
            'id' => $this->id,
            'items' => $items,
            'total' => round($items->sum('line_total'), 2),
        ];
    }
}
