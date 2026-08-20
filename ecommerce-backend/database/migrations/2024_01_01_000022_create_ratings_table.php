<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ratings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('rated_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('rated_user_id')->constrained('users')->cascadeOnDelete();

            $table->unsignedTinyInteger('score'); // 1-5
            $table->text('feedback')->nullable();

            $table->timestamps();

            // One rating per person-being-rated per order — e.g. once
            // couriers exist, a buyer can rate the seller AND the courier
            // for the same order (two rows), but not rate the same seller twice.
            $table->unique(['order_id', 'rated_user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ratings');
    }
};
