<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Profile picture, stored on the PUBLIC disk (unlike upload_id_path and
     * the other verification documents, which live on the private 'local'
     * disk behind signed URLs). An avatar isn't sensitive the way a
     * government ID is, so it's served as a plain public URL instead of
     * going through DocumentController.
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
