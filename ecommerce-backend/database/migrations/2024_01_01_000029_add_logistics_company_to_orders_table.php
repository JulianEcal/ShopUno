<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * The buyer picks a logistics company per order at checkout (offered by
     * the seller) — this is what routes a seller-confirmed order to a
     * specific company's review queue instead of an open platform-wide pool.
     * See README "Logistics-Reviewed Delivery Flow".
     */
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->foreignId('logistics_company_id')->nullable()->after('seller_id')
                ->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropConstrainedForeignId('logistics_company_id');
        });
    }
};
