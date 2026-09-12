<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use App\Http\Requests\Seller\UpdateBusinessPermitRequest;
use App\Http\Resources\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;

/**
 * A seller's business permit is a private document (see DocumentController,
 * 'local' disk + signed URLs), unlike the public avatar — same
 * replace-and-delete-old-file pattern as AvatarController, just scoped to
 * the Seller row instead of the User row.
 */
class BusinessPermitController extends Controller
{
    /**
     * POST /seller/business-permit
     * Lets a seller replace the permit on file — e.g. after a renewal —
     * without going through the admin/application flow again. Doesn't
     * change the account's approval status; it just swaps the file an
     * admin would see if they ever reopen this seller's record.
     */
    public function update(UpdateBusinessPermitRequest $request): JsonResponse
    {
        $seller = $request->user()->seller;
        $oldPath = $seller->business_permit_path;

        $path = $request->file('business_permit')->store('permits');
        $seller->update(['business_permit_path' => $path]);

        if ($oldPath) {
            Storage::disk('local')->delete($oldPath);
        }

        return response()->json([
            'message' => 'Business permit updated.',
            'user' => new UserResource($request->user()->fresh(['address', 'seller', 'courier'])),
        ]);
    }
}
