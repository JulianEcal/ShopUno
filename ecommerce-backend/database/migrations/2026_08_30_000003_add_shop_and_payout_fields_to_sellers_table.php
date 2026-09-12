<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Rounds out the seller account page beyond the bare compliance fields
     * (business_name/line_of_business/permit) it shipped with:
     *   - shop_description + banner_path: storefront copy buyers see when
     *     browsing a shop, same public-disk pattern as users.avatar_path
     *     (see Seller::getBannerUrlAttribute).
     *   - payout_* : how the seller actually gets paid. Nullable because a
     *     newly-approved seller hasn't set this up yet — the frontend
     *     nudges them to, but nothing blocks on it existing.
     */
    public function up(): void
    {
        Schema::table('sellers', function (Blueprint $table) {
            $table->text('shop_description')->nullable()->after('line_of_business');
            $table->string('banner_path')->nullable()->after('shop_description');

            $table->string('payout_method')->nullable()->after('banner_path'); // bank | gcash | maya
            $table->string('payout_account_name')->nullable()->after('payout_method');
            $table->string('payout_account_number')->nullable()->after('payout_account_name');
            $table->string('payout_bank_name')->nullable()->after('payout_account_number'); // only relevant when payout_method = bank
        });
    }

    public function down(): void
    {
        Schema::table('sellers', function (Blueprint $table) {
            $table->dropColumn([
                'shop_description', 'banner_path',
                'payout_method', 'payout_account_name', 'payout_account_number', 'payout_bank_name',
            ]);
        });
    }
};
