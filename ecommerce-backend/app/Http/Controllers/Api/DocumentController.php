<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SellerApplication;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class DocumentController extends Controller
{
    /**
     * GET /documents/{user}/{type} — name: documents.show
     *
     * Two layers of protection, deliberately not just one:
     * 1. The 'signed' middleware rejects the request outright if the URL's
     *    signature is missing, wrong, or expired (link only lives ~10 min).
     * 2. Even with a valid signature, we still re-check the requester is
     *    either the document's owner or an admin — a signed link that leaked
     *    (screenshot, forwarded email, browser history) still isn't enough
     *    on its own to view someone's government ID.
     */
    public function show(Request $request, User $user, string $type): StreamedResponse
    {
        if (! $request->hasValidSignature()) {
            abort(403, 'This link is invalid or has expired.');
        }

        $requester = $request->user();
        if (! $requester || (! $requester->isAdmin() && $requester->id !== $user->id)) {
            abort(403, 'You are not authorized to view this document.');
        }

        $path = match ($type) {
            'id' => $user->upload_id_path,
            'business_permit' => $user->seller?->business_permit_path ?? $user->logisticsCompany?->business_permit_path,
            'or_cr' => $user->courier?->or_cr_path,
            'license' => $user->courier?->license_path,
            default => null,
        };

        abort_if(! $path || ! Storage::disk('local')->exists($path), 404, 'Document not found.');

        return Storage::disk('local')->response($path);
    }

    /**
     * GET /documents/seller-applications/{sellerApplication}/permit — name: documents.seller-application-permit
     * Same two-layer protection as show() above (signed link + owner/admin
     * check), just scoped to a Seller Application's permit instead of a
     * User's documents — the only way to see this file before approval,
     * since the Seller row (and its business_permit_path) doesn't exist yet.
     */
    public function sellerApplicationPermit(Request $request, SellerApplication $sellerApplication): StreamedResponse
    {
        if (! $request->hasValidSignature()) {
            abort(403, 'This link is invalid or has expired.');
        }

        $requester = $request->user();
        if (! $requester || (! $requester->isAdmin() && $requester->id !== $sellerApplication->user_id)) {
            abort(403, 'You are not authorized to view this document.');
        }

        $path = $sellerApplication->business_permit_path;

        abort_if(! $path || ! Storage::disk('local')->exists($path), 404, 'Document not found.');

        return Storage::disk('local')->response($path);
    }
}
