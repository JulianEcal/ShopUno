<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Http\Requests\Seller\StoreLogoRequest;
use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * A shop logo is PUBLIC, same as the user avatar and shop banner (see
 * AvatarController, BannerController) — shown on the storefront without a
 * signed URL — just scoped to the Seller row and stored under 'logos'.
 * Deliberately separate from AvatarController: that controller edits the
 * user's own personal avatar_path (shown for them as a buyer, in messages
 * as themselves, etc.), while this edits the shop's own logo_path so a
 * seller's personal photo and their storefront's photo can differ.
 */
class LogoController extends Controller
{
    /**
     * POST /seller/logo
     * Replaces any existing logo — old file is deleted so uploads don't
     * pile up on disk.
     */
    public function store(StoreLogoRequest $request): JsonResponse
    {
        $seller = $request->user()->seller;
        $oldPath = $seller->logo_path;

        $path = $request->file('logo')->store('logos', 'public');
        $seller->update(['logo_path' => $path]);

        if ($oldPath && ! str_starts_with($oldPath, 'http')) {
            Storage::disk('public')->delete($oldPath);
        }

        return response()->json([
            'message' => 'Shop logo updated.',
            'user' => new UserResource($request->user()->fresh(['address', 'seller', 'courier'])),
        ]);
    }

    /**
     * DELETE /seller/logo
     * Back to initials — not an error if there was nothing to remove.
     */
    public function destroy(Request $request): JsonResponse
    {
        $seller = $request->user()->seller;

        if ($seller->logo_path) {
            if (! str_starts_with($seller->logo_path, 'http')) {
                Storage::disk('public')->delete($seller->logo_path);
            }
            $seller->update(['logo_path' => null]);
        }

        return response()->json([
            'message' => 'Shop logo removed.',
            'user' => new UserResource($request->user()->fresh(['address', 'seller', 'courier'])),
        ]);
    }
}
