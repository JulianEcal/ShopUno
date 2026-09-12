<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('message_reactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('message_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // A short emoji string (e.g. "👍") rather than a fixed enum —
            // keeps the reaction picker free to offer whatever set the
            // frontend wants without a migration every time it changes.
            $table->string('emoji', 16);
            $table->timestamps();

            // One of each emoji per user per message — tapping the same
            // reaction again is a toggle (handled in the controller), not
            // a duplicate row.
            $table->unique(['message_id', 'user_id', 'emoji']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('message_reactions');
    }
};
