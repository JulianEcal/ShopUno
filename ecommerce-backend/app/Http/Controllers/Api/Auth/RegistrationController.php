<?php

namespace App\Http\Controllers\Api\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\RegisterBuyerRequest;
use App\Http\Requests\Auth\RegisterCourierRequest;
use App\Http\Requests\Auth\RegisterSellerRequest;
use App\Http\Resources\UserResource;
use App\Models\Address;
use App\Models\Courier;
use App\Models\Seller;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class RegistrationController extends Controller
{
    public function buyer(RegisterBuyerRequest $request): JsonResponse
    {
        $user = DB::transaction(function () use ($request) {
            $user = $this->createBaseUser($request, role: 'buyer');
            $this->createAddress($request, $user);

            return $user;
        });

        return $this->pendingResponse($user);
    }

    public function seller(RegisterSellerRequest $request): JsonResponse
    {
        $user = DB::transaction(function () use ($request) {
            $user = $this->createBaseUser($request, role: 'seller');
            $this->createAddress($request, $user);

            Seller::create([
                'user_id' => $user->id,
                'business_name' => $request->validated('business_name'),
                'line_of_business' => $request->validated('line_of_business'),
                'business_permit_path' => $request->file('business_permit')->store('permits'),
            ]);

            return $user;
        });

        return $this->pendingResponse($user);
    }

    public function courier(RegisterCourierRequest $request): JsonResponse
    {
        $user = DB::transaction(function () use ($request) {
            $user = $this->createBaseUser($request, role: 'courier');
            $this->createAddress($request, $user);

            Courier::create([
                'user_id' => $user->id,
                'vehicle_type' => $request->validated('vehicle_type'),
                'plate_number' => $request->validated('plate_number'),
                'or_cr_path' => $request->file('or_cr')->store('courier_docs'),
                'license_path' => $request->file('license')->store('courier_docs'),
            ]);

            return $user;
        });

        return $this->pendingResponse($user);
    }

    /**
     * Fields and steps shared by all three registration flows:
     * hash the password, auto-generate age from birthday, store the ID upload,
     * and force status=pending regardless of what the client sends.
     */
    protected function createBaseUser(Request $request, string $role): User
    {
        $birthday = Carbon::parse($request->validated('birthday'));

        return User::create([
            'last_name' => $request->validated('last_name'),
            'first_name' => $request->validated('first_name'),
            'middle_initial' => $request->validated('middle_initial'),
            'sex' => $request->validated('sex'),
            'email' => $request->validated('email'),
            'password' => Hash::make($request->validated('password')),
            'contact_no' => $request->validated('contact_no'),
            'birthday' => $birthday,
            'age' => $birthday->age,
            'upload_id_path' => $request->file('upload_id')->store('ids'),
            'role' => $role,
            'status' => 'pending',
        ]);
    }

    protected function createAddress(Request $request, User $user): void
    {
        Address::create([
            'user_id' => $user->id,
            'province' => $request->validated('province'),
            'municipality' => $request->validated('municipality'),
            'barangay' => $request->validated('barangay'),
            'street' => $request->validated('street'),
            'house_number' => $request->validated('house_number'),
        ]);
    }

    protected function pendingResponse(User $user): JsonResponse
    {
        // No token issued here — pending accounts can't log in until an admin approves them.
        return response()->json([
            'message' => 'Registration submitted. Please wait for admin approval — you will be notified by email.',
            'user' => new UserResource($user),
        ], 201);
    }
}
