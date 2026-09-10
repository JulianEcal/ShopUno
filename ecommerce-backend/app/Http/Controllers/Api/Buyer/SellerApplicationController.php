<?php

namespace App\Http\Controllers\Api\Buyer;

use App\Http\Controllers\Controller;
use App\Http\Requests\Buyer\SellerApplicationRequest;
use App\Models\SellerApplication;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SellerApplicationController extends Controller
{
    /**
     * GET /me/seller-application
     * A buyer's own application status, if they've applied. Null if they
     * never have — the frontend uses this to decide whether to show
     * "Apply to become a Seller" or "Application pending/rejected".
     */
    public function show(Request $request): JsonResponse
    {
        $application = SellerApplication::where('user_id', $request->user()->id)->latest()->first();

        return response()->json([
            'application' => $application ? [
                'id' => $application->id,
                'business_name' => $application->business_name,
                'line_of_business' => $application->line_of_business,
                'status' => $application->status,
                'rejection_reason' => $application->rejection_reason,
                'submitted_at' => $application->created_at->toIso8601String(),
            ] : null,
        ]);
    }

    /**
     * POST /me/seller-application
     * Only an approved Buyer can apply, and only once at a time — a second
     * application while one is still pending is rejected outright rather
     * than silently creating a duplicate queue entry.
     */
    public function store(SellerApplicationRequest $request): JsonResponse
    {
        $user = $request->user();

        if ($user->role !== 'buyer') {
            abort(403, 'Only buyer accounts can apply to become a seller.');
        }

        $existing = SellerApplication::where('user_id', $user->id)->where('status', 'pending')->exists();
        if ($existing) {
            abort(409, 'You already have a pending seller application.');
        }

        $application = SellerApplication::create([
            'user_id' => $user->id,
            'business_name' => $request->validated('business_name'),
            'line_of_business' => $request->validated('line_of_business'),
            'business_permit_path' => $request->file('business_permit')->store('permits'),
            'status' => 'pending',
        ]);

        return response()->json([
            'message' => 'Seller application submitted. An admin will review it — you\'ll be notified by email.',
            'application_id' => $application->id,
        ], 201);
    }
}
