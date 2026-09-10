<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Models\Courier;
use App\Models\LogisticsCompany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LogisticsOversightController extends Controller
{
    /**
     * GET /admin/logistics-companies?search=
     * Every logistics company on the platform, with a quick rider-count
     * breakdown — admin's "who's operating and how big are they" view.
     * Approving/rejecting the COMPANY itself still goes through the normal
     * /admin/registrations queue; this is a read-only operational view.
     */
    public function companies(Request $request): JsonResponse
    {
        $query = LogisticsCompany::query()->with('user:id,first_name,last_name,email,status');

        if ($search = $request->query('search')) {
            $query->where('company_name', 'like', "%{$search}%");
        }

        $companies = $query->withCount([
            'couriers as total_riders',
            'couriers as pending_riders' => fn ($q) => $q->whereHas('user', fn ($u) => $u->where('status', 'pending')),
            'couriers as active_riders' => fn ($q) => $q->whereHas('user', fn ($u) => $u->where('status', 'active')),
        ])->latest()->paginate(20);

        return $this->paginatedResponse($companies->items(), $companies);
    }

    public function company(LogisticsCompany $logisticsCompany): JsonResponse
    {
        return response()->json([
            'company' => $logisticsCompany->load('user.address'),
            'riders' => $logisticsCompany->couriers()->with('user:id,first_name,last_name,email,status')->latest()->get(),
        ]);
    }

    /**
     * GET /admin/riders?company_id=&status=&search=
     * Every rider across every logistics company, in one place — this is
     * the actual "oversight" piece: admin can audit patterns (a company
     * approving everyone instantly, one with an unusually high rejection
     * rate, etc.) without being the one who has to review each applicant.
     *
     * Deliberately NO approve/reject here — that authority stays with the
     * logistics company the rider applied to (see Logistics\RiderController).
     * This is visibility, not override.
     */
    public function riders(Request $request): JsonResponse
    {
        $query = Courier::query()
            ->with(['user:id,first_name,last_name,email,status', 'logisticsCompany:id,company_name', 'reviewedBy:id,first_name,last_name']);

        if ($companyId = $request->query('company_id')) {
            $query->where('logistics_company_id', $companyId);
        }

        if ($status = $request->query('status')) {
            $query->whereHas('user', fn ($q) => $q->where('status', $status));
        }

        if ($search = $request->query('search')) {
            $query->whereHas('user', fn ($q) => $q
                ->where('first_name', 'like', "%{$search}%")
                ->orWhere('last_name', 'like', "%{$search}%"));
        }

        $riders = $query->latest()->paginate(20);

        return $this->paginatedResponse($riders->items(), $riders);
    }

    public function rider(Courier $courier): JsonResponse
    {
        return response()->json([
            'rider' => $courier->load(['user.address', 'logisticsCompany', 'reviewedBy:id,first_name,last_name']),
        ]);
    }
}
