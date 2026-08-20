<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserIsCourier
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || $user->role !== 'courier') {
            abort(403, 'This action is restricted to couriers.');
        }

        if ($user->status !== 'active') {
            abort(403, 'Your courier account must be active to accept deliveries.');
        }

        return $next($request);
    }
}
