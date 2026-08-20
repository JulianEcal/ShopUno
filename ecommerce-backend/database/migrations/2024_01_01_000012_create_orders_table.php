<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('buyer_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('seller_id')->constrained()->cascadeOnDelete();

            $table->decimal('subtotal', 10, 2);
            $table->decimal('discount', 10, 2)->default(0);
            $table->decimal('total', 10, 2);

            // to_ship        -> order placed, seller preparing it
            // in_transit     -> handed to courier
            // out_for_delivery
            // delivered
            // cancelled
            $table->enum('status', ['to_ship', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled'])
                ->default('to_ship');

            // Cash on Delivery only — no payment gateway. is_paid flips true
            // the moment the order is marked delivered (cash collected then).
            // payment_method exists as a column (not just assumed) so a second
            // method could be added later without a schema change.
            $table->string('payment_method')->default('cod');
            $table->boolean('is_paid')->default(false);
            $table->timestamp('paid_at')->nullable();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('orders');
    }
};
