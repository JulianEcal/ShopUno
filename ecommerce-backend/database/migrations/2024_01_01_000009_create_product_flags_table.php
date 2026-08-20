<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_flags', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->foreignId('admin_id')->constrained('users')->cascadeOnDelete();

            // flag    -> raised for review (e.g. category mismatch, prohibited item)
            // resolve -> admin reviewed, no action needed
            // archive -> admin force-removed the listing
            $table->enum('type', ['flag', 'resolve', 'archive']);
            $table->text('note');

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_flags');
    }
};
