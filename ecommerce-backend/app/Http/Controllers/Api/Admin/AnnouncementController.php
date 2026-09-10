<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\SaveAnnouncementRequest;
use App\Models\Announcement;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AnnouncementController extends Controller
{
    /** GET /admin/announcements — includes unpublished/drafts, unlike the public endpoint. */
    public function index(): JsonResponse
    {
        $announcements = Announcement::with('admin:id,first_name,last_name')->latest()->paginate(20);

        return $this->paginatedResponse($announcements->items(), $announcements);
    }

    public function store(SaveAnnouncementRequest $request): JsonResponse
    {
        $announcement = Announcement::create([
            ...$request->validated(),
            'admin_id' => $request->user()->id,
            'is_published' => $request->boolean('is_published', true),
        ]);

        return response()->json([
            'message' => 'Announcement posted.',
            'announcement' => $announcement,
        ], 201);
    }

    public function update(SaveAnnouncementRequest $request, Announcement $announcement): JsonResponse
    {
        $announcement->update($request->validated());

        return response()->json([
            'message' => 'Announcement updated.',
            'announcement' => $announcement->fresh(),
        ]);
    }

    public function destroy(Announcement $announcement): JsonResponse
    {
        $announcement->delete();

        return response()->json(['message' => 'Announcement deleted.']);
    }
}
