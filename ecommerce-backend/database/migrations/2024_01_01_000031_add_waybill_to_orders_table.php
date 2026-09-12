<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Backs the last unbuilt Seller function from the checklist:
     * "Prepare orders — pack items, print waybill/shipping label."
     *
     * The waybill number is generated once (on first print) and then
     * reused on every subsequent reprint — it's a durable label/tracking
     * number for the physical package, not something that should change
     * every time a seller opens the print view. See
     * Seller\OrderController::waybill().
     */
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('waybill_number')->nullable()->unique()->after('logistics_company_id');
            $table->timestamp('waybill_generated_at')->nullable()->after('waybill_number');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropUnique(['waybill_number']);
            $table->dropColumn(['waybill_number', 'waybill_generated_at']);
        });
    }
};
