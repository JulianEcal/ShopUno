<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Before this, a seller's shop logo was just users.avatar_path — the
     * same photo shown for that person as a buyer everywhere else in the
     * app (nav avatar, message bubbles). That meant a buyer's personal
     * profile picture and their shop's public logo could never be
     * different. This gives the shop its own logo_path, same public-disk
     * pattern as banner_path (see Seller::getLogoUrlAttribute), fully
     * independent of the user's own avatar_path.
     */
    public function up(): void
    {
        Schema::table('sellers', function (Blueprint $table) {
            $table->string('logo_path')->nullable()->after('banner_path');
        });
    }

    public function down(): void
    {
        Schema::table('sellers', function (Blueprint $table) {
            $table->dropColumn('logo_path');
        });
    }
};
