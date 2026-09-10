<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Scopes a conversation to the specific variant it started from (e.g.
     * "Small / Jersey Only"), not just the product. Without this, every
     * variant of the same product folded into one thread — a buyer asking
     * about a different size/style got silently dropped into whatever
     * conversation already existed for that product. Nullable/nullOnDelete,
     * same pattern as order_id and product_id: most conversations still
     * won't have one (general questions, order-scoped threads, products
     * with no variants at all).
     */
    public function up(): void
    {
        Schema::table('conversations', function (Blueprint $table) {
            $table->foreignId('product_variation_id')->nullable()->after('product_id')
                ->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('conversations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('product_variation_id');
        });
    }
};
