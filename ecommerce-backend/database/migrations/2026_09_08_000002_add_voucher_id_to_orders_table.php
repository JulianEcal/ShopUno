<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            // Which voucher (if any) this order's discount came from. Needed
            // to enforce Voucher::per_user_limit ("N uses per buyer") — that
            // check counts this buyer's past orders against a voucher, which
            // isn't possible from the 'discount' amount alone. Nullable
            // (most orders have none) and nullOnDelete so a seller deleting
            // a voucher later never breaks historical order records.
            $table->foreignId('voucher_id')->nullable()->after('seller_id')
                ->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropConstrainedForeignId('voucher_id');
        });
    }
};
