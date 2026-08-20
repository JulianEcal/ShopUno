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
            'stock' => $this->stock,
            'is_archived' => $this->is_archived,

            'category' => $this->whenLoaded('category', fn () => [
                'id' => $this->category->id,
                'name' => $this->category->name,
            ]),

            'seller' => $this->whenLoaded('seller', fn () => [
                'id' => $this->seller->id,
                'business_name' => $this->seller->business_name,
                'line_of_business' => $this->seller->line_of_business,
                'average_rating' => $this->seller->averageRating(),
            ]),

            'variations' => $this->whenLoaded('variations', fn () => $this->variations->map(fn ($v) => [
                'id' => $v->id,
                'variation_type' => $v->variation_type,
                'value' => $v->value,
                'price_adjustment' => (float) $v->price_adjustment,
                'stock' => $v->stock,
            ])),

            'images' => $this->whenLoaded('images', fn () => $this->images->pluck('path')),
        ];
    }
}
