<?php

namespace App\Http\Controllers\Api\Logistics;

use App\Http\Controllers\Controller;
use App\Http\Requests\Logistics\RejectRiderRequest;
use App\Mail\RiderApplicationStatus;
use App\Models\Courier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;

class RiderController extends Controller
{
    /**
     * GET /logistics/riders?status=pending
     * Only this company's own riders — scoped by logistics_company_id,
     * never another company's applicants.
     */
    public function index(Request $request): JsonResponse
    {
        $company = $request->user()->logisticsCompany;

        $couriers = $company->couriers()
            ->with('user:id,first_name,last_name,email,contact_no,status')
            ->whereHas('user', fn ($q) => $q->where('status', $request->query('status', 'pending')))
            ->latest()
            ->paginate(20);

        return $this->paginatedResponse($couriers->items(), $couriers);
    }

    public function show(Request $request, Courier $courier): JsonResponse
    {
        $this->ensureOwnRider($request, $courier);

        return response()->json(['courier' => $courier->load('user.address')]);
    }

    public function approve(Request $request, Courier $courier): JsonResponse
    {
        $this->ensureOwnRider($request, $courier);
        $this->ensurePending($courier);

        $courier->user->update(['status' => 'active']);
        $courier->update([
            'reviewed_by_user_id' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        Mail::to($courier->user->email)->send(new RiderApplicationStatus($courier->fresh(), 'approved'));

        return response()->json(['message' => 'Rider approved.']);
    }

    public function reject(RejectRiderRequest $request, Courier $courier): JsonResponse
    {
        $this->ensureOwnRider($request, $courier);
        $this->ensurePending($courier);

        $reason = $request->validated('reason');

        $courier->user->update(['status' => 'rejected']);
        $courier->update([
            'reviewed_by_user_id' => $request->user()->id,
            'reviewed_at' => now(),
            'rejection_reason' => $reason,
        ]);

        Mail::to($courier->user->email)->send(new RiderApplicationStatus($courier->fresh(), 'rejected', $reason));

        return response()->json(['message' => 'Rider application rejected.']);
    }

    protected function ensureOwnRider(Request $request, Courier $courier): void
    {
        if ($courier->logistics_company_id !== $request->user()->logisticsCompany->id) {
            abort(403, 'This rider did not apply to your company.');
        }
    }

    protected function ensurePending(Courier $courier): void
    {
        if ($courier->user->status !== 'pending') {
            abort(409, 'This rider has already been reviewed.');
        }
    }
}
