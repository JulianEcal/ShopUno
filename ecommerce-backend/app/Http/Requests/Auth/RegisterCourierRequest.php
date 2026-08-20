<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class RegisterCourierRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return array_merge($this->baseRules(), [
            'vehicle_type' => ['required', 'string', 'max:50'],
            'plate_number' => ['required', 'string', 'max:20'],
            'or_cr' => ['required', 'file', 'mimes:' . implode(',', config('documents.accepted_extensions')), 'max:' . config('documents.max_size_kb')],
            'license' => ['required', 'file', 'mimes:' . implode(',', config('documents.accepted_extensions')), 'max:' . config('documents.max_size_kb')],
        ]);
    }

    public function messages(): array
    {
        $formats = config('documents.accepted_formats_label');
        $maxMb = config('documents.max_size_kb') / 1024;

        return [
            'upload_id.required' => 'Please upload a valid ID.',
            'upload_id.mimes' => "Valid ID must be a {$formats} file.",
            'upload_id.max' => "Valid ID must not be larger than {$maxMb}MB.",

            'or_cr.required' => 'Please upload your vehicle\'s OR/CR.',
            'or_cr.mimes' => "OR/CR must be a {$formats} file.",
            'or_cr.max' => "OR/CR must not be larger than {$maxMb}MB.",

            'license.required' => 'Please upload your driver\'s license.',
            'license.mimes' => "Driver's license must be a {$formats} file.",
            'license.max' => "Driver's license must not be larger than {$maxMb}MB.",
        ];
    }

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

            'province' => ['required', 'string', 'max:100'],
            'municipality' => ['required', 'string', 'max:100'],
            'barangay' => ['required', 'string', 'max:100'],
            'street' => ['nullable', 'string', 'max:150'],
            'house_number' => ['nullable', 'string', 'max:50'],
        ];
    }
}
