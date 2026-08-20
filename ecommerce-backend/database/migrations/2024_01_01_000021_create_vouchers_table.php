<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vouchers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('seller_id')->constrained()->cascadeOnDelete();

            $table->string('code');
            $table->enum('type', ['percent', 'fixed']);
            $table->decimal('value', 10, 2); // percent: 0-100, fixed: currency amount
            $table->decimal('min_order_amount', 10, 2)->nullable();
            $table->unsignedInteger('max_uses')->nullable(); // null = unlimited
            $table->unsignedInteger('used_count')->default(0);
            $table->date('valid_until')->nullable();
            $table->boolean('is_active')->default(true);

            $table->timestamps();

            // Code only needs to be unique per seller — two different sellers
            // can both run a "WELCOME10" code without colliding.
            $table->unique(['seller_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vouchers');
    }
};
