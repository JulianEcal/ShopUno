<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Complaint;
use App\Models\ModerationLog;
use App\Models\Order;
use App\Models\ProductFlag;
use App\Models\SellerApplication;
use App\Models\User;
use Illuminate\Http\JsonResponse;

class DashboardController extends Controller
{
    /**
     * GET /admin/dashboard
     * Everything here is a count or a small recent-activity feed pulled from
     * tables that already exist — no new tables needed for this endpoint.
     *
     * Updated for the roles overhaul: pending_registrations now only ever
     * reflects Logistics applicants in practice (Buyer auto-approves,
     * Courier is reviewed by its Logistics company, not admin) — so Seller
     * Applications gets counted as its own queue instead of being invisible.
     */
    public function index(): JsonResponse
    {
        $pendingSellerApplications = SellerApplication::where('status', 'pending')->count();

        return response()->json([
            'counts' => [
                'pending_registrations' => $this->countByRole(User::where('status', 'pending')),
                'pending_seller_applications' => $pendingSellerApplications,
                'active_users' => $this->countByRole(User::where('role', '!=', 'admin')->where('status', 'active')),
                'suspended_or_deactivated' => User::whereIn('status', ['suspended', 'deactivated'])->count(),
                'open_complaints' => Complaint::where('status', 'open')->count(),
                'complaints_under_review' => Complaint::where('status', 'under_review')->count(),
                'flagged_products' => $this->currentlyFlaggedProductCount(),
                'orders_today' => Order::whereDate('created_at', today())->count(),
                'orders_this_week' => Order::where('created_at', '>=', now()->startOfWeek())->count(),
            ],

            // Things an admin would want a badge/notification for — same
            // numbers as above, just reshaped as a flat "needs attention" list.
            'needs_attention' => array_filter([
                'pending_registrations' => User::where('status', 'pending')->count(),
                'pending_seller_applications' => $pendingSellerApplications,
                'open_complaints' => Complaint::where('status', 'open')->count(),
                'flagged_products' => $this->currentlyFlaggedProductCount(),
            ], fn ($count) => $count > 0),

            'recent_activity' => $this->recentActivity(),
        ]);
    }

    /**
     * Built from whichever roles actually appear in the result, rather than
     * a hardcoded buyer/seller/courier list — that list went stale the
     * moment Logistics was added and Seller stopped being reachable here.
     */
    protected function countByRole($query): array
    {
        $counts = (clone $query)->selectRaw('role, count(*) as count')->groupBy('role')->pluck('count', 'role');

        return [
            'buyer' => $counts['buyer'] ?? 0,
            'seller' => $counts['seller'] ?? 0,
            'courier' => $counts['courier'] ?? 0,
            'logistics' => $counts['logistics'] ?? 0,
            'total' => $counts->sum(),
        ];
    }

    /** Products whose most recent flag entry is still 'flag' (not resolved/archived since). */
    protected function currentlyFlaggedProductCount(): int
    {
        $latestFlagIds = ProductFlag::selectRaw('MAX(id) as id')->groupBy('product_id');

        return ProductFlag::whereIn('id', $latestFlagIds)->where('type', 'flag')->count();
    }

    /** Last 10 admin-relevant events across moderation, compliance, and complaints — merged and sorted. */
    protected function recentActivity(): array
    {
        $moderation = ModerationLog::with('user:id,first_name,last_name', 'admin:id,first_name,last_name')
            ->latest()->limit(5)->get()
            ->map(fn ($log) => [
                'type' => 'moderation',
                'action' => $log->type,
                'summary' => "{$log->admin->first_name} {$log->admin->last_name} {$log->type}ed {$log->user->first_name} {$log->user->last_name}",
                'note' => $log->note,
                'created_at' => $log->created_at,
            ]);

        $flags = ProductFlag::with('product:id,name', 'admin:id,first_name,last_name')
            ->latest()->limit(5)->get()
            ->map(fn ($flag) => [
                'type' => 'compliance',
                'action' => $flag->type,
                'summary' => "{$flag->admin->first_name} {$flag->admin->last_name} {$flag->type}ged \"{$flag->product->name}\"",
                'note' => $flag->note,
                'created_at' => $flag->created_at,
            ]);

        $complaints = Complaint::with('filedBy:id,first_name,last_name')
            ->latest()->limit(5)->get()
            ->map(fn ($c) => [
                'type' => 'complaint',
                'action' => $c->status,
                'summary' => "{$c->filedBy->first_name} {$c->filedBy->last_name} filed \"{$c->subject}\"",
                'note' => null,
                'created_at' => $c->created_at,
            ]);

        $sellerApplications = SellerApplication::with('user:id,first_name,last_name')
            ->whereIn('status', ['approved', 'rejected'])
            ->latest('reviewed_at')->limit(5)->get()
            ->map(fn ($app) => [
                'type' => 'seller_application',
                'action' => $app->status,
                'summary' => "{$app->user->first_name} {$app->user->last_name}'s application for \"{$app->business_name}\" was {$app->status}",
                'note' => $app->rejection_reason,
                'created_at' => $app->reviewed_at ?? $app->updated_at,
            ]);

        return $moderation->concat($flags)->concat($complaints)->concat($sellerApplications)
            ->sortByDesc('created_at')
            ->take(10)
            ->values()
            ->map(fn ($item) => [...$item, 'created_at' => $item['created_at']?->toIso8601String()])
            ->all();
    }
}
