<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Http\Requests\Seller\StoreBannerRequest;
use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * A shop banner is PUBLIC, same as the user avatar (see AvatarController) —
 * shown on the storefront without a signed URL — just scoped to the Seller
 * row instead of the User row, and stored under 'banners' instead of
 * 'avatars'.
 */
class BannerController extends Controller
{
    /**
     * POST /seller/banner
     * Replaces any existing banner — old file is deleted so uploads don't
     * pile up on disk.
     */
    public function store(StoreBannerRequest $request): JsonResponse
    {
        $seller = $request->user()->seller;
        $oldPath = $seller->banner_path;

        $path = $request->file('banner')->store('banners', 'public');
        $seller->update(['banner_path' => $path]);

        if ($oldPath && ! str_starts_with($oldPath, 'http')) {
            Storage::disk('public')->delete($oldPath);
        }

        return response()->json([
            'message' => 'Shop banner updated.',
            'user' => new UserResource($request->user()->fresh(['address', 'seller', 'courier'])),
        ]);
    }

    /**
     * DELETE /seller/banner
     * Back to a plain background — not an error if there was nothing to remove.
     */
    public function destroy(Request $request): JsonResponse
    {
        $seller = $request->user()->seller;

        if ($seller->banner_path) {
            if (! str_starts_with($seller->banner_path, 'http')) {
                Storage::disk('public')->delete($seller->banner_path);
            }
            $seller->update(['banner_path' => null]);
        }

        return response()->json([
            'message' => 'Shop banner removed.',
            'user' => new UserResource($request->user()->fresh(['address', 'seller', 'courier'])),
        ]);
    }
}
