<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;

class UpdateOrderStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'status' => ['required', 'in:in_transit,out_for_delivery,delivered,cancelled'],
            'note' => ['nullable', 'string', 'max:500'],
        ];
    }
}
