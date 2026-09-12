<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Nullable + unique: nobody is required to pick one (registration never
     * asks for it), but once set it has to be unique so it can double as a
     * public handle. Self-service editing lives in AccountController::
     * updateProfile / UpdateProfileRequest.
     */
    public function up(): void
    {
        if (Schema::hasColumn('users', 'username')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->string('username')->nullable()->unique()->after('email');
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('users', 'username')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('username');
        });
    }
};
