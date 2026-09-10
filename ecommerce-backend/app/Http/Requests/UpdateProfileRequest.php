<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * role and status are NOT editable here — changing those is a
     * support/admin action. Sex and birthday USED to be locked as
     * "verified at registration" identity fields, but that's now a
     * self-service edit too (age is recomputed from birthday server-side —
     * see AccountController::updateProfile). Everything else a person
     * would reasonably want to keep current — name, username, email,
     * contact/address, plus a couple of role-specific business fields —
     * is self-editable.
     *
     * Email is intentionally editable despite being a login credential:
     * see AccountController::updateProfile, which resets
     * email_verified_at when it changes, since a new address is by
     * definition unverified again.
     */
    public function rules(): array
    {
        return [
            'first_name' => ['sometimes', 'string', 'max:100'],
            'last_name' => ['sometimes', 'string', 'max:100'],
            'middle_initial' => ['sometimes', 'nullable', 'string', 'max:5'],
            'sex' => ['sometimes', 'in:male,female'],
            'birthday' => ['sometimes', 'date', 'before:today'],
            'username' => [
                'sometimes', 'nullable', 'string', 'min:3', 'max:30',
                'regex:/^[a-zA-Z0-9_.]+$/',
                Rule::unique('users', 'username')->ignore($this->user()->id),
            ],
            'email' => [
                'sometimes', 'string', 'email', 'max:150',
                Rule::unique('users', 'email')->ignore($this->user()->id),
            ],
            'contact_no' => ['sometimes', 'string', 'max:20'],

            'address' => ['sometimes', 'array'],
            'address.province' => ['required_with:address', 'string', 'max:100'],
            'address.municipality' => ['required_with:address', 'string', 'max:100'],
            'address.barangay' => ['required_with:address', 'string', 'max:100'],
            'address.street' => ['nullable', 'string', 'max:150'],
            'address.house_number' => ['nullable', 'string', 'max:50'],

            // seller-only fields — ignored server-side for other roles, see controller
            'business_name' => ['sometimes', 'string', 'max:150'],
            'line_of_business' => ['sometimes', 'string', 'max:100'],
            'shop_description' => ['sometimes', 'nullable', 'string', 'max:1000'],

            // Payout details — how the seller actually gets paid. All
            // nullable individually (a seller can clear a field), but
            // account_name/number are required once a method is chosen,
            // and bank_name is only meaningful for a bank transfer.
            'payout_method' => ['sometimes', 'nullable', 'in:bank,gcash,maya'],
            'payout_account_name' => ['sometimes', 'nullable', 'required_with:payout_method', 'string', 'max:150'],
            'payout_account_number' => ['sometimes', 'nullable', 'required_with:payout_method', 'string', 'max:50'],
            'payout_bank_name' => ['sometimes', 'nullable', 'required_if:payout_method,bank', 'string', 'max:100'],

            // courier-only fields — ignored server-side for other roles
            'vehicle_type' => ['sometimes', 'string', 'max:50'],
            'plate_number' => ['sometimes', 'string', 'max:20'],
        ];
    }

    public function messages(): array
    {
        return [
            'username.regex' => 'Username must be 3–30 characters: letters, numbers, underscores, or periods only.',
            'username.min' => 'Username must be 3–30 characters: letters, numbers, underscores, or periods only.',
            'username.unique' => 'That username is already taken.',
            'email.unique' => 'That email is already in use by another account.',
            'payout_account_name.required_with' => 'Please enter the account name for your payout method.',
            'payout_account_number.required_with' => 'Please enter the account number for your payout method.',
            'payout_bank_name.required_if' => 'Please enter your bank name for a bank transfer payout.',
        ];
    }
}
