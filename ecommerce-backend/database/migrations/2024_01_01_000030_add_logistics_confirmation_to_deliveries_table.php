<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A Delivery no longer opens straight to every courier the moment a
     * seller marks an order ready. It now starts as
     * 'awaiting_logistics_confirmation' — visible only to the specific
     * logistics company the buyer chose at checkout — and only becomes
     * 'pending' (rider-visible, scoped to that same company) once the
     * company itself confirms it's ready to ship. This collapses the
     * "assign sorting center / starts order transfer / arrives sorting
     * center" steps from the flowchart into that one confirm action —
     * a deliberate simplification (status flag, not a real sorting-center
     * entity), per project decision. See README.
     */
    public function up(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->foreignId('logistics_company_id')->nullable()->after('order_id')
                ->constrained()->nullOnDelete();
            $table->foreignId('confirmed_by_user_id')->nullable()->after('courier_id')
                ->constrained('users')->nullOnDelete();
            $table->timestamp('confirmed_at')->nullable()->after('confirmed_by_user_id');
        });

        // Laravel's schema builder can't modify an existing enum's allowed
        // values, so this is raw SQL — MySQL-specific (matches this
        // project's DB_CONNECTION). Adding 'awaiting_logistics_confirmation'
        // as the new default first stage.
        DB::statement("
            ALTER TABLE deliveries
            MODIFY status ENUM(
                'awaiting_logistics_confirmation',
                'pending',
                'accepted',
                'picked_up',
                'out_for_delivery',
                'delivered'
            ) NOT NULL DEFAULT 'awaiting_logistics_confirmation'
        ");
    }

    public function down(): void
    {
        DB::statement("
            ALTER TABLE deliveries
            MODIFY status ENUM('pending', 'accepted', 'picked_up', 'out_for_delivery', 'delivered')
            NOT NULL DEFAULT 'pending'
        ");

        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropConstrainedForeignId('logistics_company_id');
            $table->dropConstrainedForeignId('confirmed_by_user_id');
            $table->dropColumn('confirmed_at');
        });
    }
};
