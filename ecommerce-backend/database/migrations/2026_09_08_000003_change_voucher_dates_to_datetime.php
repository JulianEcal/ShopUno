<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            // Widened from `date` to `datetime` so a seller can schedule a
            // voucher to start or end at a specific time (e.g. "midnight
            // Sept 20" or "11:59 PM Oct 1") instead of only ever flipping
            // over at midnight server time. Existing rows keep their
            // stored date at 00:00:00, which is unchanged behavior for any
            // voucher created before this migration.
            $table->dateTime('valid_from')->nullable()->change();
            $table->dateTime('valid_until')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('vouchers', function (Blueprint $table) {
            $table->date('valid_from')->nullable()->change();
            $table->date('valid_until')->nullable()->change();
        });
    }
};
