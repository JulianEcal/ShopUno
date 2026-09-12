<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;

class StoreProductImageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'image' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
        ];
    }

    public function messages(): array
    {
        return [
            'image.required' => 'Please choose a photo to upload.',
            'image.image' => 'The file must be an image.',
            'image.mimes' => 'Image must be a JPG, PNG, or WEBP file.',
            'image.max' => 'Image must not be larger than 5MB.',
        ];
    }
}
