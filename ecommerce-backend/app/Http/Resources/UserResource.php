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
            'username' => $this->username,
            'avatar_url' => $this->avatar_url,
            'contact_no' => $this->contact_no,
            'birthday' => $this->birthday?->toDateString(),
            'age' => $this->age,
            'role' => $this->role,
            'status' => $this->status,
            'created_at' => $this->created_at?->toIso8601String(),

            // A Seller account is always an upgrade from an existing Buyer
            // (see users table migration + SellerApplicationController::approve
            // — approving never touches cart/orders, it just flips `role`),
            // so a `role === 'seller'` account can still use every buyer
            // endpoint under this same token. This flag tells the frontend
            // it's safe to offer a Buyer/Seller view switcher instead of
            // locking the account to whichever role happens to be stored.
            'dual_access' => $this->role === 'seller',

            'address' => $this->whenLoaded('address', fn () => $this->address ? [
                'province' => $this->address->province,
                'municipality' => $this->address->municipality,
                'barangay' => $this->address->barangay,
                'street' => $this->address->street,
                'house_number' => $this->address->house_number,
            ] : null),

            // Full address book (buyer feature — see Buyer\AddressController).
            // Other roles will just get a single-item array here (their one
            // registration address), which is harmless since nothing but
            // the buyer account page / checkout picker reads this key.
            'addresses' => \App\Http\Resources\AddressResource::collection($this->whenLoaded('addresses')),

            'seller' => $this->whenLoaded('seller', fn () => $this->seller ? [
                'business_name' => $this->seller->business_name,
                'line_of_business' => $this->seller->line_of_business,
                'shop_description' => $this->seller->shop_description,
                'banner_url' => $this->seller->banner_url,
                'logo_url' => $this->seller->logo_url,
                'has_business_permit' => (bool) $this->seller->business_permit_path,
                // When the Seller row was created — that only ever happens at
                // application approval (see SellerApplicationController::approve),
                // so this is effectively "selling since", distinct from the
                // user's own created_at (which is their original Buyer signup).
                'since' => $this->seller->created_at?->toIso8601String(),
            ] : null),

            'courier' => $this->whenLoaded('courier', fn () => $this->courier ? [
                'vehicle_type' => $this->courier->vehicle_type,
                'plate_number' => $this->courier->plate_number,
                'is_available' => $this->courier->is_available,
                'logistics_company' => $this->courier->relationLoaded('logisticsCompany')
                    ? $this->courier->logisticsCompany?->company_name
                    : null,
            ] : null),

            'logistics_company' => $this->whenLoaded('logisticsCompany', fn () => $this->logisticsCompany ? [
                'company_name' => $this->logisticsCompany->company_name,
                'contact_person' => $this->logisticsCompany->contact_person,
            ] : null),

            // Only the account owner or an admin ever sees these — everyone
            // else gets no 'documents' key at all, not even a null one.
            'documents' => $this->when(
                $request->user() && ($request->user()->isAdmin() || $request->user()->id === $this->id),
                fn () => $this->documentUrls()
            ),

            // Payout details are how the seller gets paid — same
            // owner-or-admin visibility as 'documents' above, since these
            // are effectively financial account details and shouldn't leak
            // to a buyer browsing the shop (UserResource is never used for
            // that public view, but gating here costs nothing and avoids
            // it becoming a footgun if it ever is).
            'payout' => $this->when(
                $this->relationLoaded('seller') && $this->seller
                    && $request->user() && ($request->user()->isAdmin() || $request->user()->id === $this->id),
                fn () => [
                    'method' => $this->seller->payout_method,
                    'account_name' => $this->seller->payout_account_name,
                    'account_number' => $this->seller->payout_account_number,
                    'bank_name' => $this->seller->payout_bank_name,
                ]
            ),
        ];
    }
}
