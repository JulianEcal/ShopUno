<?php

namespace App\Http\Controllers;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\JsonResponse;

abstract class Controller
{
    /**
     * The one shared shape every paginated list endpoint in this API
     * returns: `{"data": [...], "meta": {current_page, last_page,
     * per_page, total}}`.
     *
     * Why this exists: `response()->json(['data' => SomeResource::collection($paginator)])`
     * — the pattern every list endpoint used before this — silently drops
     * pagination info. `SomeResource::collection()` only gets Laravel's
     * automatic `links`/`meta` treatment when the resource collection is
     * returned directly as the ROUTE's response (Laravel's router calls
     * its `toResponse()`, which detects the paginator and wraps it via
     * `PaginatedResourceResponse`). Nested one level down inside a plain
     * `response()->json([...])` call, only its plain `toArray()` runs —
     * just the array of resolved items, nothing else. A frontend built
     * against this had no `total`/`last_page`/`current_page` to build
     * pagination UI from at all.
     *
     * A few endpoints instead returned the raw `LengthAwarePaginator`
     * object itself, unwrapped, directly under `data`. That doesn't lose
     * the meta — the paginator's own `toArray()` includes it — but it
     * nests everything wrong and inconsistently with the rest of the API:
     * items end up at `data.data`, and `current_page`/`total`/etc. end up
     * as siblings of `data.data` rather than under a `meta` key. A
     * frontend can't use one list-parsing function across endpoints.
     *
     * See README "API response shape — pagination" for the full writeup
     * of what changed and why, and the migration note for existing
     * frontend code.
     */
    protected function paginatedResponse(iterable $items, LengthAwarePaginator $paginator, array $extra = []): JsonResponse
    {
        return response()->json(array_merge([
            'data' => $items,
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ], $extra));
    }
}
