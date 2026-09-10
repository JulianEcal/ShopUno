<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Orders used to have no shipping address of their own at all — every
 * screen that needed one (buyer order view, seller waybill, ...) just
 * read the buyer's live `address` relation. That breaks the moment a
 * buyer can have MULTIPLE saved addresses: which one did THIS order
 * actually ship to? And even with a single address, it broke silently
 * whenever a buyer edited or deleted their address after ordering — old
 * orders would retroactively show the new address, or none at all.
 *
 * Fix: snapshot the chosen address onto the order itself at checkout
 * (same pattern already used for order_items.original_unit_price — see
 * that migration's note). `shipping_address_id` is kept too, but only
 * as a soft, nullable back-reference for convenience; it is intentionally
 * NOT a foreign key with cascade rules, since the address it points to
 * may later be edited or deleted without that ever being allowed to
 * touch historical order data.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->unsignedBigInteger('shipping_address_id')->nullable()->after('logistics_company_id');
            $table->string('shipping_label')->nullable()->after('shipping_address_id');
            $table->string('shipping_recipient_name')->nullable()->after('shipping_label');
            $table->string('shipping_recipient_phone')->nullable()->after('shipping_recipient_name');
            $table->string('shipping_province')->nullable()->after('shipping_recipient_phone');
            $table->string('shipping_municipality')->nullable()->after('shipping_province');
            $table->string('shipping_barangay')->nullable()->after('shipping_municipality');
            $table->string('shipping_street')->nullable()->after('shipping_barangay');
            $table->string('shipping_house_number')->nullable()->after('shipping_street');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn([
                'shipping_address_id', 'shipping_label', 'shipping_recipient_name', 'shipping_recipient_phone',
                'shipping_province', 'shipping_municipality', 'shipping_barangay', 'shipping_street', 'shipping_house_number',
            ]);
        });
    }
};
