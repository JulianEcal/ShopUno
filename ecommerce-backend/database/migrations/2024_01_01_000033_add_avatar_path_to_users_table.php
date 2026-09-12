<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Stores the local relative path (e.g. "avatars/xyz.jpg") on the
     * PUBLIC disk, same convention as ProductImage::path — profile
     * pictures aren't sensitive like upload_id_path/business_permit_path,
     * so there's no need to gate them behind a signed URL. Resolved to a
     * full URL via User::getAvatarUrlAttribute(), exposed as `avatar_url`
     * on UserResource.
     */
    public function up(): void
    {
        if (Schema::hasColumn('users', 'avatar_path')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->string('avatar_path')->nullable()->after('upload_id_path');
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('users', 'avatar_path')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('avatar_path');
        });
    }
};
