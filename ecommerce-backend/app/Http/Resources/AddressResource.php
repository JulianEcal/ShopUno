<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AddressResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'label' => $this->label,
            'recipient_name' => $this->recipient_name,
            'recipient_phone' => $this->recipient_phone,
            'province' => $this->province,
            'municipality' => $this->municipality,
            'barangay' => $this->barangay,
            'street' => $this->street,
            'house_number' => $this->house_number,
            'is_default' => (bool) $this->is_default,
            // Ready-to-render "house_number, street, barangay, municipality,
            // province" line — every screen that lists addresses (account
            // page, checkout picker) wants exactly this, so it's built once
            // here instead of every frontend call site re-implementing the
            // same filter+join.
            'full_line' => $this->fullLine(),
        ];
    }
}
