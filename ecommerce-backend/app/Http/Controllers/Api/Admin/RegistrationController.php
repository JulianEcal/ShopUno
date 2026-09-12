<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\RejectRegistrationRequest;
use App\Http\Resources\UserResource;
use App\Mail\RegistrationApproved;
use App\Mail\RegistrationRejected;
use App\Models\ModerationLog;
use App\Models\SellerApplication;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

class RegistrationController extends Controller
{
    /**
     * GET /admin/registrations?status=pending&role=logistics&search=
     * In practice this only ever queues Logistics applicants — Buyer
     * auto-approves and never appears here, Courier is reviewed by its
     * Logistics company (not admin), and Seller was never a registration
     * type to begin with. The ?role= filter still works generically in
     * case that ever changes, but Logistics is the only role you'll see.
     * Defaults to pending, since that's the queue admins actually review.
     */
    public function index(Request $request): JsonResponse
    {
        $query = User::query()
            ->with(['address', 'seller', 'courier.logisticsCompany', 'logisticsCompany'])
            ->where('status', $request->query('status', 'pending'));

        if ($role = $request->query('role')) {
            $query->where('role', $role);
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('first_name', 'like', "%{$search}%")
                  ->orWhere('last_name', 'like', "%{$search}%")
                  ->orWhere('email', 'like', "%{$search}%");
            });
        }

        $users = $query->latest()->paginate(20);

        return $this->paginatedResponse(UserResource::collection($users), $users);
    }

    /**
     * GET /admin/registrations/counts?status=pending
     * Per-role tallies for the applicant queue's role tiles. Seller has no
     * rows in the `users` table at this status (Seller Applications is a
     * separate table entirely — see SellerApplicationController), so its
     * count is pulled from there and folded in alongside buyer/courier/
     * logistics. This lets the frontend badge all five tiles (four roles +
     * "All") from a single request instead of firing one list call per tile.
     */
    public function counts(Request $request): JsonResponse
    {
        $status = $request->query('status', 'pending');
        // Registrations uses 'active' for an approved account; Seller
        // Applications uses 'approved' for the same idea — map so a single
        // status tab on the frontend can drive both queries correctly.
        $sellerStatus = $status === 'active' ? 'approved' : $status;

        $byRole = User::where('status', $status)
            ->selectRaw('role, count(*) as count')
            ->groupBy('role')
            ->pluck('count', 'role');

        $counts = [
            'buyer' => $byRole['buyer'] ?? 0,
            'seller' => SellerApplication::where('status', $sellerStatus)->count(),
            'courier' => $byRole['courier'] ?? 0,
            'logistics' => $byRole['logistics'] ?? 0,
        ];
        $counts['all'] = array_sum($counts);

        return response()->json(['counts' => $counts]);
    }

    public function show(User $user): JsonResponse
    {
        return response()->json([
            'user' => new UserResource($user->load(['address', 'seller', 'courier.logisticsCompany', 'logisticsCompany'])),
        ]);
    }

    public function approve(Request $request, User $user): JsonResponse
    {
        $this->ensurePending($user);

        DB::transaction(function () use ($request, $user) {
            $user->update(['status' => 'active']);

            ModerationLog::create([
                'user_id' => $user->id,
                'admin_id' => $request->user()->id,
                'type' => 'approve',
                'note' => 'Registration approved.',
            ]);
        });

        Mail::to($user->email)->send(new RegistrationApproved($user));

        return response()->json([
            'message' => 'Applicant approved.',
            'user' => new UserResource($user->fresh()),
        ]);
    }

    public function reject(RejectRegistrationRequest $request, User $user): JsonResponse
    {
        $this->ensurePending($user);

        $reason = $request->validated('reason');

        DB::transaction(function () use ($request, $user, $reason) {
            $user->update(['status' => 'rejected']);

            ModerationLog::create([
                'user_id' => $user->id,
                'admin_id' => $request->user()->id,
                'type' => 'reject',
                'note' => $reason,
            ]);
        });

        Mail::to($user->email)->send(new RegistrationRejected($user, $reason));

        return response()->json([
            'message' => 'Applicant rejected.',
            'user' => new UserResource($user->fresh()),
        ]);
    }

    protected function ensurePending(User $user): void
    {
        if ($user->status !== 'pending') {
            abort(409, 'This applicant has already been reviewed.');
        }
    }
}
