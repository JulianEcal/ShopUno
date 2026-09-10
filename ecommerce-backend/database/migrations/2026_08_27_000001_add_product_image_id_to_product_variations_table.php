<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_variations', function (Blueprint $table) {
            // Nullable — a variation doesn't have to point at a specific photo,
            // it just falls back to the product's cover image on the storefront.
            // nullOnDelete (not cascade): removing the photo shouldn't take the
            // variation down with it, it should just fall back to the cover image.
            $table->foreignId('product_image_id')->nullable()->after('product_id')
                ->constrained('product_images')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('product_variations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('product_image_id');
        });
    }
};
