<?php

namespace App\Http\Requests\Messaging;

use Illuminate\Foundation\Http\FormRequest;

class StartConversationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'recipient_id' => ['required', 'exists:users,id'],
            'order_id' => ['nullable', 'exists:orders,id'],
            'body' => ['required', 'string', 'max:2000'],
        ];
    }

    /** exists:users,id can't check "not myself" — done here instead. */
    protected function passedValidation(): void
    {
        if ((int) $this->input('recipient_id') === $this->user()->id) {
            $this->validator->errors()->add('recipient_id', 'You cannot start a conversation with yourself.');
            throw new \Illuminate\Validation\ValidationException($this->validator);
        }
    }
}
