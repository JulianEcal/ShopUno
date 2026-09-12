<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Turns the single per-user address row into a real address book:
 * - `label` — buyer's own name for the entry ("Home", "Office", ...).
 * - `recipient_name` / `recipient_phone` — who actually receives a
 *   delivery here, which is very often NOT the account holder (gifts,
 *   dorms, office reception, etc.) — same as Shopee/Lazada's "Contact
 *   name / Phone number" fields on each saved address.
 * - `is_default` — exactly one row per user is the default at a time
 *   (enforced in application code, not a DB constraint, since SQLite/MySQL
 *   partial-unique-index support differs — see AddressController).
 *
 * Every role (buyer/seller/courier/logistics) still only ever gets ONE
 * address row created at registration — this migration just adds the
 * columns needed so a BUYER can go on to save more from their account
 * page and pick one at checkout, without touching how other roles work.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('addresses', function (Blueprint $table) {
            $table->string('label')->nullable()->after('user_id');
            $table->string('recipient_name')->nullable()->after('house_number');
            $table->string('recipient_phone')->nullable()->after('recipient_name');
            $table->boolean('is_default')->default(false)->after('recipient_phone');
        });

        // Backfill: every address that already exists is, by definition,
        // the only one its user has — make it that user's default so
        // existing accounts don't suddenly have zero default addresses.
        DB::table('addresses')->update(['is_default' => true]);
    }

    public function down(): void
    {
        Schema::table('addresses', function (Blueprint $table) {
            $table->dropColumn(['label', 'recipient_name', 'recipient_phone', 'is_default']);
        });
    }
};
