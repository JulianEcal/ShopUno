<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('moderation_logs', function (Blueprint $table) {
            $table->id();

            // the account this action was taken on
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            // the admin who performed it
            $table->foreignId('admin_id')->constrained('users')->cascadeOnDelete();

            $table->enum('type', ['approve', 'reject', 'warn', 'activate', 'suspend', 'deactivate']);
            $table->text('note');

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('moderation_logs');
    }
};
