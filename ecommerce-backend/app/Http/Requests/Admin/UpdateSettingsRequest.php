<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class UpdateSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'settings' => ['required', 'array', 'min:1'],
            'settings.*' => ['nullable', 'string', 'max:20000'],
        ];
    }

    /** Keys are dynamic (config-driven), so the allow-list check happens here rather than in rules(). */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $allowed = array_keys(config('platform_settings.fields'));
            $unknown = array_diff(array_keys($this->input('settings', [])), $allowed);

            if (! empty($unknown)) {
                $validator->errors()->add(
                    'settings',
                    'Unknown setting key(s): ' . implode(', ', $unknown) . '. Allowed: ' . implode(', ', $allowed)
                );
            }
        });
    }
}
