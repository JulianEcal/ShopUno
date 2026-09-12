<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;

class UpdateProductDiscountRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // ownership is checked in the controller, not here
    }

    public function rules(): array
    {
        return [
            'discount_type' => ['required', 'in:percentage,fixed'],
            'discount_value' => [
                'required',
                'numeric',
                'min:0.01',
                // A percentage discount can't be 100%+ (that's "free", not
                // a discount) or negative; a fixed-amount discount is only
                // capped against the product's own price, which is checked
                // in the controller (it needs to know the variation with
                // the lowest price, not just base_price alone).
                $this->input('discount_type') === 'percentage' ? 'max:99' : 'max:999999',
            ],
            // Both optional and independent — either can be set alone
            // (open start / open end) or both together for a fixed window.
            'discount_starts_at' => ['nullable', 'date'],
            'discount_ends_at' => ['nullable', 'date', 'after:discount_starts_at'],
            // Defaults true when omitted so "just set a discount" (the
            // common case) doesn't also require explicitly turning it on.
            'discount_is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function attributes(): array
    {
        return [
            'discount_type' => 'discount type',
            'discount_value' => 'discount value',
            'discount_starts_at' => 'start date',
            'discount_ends_at' => 'end date',
        ];
    }

    public function messages(): array
    {
        return [
            'discount_type.required' => 'Choose a discount type: percentage off or a fixed amount off.',
            'discount_type.in' => 'Discount type must be either percentage or fixed.',
            'discount_value.required' => 'Enter how much to take off.',
            'discount_value.numeric' => 'Discount value must be a number.',
            'discount_value.min' => 'Discount value has to be more than 0.',
            'discount_value.max' => 'A percentage discount can\'t be 100% or more — that would make the item free.',
            'discount_ends_at.date' => 'End date must be a valid date.',
            'discount_ends_at.after' => 'The discount\'s end date must be after its start date.',
        ];
    }
}
