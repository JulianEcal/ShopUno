<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Shopee-style "option groups" for a product — e.g. a "Style" group with
 * values like "Only jersey" / "+#10 MBAPPÉ +UCL patch", and a separate
 * "Size" group with values like "S" / "M" / "L". A product can have at
 * most two option groups (matching Shopee's own limit); ProductVariation
 * rows are then the actual buyable combinations of one value from each
 * group, each with its own price adjustment and stock.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_options', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->string('name'); // e.g. "Style", "Size", "Color"
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

            $table->unique(['product_id', 'name']);
        });

        Schema::create('product_option_values', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_option_id')->constrained()->cascadeOnDelete();
            $table->string('value'); // e.g. "S", "Only jersey"
            $table->unsignedInteger('position')->default(0);
            // Optional swatch/reference photo for this specific value (e.g. the
            // photo for "+#10 MBAPPÉ +UCL patch") — falls back to the product's
            // cover image when unset, same idea as ProductVariation::image().
            $table->foreignId('product_image_id')->nullable()->constrained('product_images')->nullOnDelete();
            $table->timestamps();

            $table->unique(['product_option_id', 'value']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('product_option_values');
        Schema::dropIfExists('product_options');
    }
};
