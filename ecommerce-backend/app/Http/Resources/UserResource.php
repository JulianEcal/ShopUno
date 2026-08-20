<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'first_name' => $this->first_name,
            'last_name' => $this->last_name,
            'middle_initial' => $this->middle_initial,
            'sex' => $this->sex,
            'email' => $this->email,
            'contact_no' => $this->contact_no,
            'birthday' => $this->birthday?->toDateString(),
            'age' => $this->age,
            'role' => $this->role,
            'status' => $this->status,

            'address' => $this->whenLoaded('address', fn () => [
                'province' => $this->address->province,
                'municipality' => $this->address->municipality,
                'barangay' => $this->address->barangay,
                'street' => $this->address->street,
                'house_number' => $this->address->house_number,
            ]),

            'seller' => $this->whenLoaded('seller', fn () => $this->seller ? [
                'business_name' => $this->seller->business_name,
                'line_of_business' => $this->seller->line_of_business,
            ] : null),

            'courier' => $this->whenLoaded('courier', fn () => $this->courier ? [
                'vehicle_type' => $this->courier->vehicle_type,
                'plate_number' => $this->courier->plate_number,
                'is_available' => $this->courier->is_available,
            ] : null),

            // Only the account owner or an admin ever sees these — everyone
            // else gets no 'documents' key at all, not even a null one.
            'documents' => $this->when(
                $request->user() && ($request->user()->isAdmin() || $request->user()->id === $this->id),
                fn () => $this->documentUrls()
            ),
        ];
    }
}
