<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            // Caps how much a PERCENT voucher can ever take off, e.g. "20%
            // off, up to ₱1,000" — without this, a 20%-off code has no
            // ceiling and a huge cart makes it behave like an uncapped
            // fixed discount. Ignored for 'fixed' vouchers (their discount
            // is already a hard amount). Nullable = no cap.
            $table->decimal('max_discount_amount', 10, 2)->nullable()->after('value');

            // Lets a seller schedule a voucher to start working on a future
            // date (e.g. queue up a payday sale ahead of time) instead of
            // it being usable the instant it's created. Nullable = usable
            // immediately, same as before this column existed.
            $table->date('valid_from')->nullable()->after('min_order_amount');

            // Caps how many times a SINGLE buyer can redeem this code,
            // independent of max_uses (the voucher's overall cap). E.g.
            // "one use per customer" welcome codes. Nullable = no per-buyer
            // limit, only the overall max_uses (if any) applies.
            $table->unsignedInteger('per_user_limit')->nullable()->after('max_uses');
        });
    }

    public function down(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->dropColumn(['max_discount_amount', 'valid_from', 'per_user_limit']);
        });
    }
};
