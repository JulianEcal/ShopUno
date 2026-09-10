<?php

namespace App\Http\Requests\Seller;

use Illuminate\Foundation\Http\FormRequest;

class UpdateOrderStatusRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Only 'cancelled' is valid here now — everything from ready-to-ship
     * onward goes through POST /seller/orders/{id}/confirm-ready and the
     * Delivery pipeline instead. 'status' is still an array (not a fixed
     * value) so the error message stays generic-looking rather than
     * exposing the exact old status list as if those were still options.
     */
    public function rules(): array
    {
        return [
            'status' => ['required', 'in:cancelled'],
            'note' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return [
            'status.in' => 'Sellers can only cancel an order directly — use the confirm-ready endpoint to hand it off for delivery.',
        ];
    }
}
