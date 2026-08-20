<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Replaces the default Laravel users migration.
     * One table for all four roles (buyer/seller/courier/admin) — role-specific
     * fields live in sellers / couriers. Admin has no extension table.
     */
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();

            $table->string('last_name');
            $table->string('first_name');
            $table->string('middle_initial')->nullable();
            $table->enum('sex', ['male', 'female']);

            $table->string('email')->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password');

            $table->string('contact_no');
            $table->date('birthday');
            $table->unsignedTinyInteger('age');
            $table->string('upload_id_path')->nullable();

            $table->enum('role', ['buyer', 'seller', 'courier', 'admin']);

            // pending/rejected           -> registration workflow
            // active/suspended/deactivated -> account management (post-approval)
            $table->enum('status', [
                'pending', 'rejected',
                'active', 'suspended', 'deactivated',
            ])->default('pending');

            $table->rememberToken();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
