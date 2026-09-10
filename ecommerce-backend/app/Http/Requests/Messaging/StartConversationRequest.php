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
            'product_id' => ['nullable', 'exists:products,id'],
            'product_variation_id' => ['nullable', 'exists:product_variations,id'],
            'body' => ['required', 'string', 'max:2000'],
        ];
    }

    /**
     * exists:users,id can't check "not myself", and the exists: rule on
     * product_variation_id can't confirm it actually belongs to the given
     * product (rather than some other seller's product entirely) — both
     * done here instead.
     */
    protected function passedValidation(): void
    {
        if ((int) $this->input('recipient_id') === $this->user()->id) {
            $this->validator->errors()->add('recipient_id', 'You cannot start a conversation with yourself.');
            throw new \Illuminate\Validation\ValidationException($this->validator);
        }

        $variationId = $this->input('product_variation_id');
        if ($variationId && ! \App\Models\ProductVariation::where('id', $variationId)->where('product_id', $this->input('product_id'))->exists()) {
            $this->validator->errors()->add('product_variation_id', 'This variation does not belong to that product.');
            throw new \Illuminate\Validation\ValidationException($this->validator);
        }
    }
}
