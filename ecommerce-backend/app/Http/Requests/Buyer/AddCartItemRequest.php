<?php

namespace App\Http\Requests\Buyer;

use App\Models\ProductVariation;
use Illuminate\Foundation\Http\FormRequest;

class AddCartItemRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'product_id' => ['required', 'exists:products,id'],
            'product_variation_id' => ['nullable', 'exists:product_variations,id'],
            'quantity' => ['required', 'integer', 'min:1'],
        ];
    }

    /**
     * Without this, product_id and product_variation_id are each valid on
     * their own but never checked against each other — nothing stops a
     * request pairing a real product with a real variation that actually
     * belongs to a DIFFERENT product. That would silently corrupt pricing
     * (CartItem::unitPrice() applies the wrong price_adjustment) and, at
     * checkout, decrement stock on the wrong product's variation.
     */
    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            $variationId = $this->input('product_variation_id');

            if (! $variationId) {
                return;
            }

            $belongsToProduct = ProductVariation::where('id', $variationId)
                ->where('product_id', $this->input('product_id'))
                ->exists();

            if (! $belongsToProduct) {
                $validator->errors()->add('product_variation_id', 'This variation does not belong to the selected product.');
            }
        });
    }
}
