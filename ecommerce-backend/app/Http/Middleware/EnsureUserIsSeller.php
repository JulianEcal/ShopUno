<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserIsSeller
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || $user->role !== 'seller') {
            abort(403, 'This action is restricted to sellers.');
        }

        if ($user->status !== 'active') {
            abort(403, 'Your seller account must be active to manage products.');
        }

        return $next($request);
    }
}
