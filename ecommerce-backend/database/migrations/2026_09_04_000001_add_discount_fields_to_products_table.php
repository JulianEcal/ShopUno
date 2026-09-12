<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Product-level discount, deliberately modeled after how Shopee's
     * seller-side "Discount" tool works rather than a single flat
     * sale_price column, so it can cover both cases sellers actually want:
     *
     *   - An evergreen markdown ("this is just cheaper now") — set a type
     *     + value, leave both dates empty.
     *   - A scheduled flash-deal ("20% off this weekend only") — same,
     *     plus starts_at/ends_at. Nothing needs to run at exactly those
     *     moments; Product::isDiscountActive() just checks "is now inside
     *     this window", so the discount switches on/off automatically
     *     whenever anything reads it.
     *
     * discount_is_active is a separate on/off switch from the type/value
     * being set at all — it lets a seller pause a configured discount
     * (e.g. take it down for a day) without losing the numbers and having
     * to re-enter them later, same as Shopee's own toggle.
     */
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->enum('discount_type', ['percentage', 'fixed'])->nullable()->after('base_price');
            $table->decimal('discount_value', 10, 2)->nullable()->after('discount_type');
            $table->timestamp('discount_starts_at')->nullable()->after('discount_value');
            $table->timestamp('discount_ends_at')->nullable()->after('discount_starts_at');
            $table->boolean('discount_is_active')->default(true)->after('discount_ends_at');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn([
                'discount_type', 'discount_value', 'discount_starts_at', 'discount_ends_at', 'discount_is_active',
            ]);
        });
    }
};
