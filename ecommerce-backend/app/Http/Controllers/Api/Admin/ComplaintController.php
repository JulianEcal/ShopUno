<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ResolveComplaintRequest;
use App\Http\Resources\ComplaintResource;
use App\Mail\ComplaintResolved;
use App\Models\Complaint;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;

class ComplaintController extends Controller
{
    /** GET /admin/complaints?status=open&search= */
    public function index(Request $request): JsonResponse
    {
        $query = Complaint::query()->with(['filedBy', 'against', 'order']);

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        if ($search = $request->query('search')) {
            $query->where('subject', 'like', "%{$search}%");
        }

        return response()->json([
            'data' => ComplaintResource::collection($query->latest()->paginate(20)),
        ]);
    }

    public function show(Complaint $complaint): JsonResponse
    {
        return response()->json([
            'complaint' => new ComplaintResource($complaint->load(['filedBy', 'against', 'order'])),
        ]);
    }

    /**
     * Moves a complaint to 'under_review' (just acknowledging it's being looked
     * at) or 'resolved' (requires resolution_notes, emails the filer).
     */
    public function resolve(ResolveComplaintRequest $request, Complaint $complaint): JsonResponse
    {
        $status = $request->validated('status');

        $complaint->update([
            'status' => $status,
            'resolution_notes' => $request->validated('resolution_notes'),
            'resolved_by_admin_id' => $status === 'resolved' ? $request->user()->id : null,
            'resolved_at' => $status === 'resolved' ? now() : null,
        ]);

        if ($status === 'resolved') {
            $complaint->loadMissing('filedBy');
            Mail::to($complaint->filedBy->email)->send(new ComplaintResolved($complaint));
        }

        return response()->json([
            'message' => "Complaint marked as {$status}.",
            'complaint' => new ComplaintResource($complaint->fresh(['filedBy', 'against', 'order'])),
        ]);
    }
}
