<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\UpdatePasswordRequest;
use App\Http\Requests\UpdateProfileRequest;
use App\Http\Resources\UserResource;
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
            $user->update($request->only(['contact_no', 'middle_initial']));

            if ($request->has('address')) {
                $user->address()->updateOrCreate([], $request->input('address'));
            }

            if ($user->role === 'seller' && $request->has('business_name')) {
                $user->seller->update($request->only('business_name'));
            }

            if ($user->role === 'courier' && ($request->has('vehicle_type') || $request->has('plate_number'))) {
                $user->courier->update($request->only(['vehicle_type', 'plate_number']));
            }
        });

        return response()->json([
            'message' => 'Profile updated.',
            'user' => new UserResource($user->fresh(['address', 'seller', 'courier'])),
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
