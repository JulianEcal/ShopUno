<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;

class StoreBannerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Wider cap than the avatar (5MB vs 3MB) since a shop banner is a
     * larger, wide-format image — same mimes restriction as StoreAvatarRequest.
     */
    public function rules(): array
    {
        return [
            'banner' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
        ];
    }

    public function messages(): array
    {
        return [
            'banner.required' => 'Please choose a photo to upload.',
            'banner.image' => 'The file must be an image.',
            'banner.mimes' => 'Image must be a JPG, PNG, or WEBP file.',
            'banner.max' => 'That image is too large — please keep it under 5MB.',
        ];
    }
}
