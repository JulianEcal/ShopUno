<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Deliberately narrow: email, role, status, and identity fields
     * (last/first name, sex, birthday) are NOT editable here — changing
     * those is either a support/admin action or would undermine what was
     * verified at registration. Only day-to-day contact/address details,
     * plus a couple of role-specific business fields, are self-editable.
     */
    public function rules(): array
    {
        return [
            'contact_no' => ['sometimes', 'string', 'max:20'],
            'middle_initial' => ['sometimes', 'nullable', 'string', 'max:5'],

            'address' => ['sometimes', 'array'],
            'address.province' => ['required_with:address', 'string', 'max:100'],
            'address.municipality' => ['required_with:address', 'string', 'max:100'],
            'address.barangay' => ['required_with:address', 'string', 'max:100'],
            'address.street' => ['nullable', 'string', 'max:150'],
            'address.house_number' => ['nullable', 'string', 'max:50'],

            // seller-only fields — ignored server-side for other roles, see controller
            'business_name' => ['sometimes', 'string', 'max:150'],

            // courier-only fields — ignored server-side for other roles
            'vehicle_type' => ['sometimes', 'string', 'max:50'],
            'plate_number' => ['sometimes', 'string', 'max:20'],
        ];
    }
}
