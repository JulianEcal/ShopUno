<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // Defaults to true so every product that already exists — and is
            // therefore already live in front of buyers today — stays exactly
            // as visible as it is right now once this migration runs. Brand
            // new products are explicitly created with this set to false in
            // Seller\ProductController::store(); nothing in the request
            // payload can set it directly, only the dedicated publish()
            // endpoint can flip it to true. There's no admin-approval step —
            // publishing is entirely the seller's own call.
            $table->boolean('is_published')->default(true)->after('is_archived');
            $table->timestamp('published_at')->nullable()->after('is_published');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn(['is_published', 'published_at']);
        });
    }
};
