<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Turns each product_variations row from a single flat (type, value) pair
 * into an actual purchasable combination of up to two option values — e.g.
 * "Style: +#10 MBAPPÉ +UCL patch" AND "Size: S" together, as one row with
 * its own stock. option_value_2_id stays null for products with only one
 * option group.
 *
 * variation_type/value are kept (not dropped — SQLite can't drop columns
 * without doctrine/dbal) and are now auto-populated as a human-readable
 * combo label such as "Style: Only jersey / Size: S", purely for display
 * in places that haven't been updated to read the option relations yet.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_variations', function (Blueprint $table) {
            $table->foreignId('option_value_1_id')->nullable()->after('product_id')
                ->constrained('product_option_values')->cascadeOnDelete();
            $table->foreignId('option_value_2_id')->nullable()->after('option_value_1_id')
                ->constrained('product_option_values')->cascadeOnDelete();
            $table->string('sku')->nullable()->after('option_value_2_id');
        });

        // A given pair of option values can only back one SKU row per product.
        // Nulls are exempt from uniqueness in SQLite/MySQL, so this doesn't
        // interfere with old-style or option-less rows.
        Schema::table('product_variations', function (Blueprint $table) {
            $table->unique(['product_id', 'option_value_1_id', 'option_value_2_id'], 'product_variations_combo_unique');
        });
    }

    public function down(): void
    {
        Schema::table('product_variations', function (Blueprint $table) {
            $table->dropUnique('product_variations_combo_unique');
            $table->dropConstrainedForeignId('option_value_1_id');
            $table->dropConstrainedForeignId('option_value_2_id');
            $table->dropColumn('sku');
        });
    }
};
