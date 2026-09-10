<?php

namespace App\Http\Controllers\Api\Auth;

use App\Http\Controllers\Controller;
use App\Mail\EmailVerificationOtp;
use App\Models\EmailOtp;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * Powers the "Verify your email" sub-step inside Step 1 of the buyer
 * sign-up wizard (login.html → signup-wizard.js). This is deliberately NOT
 * a new wizard step — the wizard still has exactly 4 steps (Account,
 * Details, Address, Verify-ID). The email OTP is a gate the frontend
 * enforces before it will advance out of Step 1.
 *
 * Two public endpoints, both unauthenticated (there's no account yet):
 *   POST /email/verification/send   { email }
 *   POST /email/verification/verify { email, code }
 * A successful verify() returns a short-lived `email_verification_token`
 * that the frontend must echo back on POST /register/buyer — see
 * RegisterBuyerRequest and RegistrationController::buyer().
 */
class EmailVerificationController extends Controller
{
    private const OTP_LENGTH = 6;
    private const OTP_TTL_MINUTES = 10;
    private const TOKEN_TTL_MINUTES = 30;
    private const RESEND_COOLDOWN_SECONDS = 45;
    private const MAX_ATTEMPTS = 5;

    public function send(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            // Intentionally NOT `unique:users,email` here — that would let
            // this endpoint be used to probe which emails already have
            // accounts. RegisterBuyerRequest still enforces uniqueness at
            // submit time, so a verified-but-already-registered email just
            // fails later with a normal "already registered" error.
            'email' => ['required', 'email', 'max:255'],
        ]);

        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first(), 'errors' => $validator->errors()], 422);
        }

        $email = strtolower($request->string('email')->trim());

        $recent = EmailOtp::where('email', $email)->latest('id')->first();
        if ($recent && $recent->created_at->gt(now()->subSeconds(self::RESEND_COOLDOWN_SECONDS))) {
            $retryAfter = self::RESEND_COOLDOWN_SECONDS - $recent->created_at->diffInSeconds(now());

            return response()->json([
                'message' => "Please wait {$retryAfter}s before requesting another code.",
                'retry_after' => $retryAfter,
            ], 429);
        }

        // Clear any prior (unverified or stale) OTP for this email so only
        // the most recently sent code is ever valid.
        EmailOtp::where('email', $email)->delete();

        $code = str_pad((string) random_int(0, 10 ** self::OTP_LENGTH - 1), self::OTP_LENGTH, '0', STR_PAD_LEFT);

        EmailOtp::create([
            'email' => $email,
            'otp_hash' => Hash::make($code),
            'expires_at' => now()->addMinutes(self::OTP_TTL_MINUTES),
        ]);

        Mail::to($email)->send(new EmailVerificationOtp($code, self::OTP_TTL_MINUTES));

        return response()->json([
            'message' => 'Verification code sent.',
            'expires_in' => self::OTP_TTL_MINUTES * 60,
            'resend_after' => self::RESEND_COOLDOWN_SECONDS,
        ]);
    }

    public function verify(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'email' => ['required', 'email', 'max:255'],
            'code' => ['required', 'digits:' . self::OTP_LENGTH],
        ]);

        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first(), 'errors' => $validator->errors()], 422);
        }

        $email = strtolower($request->string('email')->trim());

        $otp = EmailOtp::where('email', $email)->whereNull('verified_at')->latest('id')->first();

        if (! $otp || $otp->expires_at->isPast()) {
            return response()->json(['message' => 'That code has expired. Please request a new one.'], 422);
        }

        if ($otp->attempts >= self::MAX_ATTEMPTS) {
            return response()->json(['message' => 'Too many incorrect attempts. Please request a new code.'], 422);
        }

        if (! Hash::check($request->string('code'), $otp->otp_hash)) {
            $otp->increment('attempts');
            $remaining = max(self::MAX_ATTEMPTS - $otp->attempts, 0);

            return response()->json([
                'message' => $remaining > 0
                    ? "Incorrect code. {$remaining} attempt" . ($remaining === 1 ? '' : 's') . ' left.'
                    : 'Too many incorrect attempts. Please request a new code.',
            ], 422);
        }

        $token = Str::random(48);
        $otp->update([
            'verified_at' => now(),
            'verify_token' => $token,
            // Re-purpose expires_at as the token's own (longer) validity
            // window, so it survives the rest of the wizard (Steps 2–4)
            // right up to submit.
            'expires_at' => now()->addMinutes(self::TOKEN_TTL_MINUTES),
        ]);

        return response()->json([
            'verified' => true,
            'email_verification_token' => $token,
            'expires_in' => self::TOKEN_TTL_MINUTES * 60,
        ]);
    }
}
