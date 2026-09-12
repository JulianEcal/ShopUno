// assets/js/lib/email-verification.js
// Talks to the two endpoints backing the "Verify your email" sub-step
// inside Step 1 of the buyer sign-up wizard. See
// app/Http/Controllers/Api/Auth/EmailVerificationController.php.

import { api } from "../api.js";

/** Sends (or resends) a 6-digit code to `email`. */
export function sendEmailOtp(email) {
  return api.post("/email/verification/send", { email });
}

/**
 * Checks `code` against the most recently sent OTP for `email`.
 * Resolves to { verified: true, email_verification_token, expires_in }
 * on success — that token must be included in the final
 * POST /register/buyer payload.
 */
export function verifyEmailOtp(email, code) {
  return api.post("/email/verification/verify", { email, code });
}
