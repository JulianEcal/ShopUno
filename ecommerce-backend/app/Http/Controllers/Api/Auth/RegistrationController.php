<?php

namespace App\Http\Controllers\Api\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\RegisterBuyerRequest;
use App\Http\Requests\Auth\RegisterCourierRequest;
use App\Http\Requests\Auth\RegisterLogisticsRequest;
use App\Http\Resources\UserResource;
use App\Models\Address;
use App\Models\Courier;
use App\Models\EmailOtp;
use App\Models\LogisticsCompany;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class RegistrationController extends Controller
{
    /**
     * Buyers now go through admin approval, same as Logistics — a valid ID
     * is required and stored, and the account sits at 'pending' until an
     * admin approves it (see Admin\RegistrationController::approve()).
     * No token is issued here since a pending account can't log in yet
     * (AuthController::login() rejects 'pending' with a clear message);
     * the buyer gets access only after approval, via a normal login.
     */
    public function buyer(RegisterBuyerRequest $request): JsonResponse
    {
        $this->assertEmailVerified($request);

        $user = DB::transaction(function () use ($request) {
            $user = $this->createBaseUser($request, role: 'buyer', status: 'pending');
            $this->createAddress($request, $user);

            return $user;
        });

        return $this->pendingResponse($user);
    }

    /**
     * Confirms the email_verification_token the frontend echoes back (from
     * EmailVerificationController::verify()) is genuinely a verified,
     * unexpired token for this exact email — closing the loop on the OTP
     * gate described in that controller's docblock. RegisterBuyerRequest
     * already guarantees the field is present (required, non-empty) by the
     * time this runs.
     */
    protected function assertEmailVerified(Request $request): void
    {
        $email = strtolower(trim((string) $request->input('email')));
        $token = (string) $request->input('email_verification_token');

        $otp = EmailOtp::where('email', $email)
            ->where('verify_token', $token)
            ->whereNotNull('verified_at')
            ->first();

        abort_if(
            ! $otp || $otp->expires_at->isPast(),
            422,
            'Please verify your email again before completing sign-up.'
        );
    }

    /**
     * Couriers now apply to a specific Logistics company rather than
     * registering with the platform independently — logistics_company_id
     * is required and must reference an active company. That company
     * reviews and approves/rejects the applicant, not platform admin —
     * see Logistics\RiderController.
     */
    public function courier(RegisterCourierRequest $request): JsonResponse
    {
        $user = DB::transaction(function () use ($request) {
            $user = $this->createBaseUser($request, role: 'courier', status: 'pending');
            $this->createAddress($request, $user);

            Courier::create([
                'user_id' => $user->id,
                'logistics_company_id' => $request->validated('logistics_company_id'),
                'vehicle_type' => $request->validated('vehicle_type'),
                'plate_number' => $request->validated('plate_number'),
                'or_cr_path' => $request->file('or_cr')->store('courier_docs'),
                'license_path' => $request->file('license')->store('courier_docs'),
            ]);

            return $user;
        });

        return $this->pendingResponse(
            $user,
            'Application submitted. The logistics company will review it — you will be notified by email.'
        );
    }

    /**
     * Logistics companies register directly with the platform (one of only
     * two direct registration types, alongside Buyer) and go through the
     * normal admin approval queue, same as Seller/Courier used to.
     */
    public function logistics(RegisterLogisticsRequest $request): JsonResponse
    {
        $user = DB::transaction(function () use ($request) {
            $user = $this->createBaseUser($request, role: 'logistics', status: 'pending');
            $this->createAddress($request, $user);

            LogisticsCompany::create([
                'user_id' => $user->id,
                'company_name' => $request->validated('company_name'),
                'contact_person' => $request->validated('contact_person'),
                'business_permit_path' => $request->file('business_permit')->store('permits'),
            ]);

            return $user;
        });

        return $this->pendingResponse($user);
    }

    protected function createBaseUser(Request $request, string $role, string $status): User
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
            'status' => $status,
        ]);
    }

    /**
     * Every role's registration form still only ever collects ONE address,
     * so it's created here as that user's default ('Home', recipient =
     * the account holder themselves) — a buyer can go on to save more
     * addresses later from their account page (see Buyer\AddressController)
     * and pick between them at checkout; this one just stops being the
     * only option, not the starting point.
     */
    protected function createAddress(Request $request, User $user): void
    {
        Address::create([
            'user_id' => $user->id,
            'label' => 'Home',
            'recipient_name' => trim("{$request->validated('first_name')} {$request->validated('last_name')}"),
            'recipient_phone' => $request->validated('contact_no'),
            'province' => $request->validated('province'),
            'municipality' => $request->validated('municipality'),
            'barangay' => $request->validated('barangay'),
            'street' => $request->validated('street'),
            'house_number' => $request->validated('house_number'),
            'is_default' => true,
        ]);
    }

    protected function pendingResponse(User $user, ?string $message = null): JsonResponse
    {
        return response()->json([
            'message' => $message ?? 'Registration submitted. Please wait for admin approval — you will be notified by email.',
            'user' => new UserResource($user),
        ], 201);
    }
}