<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class ResolveComplaintRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'status' => ['required', 'in:under_review,resolved'],
            'resolution_notes' => ['required_if:status,resolved', 'nullable', 'string', 'max:2000'],
        ];
    }
}
