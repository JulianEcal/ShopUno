<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\UpdateSettingsRequest;
use App\Models\Setting;
use Illuminate\Http\JsonResponse;

class SettingController extends Controller
{
    /**
     * GET /admin/settings
     * Returns every allowed key (see config/platform_settings.php), filled
     * with its current DB value or null if never set — so the admin UI
     * always knows the full set of fields to render, not just the ones
     * someone has already saved a value for.
     */
    public function index(): JsonResponse
    {
        $stored = Setting::pluck('value', 'key');

        $settings = collect(config('platform_settings.fields'))
            ->map(fn ($field, $key) => [
                'key' => $key,
                'label' => $field['label'],
                'description' => $field['description'],
                'value' => $stored[$key] ?? null,
            ])
            ->values();

        return response()->json(['data' => $settings]);
    }

    /** PATCH /admin/settings — body: { "settings": { "platform_name": "...", ... } } */
    public function update(UpdateSettingsRequest $request): JsonResponse
    {
        foreach ($request->validated('settings') as $key => $value) {
            Setting::updateOrCreate(['key' => $key], ['value' => $value]);
        }

        return response()->json(['message' => 'Settings updated.']);
    }
}
