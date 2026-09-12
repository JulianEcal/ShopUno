<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateAvatarRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // Square-ish and reasonably small — this is a profile picture,
            // not a document scan, so the size ceiling is much tighter than
            // config/documents.php's 5MB.
            'avatar' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:3072', 'dimensions:min_width=100,min_height=100'],
        ];
    }

    public function messages(): array
    {
        return [
            'avatar.image' => 'That file doesn\'t look like an image.',
            'avatar.mimes' => 'Please upload a JPG, PNG, or WEBP image.',
            'avatar.max' => 'That image is too large — please keep it under 3MB.',
            'avatar.dimensions' => 'That image is too small — please use at least 100x100px.',
        ];
    }
}
