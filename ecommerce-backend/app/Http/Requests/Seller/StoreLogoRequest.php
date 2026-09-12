<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;

class StoreLogoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Same 3MB cap as StoreAvatarRequest — a logo is a small square image
     * like an avatar, not a wide banner (see StoreBannerRequest's 5MB).
     * Mirrors the client-side check in seller-account.js.
     */
    public function rules(): array
    {
        return [
            'logo' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:3072'],
        ];
    }

    public function messages(): array
    {
        return [
            'logo.required' => 'Please choose a photo to upload.',
            'logo.image' => 'The file must be an image.',
            'logo.mimes' => 'Image must be a JPG, PNG, or WEBP file.',
            'logo.max' => 'That image is too large — please keep it under 3MB.',
        ];
    }
}
