<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Replaces the default Laravel users migration.
     * One table for all five roles (buyer/seller/courier/logistics/admin) —
     * role-specific fields live in sellers / couriers / logistics_companies.
     * Admin has no extension table.
     *
     * Registration model (per project decision — see README "Roles &
     * Registration Flow"): Buyer and Logistics register directly with the
     * platform. Seller is an UPGRADE applied for from an existing Buyer
     * account (see seller_applications table), not a registration type.
     * Courier applies to a specific Logistics company, not the platform.
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

            $table->enum('role', ['buyer', 'seller', 'courier', 'logistics', 'admin']);

            // pending/rejected           -> registration workflow (logistics, courier)
            //                                buyers skip this — see RegistrationController::buyer()
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
