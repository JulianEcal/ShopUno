<?php

namespace App\Http\Controllers\Api\Buyer;

use App\Http\Controllers\Controller;
use App\Http\Requests\Buyer\StoreAddressRequest;
use App\Http\Requests\Buyer\UpdateAddressRequest;
use App\Http\Resources\AddressResource;
use App\Models\Address;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The buyer's saved address book — add/edit/delete/set-default, and the
 * list this powers both the Account > Address tab and the "Change address"
 * picker at checkout (see Buyer\OrderController::store, which requires an
 * address_id from this same table).
 *
 * Not role-gated beyond auth:sanctum (same as cart/orders — see routes/api.php's
 * note on that group) since nothing here is buyer-specific at the data
 * layer; in practice only buyers have a reason to save more than one.
 */
class AddressController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json([
            'addresses' => AddressResource::collection($request->user()->addresses),
        ]);
    }

    /**
     * A brand-new address becomes the default automatically when it's the
     * buyer's first one — otherwise only when is_default is explicitly
     * sent true. Either way, making one address default un-defaults every
     * other row for this user (only one row = is_default at a time; see
     * the class docblock for why that's enforced here, not with a DB
     * partial-unique index).
     */
    public function store(StoreAddressRequest $request): JsonResponse
    {
        $user = $request->user();
        $isFirst = ! $user->addresses()->exists();
        $makeDefault = $isFirst || (bool) $request->validated('is_default', false);

        $address = DB::transaction(function () use ($request, $user, $makeDefault) {
            if ($makeDefault) {
                $user->addresses()->where('is_default', true)->update(['is_default' => false]);
            }

            return $user->addresses()->create([
                'label' => $request->validated('label') ?: 'Home',
                'recipient_name' => $request->validated('recipient_name'),
                'recipient_phone' => $request->validated('recipient_phone'),
                'province' => $request->validated('province'),
                'municipality' => $request->validated('municipality'),
                'barangay' => $request->validated('barangay'),
                'street' => $request->validated('street'),
                'house_number' => $request->validated('house_number'),
                'is_default' => $makeDefault,
            ]);
        });

        return response()->json([
            'message' => 'Address saved.',
            'address' => new AddressResource($address),
        ], 201);
    }

    public function update(UpdateAddressRequest $request, Address $address): JsonResponse
    {
        $this->ensureOwned($request, $address);

        $makeDefault = (bool) $request->validated('is_default', false);

        DB::transaction(function () use ($request, $address, $makeDefault) {
            if ($makeDefault && ! $address->is_default) {
                $address->user->addresses()->where('is_default', true)->update(['is_default' => false]);
            }

            $address->update([
                'label' => $request->validated('label') ?: 'Home',
                'recipient_name' => $request->validated('recipient_name'),
                'recipient_phone' => $request->validated('recipient_phone'),
                'province' => $request->validated('province'),
                'municipality' => $request->validated('municipality'),
                'barangay' => $request->validated('barangay'),
                'street' => $request->validated('street'),
                'house_number' => $request->validated('house_number'),
                // Never un-defaults on its own — that only ever happens as
                // a side effect of a DIFFERENT address becoming default
                // (here or in store()/setDefault()), never by directly
                // sending is_default: false for the current default. That
                // would otherwise leave a buyer with zero default addresses.
                'is_default' => $makeDefault || $address->is_default,
            ]);
        });

        return response()->json([
            'message' => 'Address updated.',
            'address' => new AddressResource($address->fresh()),
        ]);
    }

    /**
     * Deleting the default address promotes the next most recently added
     * one automatically, so a buyer is never left with saved addresses but
     * no default — checkout always has something sensible preselected.
     */
    public function destroy(Request $request, Address $address): JsonResponse
    {
        $this->ensureOwned($request, $address);

        $wasDefault = $address->is_default;
        $user = $address->user;

        DB::transaction(function () use ($address, $wasDefault, $user) {
            $address->delete();

            if ($wasDefault) {
                $user->addresses()->orderByDesc('id')->first()?->update(['is_default' => true]);
            }
        });

        return response()->json(['message' => 'Address removed.']);
    }

    public function setDefault(Request $request, Address $address): JsonResponse
    {
        $this->ensureOwned($request, $address);

        DB::transaction(function () use ($address) {
            $address->user->addresses()->where('is_default', true)->update(['is_default' => false]);
            $address->update(['is_default' => true]);
        });

        return response()->json([
            'message' => 'Default address updated.',
            'address' => new AddressResource($address->fresh()),
        ]);
    }

    protected function ensureOwned(Request $request, Address $address): void
    {
        if ($address->user_id !== $request->user()->id) {
            abort(403, 'This address does not belong to you.');
        }
    }
}
