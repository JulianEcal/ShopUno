<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\UpdatePasswordRequest;
use App\Http\Requests\UpdateProfileRequest;
use App\Http\Resources\UserResource;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class AccountController extends Controller
{
    /**
     * PATCH /me
     * Same endpoint for every role — which fields actually get written
     * depends on what the request contains AND what's relevant to that
     * user's role, so a buyer sending `business_name` just has it ignored
     * rather than erroring (keeps one shared request/endpoint instead of
     * four near-identical role-specific ones).
     */
    public function updateProfile(UpdateProfileRequest $request): JsonResponse
    {
        $user = $request->user();

        DB::transaction(function () use ($request, $user) {
            $user->update($request->only([
                'first_name', 'last_name', 'middle_initial', 'sex', 'username', 'contact_no',
            ]));

            // Separate from the mass-update above: a changed email needs its
            // verification cleared, and username is submitted as "" from the
            // form when cleared but the column is nullable/unique, so store
            // that as null rather than an empty string.
            if ($request->has('username')) {
                $user->username = $request->input('username') ?: null;
            }

            if ($request->has('email') && $request->input('email') !== $user->email) {
                $user->email = $request->input('email');
                $user->email_verified_at = null;
            }

            // age isn't user-editable directly — it's derived from
            // birthday, same as at registration (see
            // RegistrationController::createBaseUser) — so a birthday
            // change recomputes it here rather than trusting a client-sent
            // value that could drift out of sync.
            if ($request->has('birthday')) {
                $birthday = Carbon::parse($request->input('birthday'));
                $user->birthday = $birthday;
                $user->age = $birthday->age;
            }

            $user->save();

            if ($request->has('address')) {
                // This form only ever edits ONE address (region/province/
                // municipality/barangay/street/house_number — no recipient
                // name/phone/label fields), so it targets whichever address
                // is currently this user's default rather than creating a
                // second row. A buyer managing a full address book does so
                // through /addresses instead (see Buyer\AddressController) —
                // this path stays exactly as before for that reason, and is
                // also what sellers/couriers/logistics still use for their
                // one business/pickup address.
                $address = $user->addresses()->where('is_default', true)->first()
                    ?? $user->addresses()->first();

                if ($address) {
                    $address->update($request->input('address'));
                } else {
                    $user->addresses()->create($request->input('address') + [
                        'is_default' => true,
                        'recipient_name' => trim("{$user->first_name} {$user->last_name}"),
                        'recipient_phone' => $user->contact_no,
                    ]);
                }
            }

            if ($user->role === 'seller' && ($request->has('business_name') || $request->has('line_of_business') || $request->has('shop_description'))) {
                $user->seller->update($request->only(['business_name', 'line_of_business', 'shop_description']));
            }

            if ($user->role === 'seller' && ($request->has('payout_method') || $request->has('payout_account_name') || $request->has('payout_account_number') || $request->has('payout_bank_name'))) {
                $user->seller->update($request->only(['payout_method', 'payout_account_name', 'payout_account_number', 'payout_bank_name']));
            }

            if ($user->role === 'courier' && ($request->has('vehicle_type') || $request->has('plate_number'))) {
                $user->courier->update($request->only(['vehicle_type', 'plate_number']));
            }
        });

        return response()->json([
            'message' => 'Profile updated.',
            'user' => new UserResource($user->fresh(['address', 'addresses', 'seller', 'courier'])),
        ]);
    }

    public function updatePassword(UpdatePasswordRequest $request): JsonResponse
    {
        $request->user()->update([
            'password' => Hash::make($request->validated('new_password')),
        ]);

        return response()->json(['message' => 'Password updated.']);
    }
}
