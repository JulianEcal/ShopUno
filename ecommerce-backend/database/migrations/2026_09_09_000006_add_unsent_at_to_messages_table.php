<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * "Unsending" a message (within 10 minutes of sending it — see
     * ConversationController::unsendMessage) doesn't delete the row: the
     * message stays in place so pagination/order never shifts for either
     * participant, but its content is wiped and `unsent_at` is stamped.
     * MessageResource treats a non-null `unsent_at` as the signal to
     * collapse the message into a placeholder for both sides.
     */
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->timestamp('unsent_at')->nullable()->after('attachment_type');
        });
    }

    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropColumn('unsent_at');
        });
    }
};
