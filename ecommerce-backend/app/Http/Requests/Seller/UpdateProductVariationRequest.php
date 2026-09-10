<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateProductVariationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // variation_type/value are no longer editable directly — they're
            // derived from the product's option groups/values (see
            // Seller\ProductOptionController). Only the per-combination
            // details below are editable here.
            'sku' => ['sometimes', 'nullable', 'string', 'max:100'],
            'price_adjustment' => ['sometimes', 'nullable', 'numeric'],
            'stock' => ['sometimes', 'integer', 'min:0'],
            'image_id' => [
                'sometimes',
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
        if ($this->image_id === '') {
            $this->merge(['image_id' => null]);
        }
    }

    public function validated($key = null, $default = null)
    {
        $data = parent::validated($key, $default);

        if ($key === null && is_array($data) && array_key_exists('image_id', $data)) {
            $data['product_image_id'] = $data['image_id'];
            unset($data['image_id']);
        }

        return $data;
    }
}
