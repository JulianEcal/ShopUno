<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Snapshots the pre-discount price alongside the existing `unit_price`
     * (which already snapshots the price actually charged). Without this,
     * "you saved ₱X" on an order confirmation/history page would have to
     * be recomputed from the product's *current* discount config — which
     * silently breaks the moment a seller's discount later expires, gets
     * removed, or changes value. Nullable: equal to unit_price whenever an
     * item was bought at full price, so nothing downstream needs a null
     * check to treat "no discount" and "discount matched price" the same.
     */
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->decimal('original_unit_price', 10, 2)->nullable()->after('unit_price');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', function (Blueprint $table) {
            $table->dropColumn('original_unit_price');
        });
    }
};
