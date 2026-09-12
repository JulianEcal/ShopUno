<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Ties a conversation to the product it started from (e.g. the buyer
     * hit "Message" from a product's quick-view), same nullable/nullOnDelete
     * pattern as the existing order_id column — most conversations still
     * won't have one (general questions, order-scoped threads, etc).
     */
    public function up(): void
    {
        Schema::table('conversations', function (Blueprint $table) {
            $table->foreignId('product_id')->nullable()->after('order_id')
                ->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('conversations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('product_id');
        });
    }
};
