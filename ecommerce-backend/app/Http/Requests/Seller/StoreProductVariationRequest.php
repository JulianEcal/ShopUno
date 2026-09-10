<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreProductVariationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // ownership checked in the controller
    }

    public function rules(): array
    {
        return [
            'variation_type' => ['required', 'string', 'max:50'],
            'value' => ['required', 'string', 'max:100'],
            'price_adjustment' => ['nullable', 'numeric'],
            'stock' => ['required', 'integer', 'min:0'],
            // Must be one of this same product's own photos — scoped by
            // product_id so a seller can't point a variation at another
            // product's (or another seller's) image.
            'image_id' => [
                'nullable',
                'integer',
                Rule::exists('product_images', 'id')->where('product_id', $this->route('product')?->id),
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'image_id.exists' => 'Pick a photo that belongs to this product.',
        ];
    }

    protected function prepareForValidation(): void
    {
        // Empty-string from a <select> "No specific photo" option should mean "none", not "invalid".
        if ($this->image_id === '') {
            $this->merge(['image_id' => null]);
        }
    }

    public function validated($key = null, $default = null)
    {
        $data = parent::validated($key, $default);

        // Map the wire-friendly "image_id" onto the actual FK column name
        // (only when returning the full validated array).
        if ($key === null && is_array($data) && array_key_exists('image_id', $data)) {
            $data['product_image_id'] = $data['image_id'];
            unset($data['image_id']);
        }

        return $data;
    }
}
