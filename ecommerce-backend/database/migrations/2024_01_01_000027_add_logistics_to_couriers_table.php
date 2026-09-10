<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Couriers now apply to a specific logistics company rather than
     * registering directly with the platform or per-seller. This has to be
     * a separate migration (not edited into the original couriers table)
     * because logistics_companies didn't exist yet at that point in the
     * migration order — couriers was created early, logistics_companies
     * came later. Altering an existing table once other migrations
     * depend on it is the correct approach, not going back to edit history.
     */
    public function up(): void
    {
        Schema::table('couriers', function (Blueprint $table) {
            $table->foreignId('logistics_company_id')->after('user_id')
                ->constrained()->cascadeOnDelete();

            // Riders are reviewed by the logistics company they applied to,
            // not platform admin — see LogisticsRiderController. Kept here
            // rather than reusing moderation_logs, since that table is for
            // platform-admin actions specifically.
            $table->foreignId('reviewed_by_user_id')->nullable()->after('is_available')
                ->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable()->after('reviewed_by_user_id');
            $table->text('rejection_reason')->nullable()->after('reviewed_at');
        });
    }

    public function down(): void
    {
        Schema::table('couriers', function (Blueprint $table) {
            $table->dropConstrainedForeignId('logistics_company_id');
            $table->dropConstrainedForeignId('reviewed_by_user_id');
            $table->dropColumn(['reviewed_at', 'rejection_reason']);
        });
    }
};
