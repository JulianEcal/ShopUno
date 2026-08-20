<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\AccountActionRequest;
use App\Http\Resources\UserResource;
use App\Mail\AccountStatusChanged;
use App\Models\ModerationLog;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

class AccountController extends Controller
{
    /**
     * GET /admin/accounts?role=&status=&search=
     * Anyone who's been through registration already (i.e. not 'pending' —
     * that queue is the Registrations controller's job) and isn't an admin.
     */
    public function index(Request $request): JsonResponse
    {
        $query = User::query()
            ->with(['address', 'seller', 'courier'])
            ->where('role', '!=', 'admin')
            ->where('status', '!=', 'pending');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

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
        $this->ensureManageable($user);

        return response()->json([
            'user' => new UserResource($user->load(['address', 'seller', 'courier'])),
            'moderation_log' => $user->moderationLogs()->with('admin:id,first_name,last_name')->latest()->get(),
        ]);
    }

    /** Logs a warning. Does NOT change account status. */
    public function warn(AccountActionRequest $request, User $user): JsonResponse
    {
        $this->ensureManageable($user);

        $this->logAndNotify($request, $user, 'warn');

        return response()->json([
            'message' => 'Warning issued.',
            'user' => new UserResource($user->fresh()),
        ]);
    }

    /** Reactivates a suspended or deactivated account. Note is optional. */
    public function activate(Request $request, User $user): JsonResponse
    {
        $this->ensureManageable($user);

        $note = (string) $request->input('note', '');

        DB::transaction(function () use ($request, $user, $note) {
            $user->update(['status' => 'active']);

            ModerationLog::create([
                'user_id' => $user->id,
                'admin_id' => $request->user()->id,
                'type' => 'activate',
                'note' => $note ?: 'Account activated.',
            ]);
        });

        Mail::to($user->email)->send(new AccountStatusChanged($user, 'activate', $note));

        return response()->json([
            'message' => 'Account activated.',
            'user' => new UserResource($user->fresh()),
        ]);
    }

    public function suspend(AccountActionRequest $request, User $user): JsonResponse
    {
        $this->ensureManageable($user);

        $this->changeStatus($request, $user, 'suspended', 'suspend');

        return response()->json([
            'message' => 'Account suspended.',
            'user' => new UserResource($user->fresh()),
        ]);
    }

    public function deactivate(AccountActionRequest $request, User $user): JsonResponse
    {
        $this->ensureManageable($user);

        $this->changeStatus($request, $user, 'deactivated', 'deactivate');

        return response()->json([
            'message' => 'Account deactivated.',
            'user' => new UserResource($user->fresh()),
        ]);
    }

    protected function changeStatus(AccountActionRequest $request, User $user, string $status, string $logType): void
    {
        $note = $request->validated('note');

        DB::transaction(function () use ($request, $user, $status, $logType, $note) {
            $user->update(['status' => $status]);

            ModerationLog::create([
                'user_id' => $user->id,
                'admin_id' => $request->user()->id,
                'type' => $logType,
                'note' => $note,
            ]);
        });

        Mail::to($user->email)->send(new AccountStatusChanged($user, $logType, $note));
    }

    protected function logAndNotify(AccountActionRequest $request, User $user, string $type): void
    {
        $note = $request->validated('note');

        ModerationLog::create([
            'user_id' => $user->id,
            'admin_id' => $request->user()->id,
            'type' => $type,
            'note' => $note,
        ]);

        Mail::to($user->email)->send(new AccountStatusChanged($user, $type, $note));
    }

    protected function ensureManageable(User $user): void
    {
        if ($user->role === 'admin') {
            abort(403, 'Admin accounts cannot be managed through this endpoint.');
        }

        if ($user->status === 'pending') {
            abort(409, 'This account is still a pending registration — use /admin/registrations instead.');
        }
    }
}
