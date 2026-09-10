<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Backs the "verify your email" sub-step inside Step 1 of the buyer
     * sign-up wizard (see EmailVerificationController). Deliberately its
     * own table rather than a cache entry — OTPs need attempt counting and
     * a short-lived `verify_token` survives long enough for the applicant
     * to finish Steps 2–4 of the wizard before submitting, which a plain
     * cache TTL makes awkward to reason about here.
     *
     * Lifecycle of one row:
     *   1. send()   creates it with otp_hash + expires_at (10 min), no token.
     *   2. verify() on a correct code sets verified_at and verify_token, and
     *      bumps expires_at to give the token its own (longer) window.
     *   3. RegisterBuyerRequest checks the token at submit time; on success
     *      RegistrationController::buyer() deletes the row so it can't be
     *      replayed into a second account.
     * Rows from abandoned sign-ups are harmless — send() clears any prior
     * unverified row for the same email before creating a new one.
     */
    public function up(): void
    {
        Schema::create('email_otps', function (Blueprint $table) {
            $table->id();
            $table->string('email')->index();
            $table->string('otp_hash');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->timestamp('expires_at');
            $table->timestamp('verified_at')->nullable();
            $table->string('verify_token')->nullable()->index();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_otps');
    }
};
