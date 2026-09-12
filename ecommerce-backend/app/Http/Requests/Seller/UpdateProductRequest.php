<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;

class UpdateProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // ownership is checked in the controller, not here
    }

    public function rules(): array
    {
        return [
            'category_id' => ['sometimes', 'exists:categories,id'],
            'name' => ['sometimes', 'string', 'max:150'],
            'description' => ['nullable', 'string', 'max:2000'],
            'base_price' => ['sometimes', 'numeric', 'min:0'],
            'stock' => ['sometimes', 'integer', 'min:0'],
        ];
    }

    /** Same label mapping as StoreProductRequest — kept in sync with the
     * form fields in seller-products.js. */
    public function attributes(): array
    {
        return [
            'category_id' => 'category',
            'name' => 'product name',
            'base_price' => 'price',
            'stock' => 'stock',
        ];
    }

    public function messages(): array
    {
        return [
            'category_id.exists' => 'That category doesn\'t exist anymore — pick another one.',
            'name.max' => 'Product names can\'t be longer than 150 characters.',
            'description.max' => 'Descriptions can\'t be longer than 2000 characters.',
            'base_price.numeric' => 'Price must be a number.',
            'base_price.min' => 'Price can\'t be negative.',
            'stock.integer' => 'Stock must be a whole number.',
            'stock.min' => 'Stock can\'t be negative.',
        ];
    }
}
