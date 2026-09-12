<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\RejectSellerApplicationRequest;
use App\Mail\SellerApplicationApproved;
use App\Mail\SellerApplicationRejected;
use App\Models\Seller;
use App\Models\SellerApplication;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

class SellerApplicationController extends Controller
{
    /**
     * GET /admin/seller-applications?status=pending&search=
     * status=all (or omitted-then-explicitly-cleared by the frontend) skips
     * the status filter entirely, matching how the merged applicant queue's
     * "All" tile needs to pull every status when the caller asks for it.
     */
    public function index(Request $request): JsonResponse
    {
        $query = SellerApplication::query()->with('user:id,first_name,last_name,email,contact_no');

        $status = $request->query('status', 'pending');
        if ($status && $status !== 'all') {
            $query->where('status', $status);
        }

        if ($search = $request->query('search')) {
            $query->where(function ($q) use ($search) {
                $q->where('business_name', 'like', "%{$search}%")
                    ->orWhereHas('user', function ($uq) use ($search) {
                        $uq->where('first_name', 'like', "%{$search}%")
                            ->orWhere('last_name', 'like', "%{$search}%")
                            ->orWhere('email', 'like', "%{$search}%");
                    });
            });
        }

        $applications = $query->latest()->paginate(20);

        return $this->paginatedResponse($applications->items(), $applications);
    }

    public function show(SellerApplication $sellerApplication): JsonResponse
    {
        $sellerApplication->load('user.address');

        return response()->json([
            'application' => array_merge($sellerApplication->toArray(), [
                'permit_url' => $sellerApplication->permitUrl(),
            ]),
        ]);
    }

    /**
     * Approving does two things atomically: creates the Seller profile row
     * (business_name, line_of_business, permit) and flips the user's role
     * from buyer to seller. Until this runs, the account stays a fully
     * functional Buyer — applying doesn't touch their existing role.
     */
    public function approve(Request $request, SellerApplication $sellerApplication): JsonResponse
    {
        $this->ensurePending($sellerApplication);

        DB::transaction(function () use ($request, $sellerApplication) {
            Seller::create([
                'user_id' => $sellerApplication->user_id,
                'business_name' => $sellerApplication->business_name,
                'line_of_business' => $sellerApplication->line_of_business,
                'business_permit_path' => $sellerApplication->business_permit_path,
            ]);

            $sellerApplication->user->update(['role' => 'seller']);

            $sellerApplication->update([
                'status' => 'approved',
                'reviewed_by_admin_id' => $request->user()->id,
                'reviewed_at' => now(),
            ]);
        });

        Mail::to($sellerApplication->user->email)->send(new SellerApplicationApproved($sellerApplication->fresh()));

        return response()->json(['message' => 'Seller application approved. The account is now a Seller.']);
    }

    public function reject(RejectSellerApplicationRequest $request, SellerApplication $sellerApplication): JsonResponse
    {
        $this->ensurePending($sellerApplication);

        $sellerApplication->update([
            'status' => 'rejected',
            'rejection_reason' => $request->validated('reason'),
            'reviewed_by_admin_id' => $request->user()->id,
            'reviewed_at' => now(),
        ]);

        Mail::to($sellerApplication->user->email)->send(new SellerApplicationRejected($sellerApplication->fresh()));

        return response()->json(['message' => 'Seller application rejected.']);
    }

    protected function ensurePending(SellerApplication $application): void
    {
        if ($application->status !== 'pending') {
            abort(409, 'This application has already been reviewed.');
        }
    }
}
