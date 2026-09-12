<?php

namespace App\Http\Requests\Buyer;

use Illuminate\Foundation\Http\FormRequest;

class StoreAddressRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'label' => ['nullable', 'string', 'max:40'],
            'recipient_name' => ['required', 'string', 'max:150'],
            'recipient_phone' => ['required', 'string', 'max:30'],
            'province' => ['required', 'string', 'max:100'],
            'municipality' => ['required', 'string', 'max:100'],
            'barangay' => ['required', 'string', 'max:100'],
            'street' => ['nullable', 'string', 'max:150'],
            'house_number' => ['nullable', 'string', 'max:50'],
            // The first address a buyer ever saves becomes the default
            // regardless of this flag (see AddressController::store) — this
            // only matters once they already have at least one.
            'is_default' => ['nullable', 'boolean'],
        ];
    }
}
