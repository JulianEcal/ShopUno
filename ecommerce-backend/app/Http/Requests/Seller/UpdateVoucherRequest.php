<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;

class UpdateVoucherRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // ownership checked in the controller
    }

    public function rules(): array
    {
        return [
            'value' => ['sometimes', 'numeric', 'min:0.01'],
            'max_discount_amount' => ['nullable', 'numeric', 'min:0.01'],
            'min_order_amount' => ['nullable', 'numeric', 'min:0'],
            'valid_from' => ['nullable', 'date'],
            'max_uses' => ['nullable', 'integer', 'min:1'],
            'per_user_limit' => ['nullable', 'integer', 'min:1'],
            'valid_until' => ['nullable', 'date'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * 'type' isn't editable here, so it isn't in the request body — but a
     * percent voucher's value still needs the same >100 guard StoreVoucherRequest
     * has, or a seller could PATCH an existing percent voucher's value to
     * e.g. 150 and nothing would catch it. Same reasoning for
     * max_discount_amount only being meaningful on a percent voucher. Both
     * read the voucher's actual type off the route-bound model instead.
     */
    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            $voucher = $this->route('voucher');
            if (! $voucher) {
                return;
            }

            if ($voucher->type === 'percent' && $this->filled('value') && $this->input('value') > 100) {
                $validator->errors()->add('value', 'A percent voucher cannot exceed 100.');
            }

            if ($voucher->type === 'fixed' && $this->filled('max_discount_amount')) {
                $validator->errors()->add('max_discount_amount', 'A discount cap only applies to percent-off vouchers.');
            }

            $validFrom = $this->filled('valid_from') ? Carbon::parse($this->input('valid_from')) : $voucher->valid_from;
            $validUntil = $this->filled('valid_until') ? Carbon::parse($this->input('valid_until')) : $voucher->valid_until;
            if ($validFrom && $validUntil && $validFrom->gt($validUntil)) {
                $validator->errors()->add('valid_from', 'Start time has to be before the expiry time.');
            }
        });
    }

    /** Matches the labels on the "Edit voucher" form in seller-vouchers.js. */
    public function attributes(): array
    {
        return [
            'value' => 'value',
            'max_discount_amount' => 'max discount cap',
            'min_order_amount' => 'minimum order amount',
            'valid_from' => 'start time',
            'max_uses' => 'max uses',
            'per_user_limit' => 'per-buyer limit',
            'valid_until' => 'expiry time',
            'is_active' => 'active status',
        ];
    }

    public function messages(): array
    {
        return [
            'value.numeric' => 'Value must be a number.',
            'value.min' => 'Value must be at least 0.01.',
            'max_discount_amount.numeric' => 'Max discount cap must be a number.',
            'max_discount_amount.min' => 'Max discount cap must be at least 0.01.',
            'min_order_amount.numeric' => 'Minimum order amount must be a number.',
            'min_order_amount.min' => 'Minimum order amount can\'t be negative.',
            'valid_from.date' => 'Enter a valid start date and time.',
            'max_uses.integer' => 'Max uses must be a whole number.',
            'max_uses.min' => 'Max uses must be at least 1.',
            'per_user_limit.integer' => 'Per-buyer limit must be a whole number.',
            'per_user_limit.min' => 'Per-buyer limit must be at least 1.',
            'valid_until.date' => 'Enter a valid date and time.',
        ];
    }
}
