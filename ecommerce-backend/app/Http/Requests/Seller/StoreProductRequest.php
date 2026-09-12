<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;

class StoreProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // gated by the 'seller' middleware at the route level
    }

    public function rules(): array
    {
        return [
            'category_id' => ['required', 'exists:categories,id'],
            'name' => ['required', 'string', 'max:150'],
            'description' => ['nullable', 'string', 'max:2000'],
            'base_price' => ['required', 'numeric', 'min:0'],
            // Not collected on the create form anymore — a brand-new product
            // starts at 0 and the seller sets real numbers afterward, either
            // per-variation (Options tab) or as a single flat stock count for
            // a product with no variations (Variations tab). Still accepted
            // here for API completeness / the rare direct API caller.
            'stock' => ['sometimes', 'integer', 'min:0'],
        ];
    }

    /**
     * Field names shown in these messages match the seller console's own
     * form labels (see productFieldsHtml() in seller-products.js) rather
     * than the raw column names, so an error here reads the same as the
     * label the seller was just looking at.
     */
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
            'category_id.required' => 'Pick a category for this product.',
            'category_id.exists' => 'That category doesn\'t exist anymore — pick another one.',
            'name.required' => 'Give this product a name.',
            'name.max' => 'Product names can\'t be longer than 150 characters.',
            'description.max' => 'Descriptions can\'t be longer than 2000 characters.',
            'base_price.required' => 'Enter a price for this product.',
            'base_price.numeric' => 'Price must be a number.',
            'base_price.min' => 'Price can\'t be negative.',
            'stock.required' => 'Enter how many you have in stock.',
            'stock.integer' => 'Stock must be a whole number.',
            'stock.min' => 'Stock can\'t be negative.',
        ];
    }
}
