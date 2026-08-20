<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class FileComplaintRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // any authenticated role can file a complaint
    }

    public function rules(): array
    {
        return [
            'against_user_id' => ['nullable', 'exists:users,id'],
            'order_id' => ['nullable', 'exists:orders,id'],
            'subject' => ['required', 'string', 'max:150'],
            'details' => ['required', 'string', 'max:2000'],
        ];
    }
}
