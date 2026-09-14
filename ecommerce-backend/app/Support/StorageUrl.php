<?php

namespace App\Support;

use Illuminate\Support\Facades\Storage;

/**
 * Storage::disk('public')->url() bakes in whatever APP_URL happens to be
 * in .env — which only ever points at one place at a time (either the
 * Cloudflare tunnel domain, or a local address). That's fine when the app
 * is only ever reached one way, but this project is regularly reached
 * both directly at http://127.0.0.1:8000 (local testing, no tunnel
 * required) and through https://api.shopuno.shop (the tunnel) — and
 * whichever one *isn't* current APP_URL would get broken image URLs.
 *
 * This instead builds the URL from however THIS request actually arrived,
 * so a product photo, avatar, seller logo/banner, or message attachment
 * always resolves against the same host the rest of the page's data just
 * came from — matching the same "detect the environment, don't hardcode
 * it" approach used on the frontend's config.js.
 */
class StorageUrl
{
    public static function for(?string $path): ?string
    {
        if (! $path) {
            return null;
        }

        // Seeded/demo data can store a full external URL directly (see
        // ProductImage::getUrlAttribute) — pass those through untouched.
        if (str_starts_with($path, 'http://') || str_starts_with($path, 'https://')) {
            return $path;
        }

        $relative = Storage::disk('public')->url($path); // e.g. "/storage/products/xxx.jpg" or an absolute URL, depending on config

        // Already absolute (some environments configure the disk with a
        // full URL) — nothing more to do.
        if (str_starts_with($relative, 'http://') || str_starts_with($relative, 'https://')) {
            $relative = parse_url($relative, PHP_URL_PATH) ?? $relative;
        }

        $request = app()->bound('request') ? request() : null;
        $host = $request?->getSchemeAndHttpHost();

        return $host ? $host . $relative : $relative;
    }
}