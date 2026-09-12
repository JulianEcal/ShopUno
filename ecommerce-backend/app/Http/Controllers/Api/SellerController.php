<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Seller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The public storefront "shop page" a buyer lands on from a product's
 * seller name/rating badge — distinct from Api\Seller\* (auth:sanctum +
 * 'seller' middleware, a seller managing their own shop). Everything here
 * is read-only and reachable by anyone, same as ProductController.
 */
class SellerController extends Controller
{
    /** GET /sellers/{seller} */
    public function show(Seller $seller): JsonResponse
    {
        // Same gate as ProductController's catalog: a deactivated account's
        // products are hidden from the storefront, so its shop page (and the
        // banner/description that comes with it) shouldn't be reachable
        // either, even if a buyer has an old link to it.
        abort_unless($seller->user && $seller->user->status === 'active', 404);

        return response()->json([
            'seller' => [
                'id' => $seller->id,
                // Needed as `recipient_id` for the "Message seller" button —
                // messaging always addresses a user, not a Seller row (same
                // reasoning as ProductResource's `seller.user_id`).
                'user_id' => $seller->user_id,
                'business_name' => $seller->business_name,
                'line_of_business' => $seller->line_of_business,
                'shop_description' => $seller->shop_description,
                'banner_url' => $seller->banner_url,
                'logo_url' => $seller->logo_url,
                'average_rating' => $seller->averageRating(),
                'ratings_count' => $seller->ratingsCount(),
                'products_count' => $seller->products()->active()->published()->count(),
                'joined_at' => $seller->created_at?->toIso8601String(),
            ],
        ]);
    }

    /** GET /sellers/{seller}/ratings — the reviews a buyer sees on the shop page. */
    public function ratings(Request $request, Seller $seller): JsonResponse
    {
        abort_unless($seller->user && $seller->user->status === 'active', 404);

        $ratings = $seller->ratingsReceived()
            ->with('ratedBy:id,first_name,last_name')
            ->latest()
            ->paginate(10);

        $items = collect($ratings->items())->map(fn ($r) => [
            'id' => $r->id,
            'score' => $r->score,
            'feedback' => $r->feedback,
            // First name + last initial only — a buyer's full name isn't
            // this endpoint's to hand out to every visitor of the shop page.
            'from' => trim($r->ratedBy->first_name.' '.mb_substr($r->ratedBy->last_name ?? '', 0, 1)).(($r->ratedBy->last_name ?? '') !== '' ? '.' : ''),
            'created_at' => $r->created_at?->toIso8601String(),
        ])->all();

        return $this->paginatedResponse($items, $ratings, [
            'average_rating' => $seller->averageRating(),
        ]);
    }
}
