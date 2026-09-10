<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreAvatarRequest;
use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Profile pictures, like product photos, are PUBLIC on purpose — shown in
 * headers/badges without a signed URL — so this uses the same 'public'
 * disk + path-on-model pattern as Seller\ProductImageController, just with
 * one file per user instead of a hasMany. See User::getAvatarUrlAttribute.
 */
class AvatarController extends Controller
{
    /**
     * POST /me/avatar
     * Replaces any existing avatar — old file is deleted so uploads don't
     * pile up on disk.
     */
    public function store(StoreAvatarRequest $request): JsonResponse
    {
        $user = $request->user();
        $oldPath = $user->avatar_path;

        $path = $request->file('avatar')->store('avatars', 'public');
        $user->update(['avatar_path' => $path]);

        if ($oldPath && ! str_starts_with($oldPath, 'http')) {
            Storage::disk('public')->delete($oldPath);
        }

        return response()->json([
            'message' => 'Profile picture updated.',
            'user' => new UserResource($user->fresh()),
        ]);
    }

    /**
     * DELETE /me/avatar
     * Back to initials — not an error if there was nothing to remove.
     */
    public function destroy(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->avatar_path) {
            if (! str_starts_with($user->avatar_path, 'http')) {
                Storage::disk('public')->delete($user->avatar_path);
            }
            $user->update(['avatar_path' => null]);
        }

        return response()->json([
            'message' => 'Profile picture removed.',
            'user' => new UserResource($user->fresh()),
        ]);
    }
}
