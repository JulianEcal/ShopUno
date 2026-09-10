<?php

namespace App\Http\Controllers\Api\Seller;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RatingController extends Controller
{
    /** GET /seller/ratings — this is what "Handle customer feedback" reads from. */
    public function index(Request $request): JsonResponse
    {
        $seller = $request->user()->seller;

        $ratings = $seller->ratingsReceived()
            ->with('ratedBy:id,first_name,last_name', 'order:id')
            ->latest()
            ->paginate(20);

        $items = collect($ratings->items())->map(fn ($r) => [
            'id' => $r->id,
            'order_id' => $r->order_id,
            'score' => $r->score,
            'feedback' => $r->feedback,
            'from' => "{$r->ratedBy->first_name} {$r->ratedBy->last_name}",
            'created_at' => $r->created_at?->toIso8601String(),
        ])->all();

        return $this->paginatedResponse($items, $ratings, [
            'average_rating' => $seller->averageRating(),
        ]);
    }
}
