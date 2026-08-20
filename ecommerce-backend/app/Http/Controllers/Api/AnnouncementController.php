<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use Illuminate\Http\JsonResponse;

class AnnouncementController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'data' => Announcement::published()->latest()->get(['id', 'title', 'body', 'created_at']),
        ]);
    }
}
