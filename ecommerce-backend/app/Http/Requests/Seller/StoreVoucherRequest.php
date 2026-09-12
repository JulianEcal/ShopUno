<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;

class StoreVoucherRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'code' => ['required', 'string', 'max:30', 'alpha_dash'],
            'type' => ['required', 'in:percent,fixed'],
            'value' => ['required', 'numeric', 'min:0.01'],
            'max_discount_amount' => ['nullable', 'numeric', 'min:0.01'],
            'min_order_amount' => ['nullable', 'numeric', 'min:0'],
            'valid_from' => ['nullable', 'date'],
            'max_uses' => ['nullable', 'integer', 'min:1'],
            'per_user_limit' => ['nullable', 'integer', 'min:1'],
            // 'after:now' rather than 'after:today' — valid_from/valid_until
            // now carry a specific time of day, not just a calendar date,
            // so an expiry of "today at 6 PM" needs to be checked against
            // the current moment, not just today's midnight.
            'valid_until' => ['nullable', 'date', 'after:now'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            if ($this->input('type') === 'percent' && $this->input('value') > 100) {
                $validator->errors()->add('value', 'A percent voucher cannot exceed 100.');
            }

            // A discount cap only means something against a percentage —
            // a fixed voucher's value already IS the cap, so allowing this
            // field there would just be a second, confusing number that
            // does nothing (Voucher::discountFor() ignores it for 'fixed').
            if ($this->input('type') === 'fixed' && $this->filled('max_discount_amount')) {
                $validator->errors()->add('max_discount_amount', 'A discount cap only applies to percent-off vouchers.');
            }

            // Parsed as real datetimes rather than compared as strings, so
            // "2026-09-20T18:00" vs "2026-09-20T09:00" (same day, earlier
            // time) still resolves correctly.
            if ($this->filled('valid_from') && $this->filled('valid_until')
                && Carbon::parse($this->input('valid_from'))->gt(Carbon::parse($this->input('valid_until')))) {
                $validator->errors()->add('valid_from', 'Start time has to be before the expiry time.');
            }
        });
    }

    /** Matches the labels on the "Create a voucher" form in
     * seller-vouchers.js, so an error reads the same as the field the
     * seller was just filling in. */
    public function attributes(): array
    {
        return [
            'code' => 'code',
            'type' => 'discount type',
            'value' => 'value',
            'max_discount_amount' => 'max discount cap',
            'min_order_amount' => 'minimum order amount',
            'valid_from' => 'start time',
            'max_uses' => 'max uses',
            'per_user_limit' => 'per-buyer limit',
            'valid_until' => 'expiry time',
        ];
    }

    public function messages(): array
    {
        return [
            'code.required' => 'Give this voucher a code buyers can enter at checkout.',
            'code.alpha_dash' => 'Codes can only use letters, numbers, dashes and underscores.',
            'code.max' => 'Codes can\'t be longer than 30 characters.',
            'type.required' => 'Choose whether this is a percent or fixed-amount discount.',
            'type.in' => 'Choose whether this is a percent or fixed-amount discount.',
            'value.required' => 'Enter how much this voucher discounts.',
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
            'valid_until.after' => 'Expiry time has to be in the future.',
        ];
    }
}
