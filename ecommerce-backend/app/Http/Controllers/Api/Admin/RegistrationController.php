<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\RejectRegistrationRequest;
use App\Http\Resources\UserResource;
use App\Mail\RegistrationApproved;
use App\Mail\RegistrationRejected;
use App\Models\ModerationLog;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

class RegistrationController extends Controller
{
    /**
     * GET /admin/registrations?status=pending&role=seller&search=
     * Defaults to pending, since that's the queue admins actually review.
     */
    public function index(Request $request): JsonResponse
    {
        $query = User::query()
            ->with(['address', 'seller', 'courier'])
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

        return response()->json([
            'data' => UserResource::collection($query->latest()->paginate(20)),
        ]);
    }

    public function show(User $user): JsonResponse
    {
        return response()->json([
            'user' => new UserResource($user->load(['address', 'seller', 'courier'])),
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
