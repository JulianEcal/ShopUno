<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DocumentRequirementsController extends Controller
{
    /**
     * GET /document-requirements            -> all roles
     * GET /document-requirements?role=seller -> just one role
     *
     * Public and unauthenticated on purpose — the registration form needs
     * this before an account exists, so both the web and Flutter registration
     * screens can render "what you'll need" without hardcoding it twice.
     */
    public function index(Request $request): JsonResponse
    {
        $requirements = config('documents.requirements');

        if ($role = $request->query('role')) {
            $requirements = [$role => $requirements[$role] ?? []];
        }

        return response()->json([
            'max_size_mb' => config('documents.max_size_kb') / 1024,
            'accepted_formats' => config('documents.accepted_extensions'),
            'accepted_formats_label' => config('documents.accepted_formats_label'),
            'requirements' => $requirements,
        ]);
    }
}
