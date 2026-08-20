<?php

namespace App\Providers;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        $this->guardAgainstInsufficientUploadLimits();
    }

    /**
     * Laravel's `max:` validation rule only rejects a file AFTER PHP has
     * already accepted the upload. If the server's own upload_max_filesize
     * or post_max_size is lower than what config/documents.php promises,
     * uploads fail (or get silently truncated) before Laravel ever sees
     * them — a confusing, hard-to-diagnose bug for whoever hits it first.
     *
     * This catches the mismatch at boot time instead, so it shows up in
     * local dev / CI rather than being discovered when a real seller can't
     * upload their business permit in production.
     */
    protected function guardAgainstInsufficientUploadLimits(): void
    {
        $configuredMb = config('documents.max_size_kb', 5120) / 1024;

        $phpUploadMb = $this->iniValueToMb(ini_get('upload_max_filesize'));
        $phpPostMb = $this->iniValueToMb(ini_get('post_max_size'));

        if ($phpUploadMb < $configuredMb || $phpPostMb < $configuredMb) {
            $message = sprintf(
                "Document upload limit mismatch: config/documents.php allows %.1fMB, ".
                "but PHP's upload_max_filesize is %.1fMB and post_max_size is %.1fMB. ".
                "Registration document uploads (ID, business permit, OR/CR, license) may fail. ".
                "Fix: confirm public/.user.ini is being applied (PHP-FPM only — see README), ".
                "or set these values directly in your php.ini / hosting control panel.",
                $configuredMb,
                $phpUploadMb,
                $phpPostMb,
            );

            Log::warning($message);

            // Fail loudly in local/dev so it's caught immediately instead of
            // silently logged and ignored. Never throws in production —
            // a misconfigured server shouldn't take the whole app down.
            if (app()->environment('local', 'testing')) {
                throw_if(
                    $phpUploadMb < $configuredMb || $phpPostMb < $configuredMb,
                    \RuntimeException::class,
                    $message
                );
            }
        }
    }

    protected function iniValueToMb(string|false $iniValue): float
    {
        if (! $iniValue) {
            return 0;
        }

        $unit = strtoupper(substr(trim($iniValue), -1));
        $number = (float) $iniValue;

        return match ($unit) {
            'G' => $number * 1024,
            'M' => $number,
            'K' => $number / 1024,
            default => $number / 1024 / 1024, // raw bytes
        };
    }
}
