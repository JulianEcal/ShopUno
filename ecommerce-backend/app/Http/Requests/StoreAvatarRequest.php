<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreAvatarRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * 3MB cap mirrors the client-side check in buyer-account.js (which
     * rejects oversized files before ever hitting the network) — kept in
     * sync here so a request that bypasses the frontend still gets the
     * same limit enforced server-side.
     */
    public function rules(): array
    {
        return [
            'avatar' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:3072'],
        ];
    }

    public function messages(): array
    {
        return [
            'avatar.required' => 'Please choose a photo to upload.',
            'avatar.image' => 'The file must be an image.',
            'avatar.mimes' => 'Image must be a JPG, PNG, or WEBP file.',
            'avatar.max' => 'That image is too large — please keep it under 3MB.',
        ];
    }
}
