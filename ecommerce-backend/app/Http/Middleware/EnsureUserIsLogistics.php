<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserIsLogistics
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || $user->role !== 'logistics') {
            abort(403, 'This action is restricted to logistics companies.');
        }

        if ($user->status !== 'active') {
            abort(403, 'Your logistics account must be active to manage riders.');
        }

        return $next($request);
    }
}
