<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;

class UpdateBusinessPermitRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // 'seller' route middleware already restricts this to seller accounts
    }

    /**
     * Same accepted formats + size cap as the original application upload
     * (see Buyer\SellerApplicationRequest) — a renewal/replacement permit
     * is held to the same standard as the one submitted at approval time.
     */
    public function rules(): array
    {
        return [
            'business_permit' => [
                'required', 'file',
                'mimes:' . implode(',', config('documents.accepted_extensions')),
                'max:' . config('documents.max_size_kb'),
            ],
        ];
    }

    public function messages(): array
    {
        $formats = config('documents.accepted_formats_label');
        $maxMb = config('documents.max_size_kb') / 1024;

        return [
            'business_permit.required' => 'Please choose a file to upload.',
            'business_permit.mimes' => "Business permit must be a {$formats} file.",
            'business_permit.max' => "Business permit must not be larger than {$maxMb}MB.",
        ];
    }
}
