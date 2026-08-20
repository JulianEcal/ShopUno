<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\FileComplaintRequest;
use App\Http\Resources\ComplaintResource;
use App\Models\Complaint;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ComplaintController extends Controller
{
    /** GET /my-complaints — complaints the current user filed. */
    public function index(Request $request): JsonResponse
    {
        $complaints = $request->user()->complaintsFiled()
            ->with(['against'])
            ->latest()
            ->paginate(20);

        return response()->json(['data' => ComplaintResource::collection($complaints)]);
    }

    public function show(Request $request, Complaint $complaint): JsonResponse
    {
        if ($complaint->filed_by_user_id !== $request->user()->id) {
            abort(403, 'This complaint does not belong to you.');
        }

        return response()->json([
            'complaint' => new ComplaintResource($complaint->load(['filedBy', 'against'])),
        ]);
    }

    public function store(FileComplaintRequest $request): JsonResponse
    {
        $complaint = Complaint::create([
            ...$request->validated(),
            'filed_by_user_id' => $request->user()->id,
            'status' => 'open',
        ]);

        return response()->json([
            'message' => 'Complaint filed. Our team will review it shortly.',
            'complaint' => new ComplaintResource($complaint),
        ], 201);
    }
}
