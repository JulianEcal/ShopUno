<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class RegisterBuyerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return array_merge($this->baseRules(), [
            // buyer has no extra fields beyond the shared profile + address
        ]);
    }

    public function messages(): array
    {
        return $this->documentMessages();
    }

    /**
     * Shared across all three registration requests so error text stays
     * consistent no matter which role is submitting a document.
     */
    protected function documentMessages(): array
    {
        $formats = config('documents.accepted_formats_label');
        $maxMb = config('documents.max_size_kb') / 1024;

        return [
            'upload_id.required' => 'Please upload a valid ID.',
            'upload_id.mimes' => "Valid ID must be a {$formats} file.",
            'upload_id.max' => "Valid ID must not be larger than {$maxMb}MB.",
        ];
    }

    /**
     * Shared with RegisterCourierRequest and RegisterLogisticsRequest.
     * Kept here (and duplicated in the other two requests) rather than a trait,
     * so each request's rule set stays easy to read on its own.
     */
    protected function baseRules(): array
    {
        return [
            'last_name' => ['required', 'string', 'max:100'],
            'first_name' => ['required', 'string', 'max:100'],
            'middle_initial' => ['nullable', 'string', 'max:5'],
            'sex' => ['required', 'in:male,female'],

            'email' => ['required', 'email', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],

            'contact_no' => ['required', 'string', 'max:20'],
            'birthday' => ['required', 'date', 'before:today'],

            'upload_id' => ['required', 'file', 'mimes:' . implode(',', config('documents.accepted_extensions')), 'max:' . config('documents.max_size_kb')],

            // address
            'province' => ['required', 'string', 'max:100'],
            'municipality' => ['required', 'string', 'max:100'],
            'barangay' => ['required', 'string', 'max:100'],
            'street' => ['nullable', 'string', 'max:150'],
            'house_number' => ['nullable', 'string', 'max:50'],
        ];
    }
}
