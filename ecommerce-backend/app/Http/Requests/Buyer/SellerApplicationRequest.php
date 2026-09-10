<?php

namespace App\Http\Requests\Buyer;

use Illuminate\Foundation\Http\FormRequest;

class SellerApplicationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // role check (must be an approved Buyer) happens in the controller
    }

    public function rules(): array
    {
        return [
            'business_name' => ['required', 'string', 'max:150'],
            'line_of_business' => ['required', 'string', 'max:100'],
            'business_permit' => ['required', 'file', 'mimes:' . implode(',', config('documents.accepted_extensions')), 'max:' . config('documents.max_size_kb')],
        ];
    }

    public function messages(): array
    {
        $formats = config('documents.accepted_formats_label');
        $maxMb = config('documents.max_size_kb') / 1024;

        return [
            'business_permit.required' => 'Please upload your business permit.',
            'business_permit.mimes' => "Business permit must be a {$formats} file.",
            'business_permit.max' => "Business permit must not be larger than {$maxMb}MB.",
        ];
    }
}
