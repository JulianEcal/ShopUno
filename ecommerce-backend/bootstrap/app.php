<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
    // Cloudflare Tunnel sits in front of this app in production, so Laravel
    // needs to trust it in order to correctly detect HTTPS and generate
    // correct absolute URLs (asset links, redirects, etc).
    $middleware->trustProxies(at: '*');

    $middleware->alias([
        'admin' => \App\Http\Middleware\EnsureUserIsAdmin::class,
        'seller' => \App\Http\Middleware\EnsureUserIsSeller::class,
    ]);

    // API-only app — no 'login' route exists, so guests should
    // get a 401 JSON response instead of a redirect attempt.
    $middleware->redirectGuestsTo(fn () => null);
})
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();