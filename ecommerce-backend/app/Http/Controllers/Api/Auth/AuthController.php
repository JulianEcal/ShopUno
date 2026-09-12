<?php

namespace App\Http\Controllers\Api\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(LoginRequest $request): JsonResponse
    {
        $user = User::where('email', $request->validated('email'))->first();

        if (! $user || ! Hash::check($request->validated('password'), $user->password)) {
            throw ValidationException::withMessages([
                'email' => ['These credentials do not match our records.'],
            ]);
        }

        if ($user->status === 'pending') {
            throw ValidationException::withMessages([
                'email' => ['Your registration is still awaiting admin approval.'],
            ]);
        }

        if (in_array($user->status, ['rejected', 'suspended', 'deactivated'])) {
            throw ValidationException::withMessages([
                'email' => ['This account is not permitted to sign in. Contact support if you believe this is a mistake.'],
            ]);
        }

        $token = $user->createToken('e-commerce-' . $user->role)->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => new UserResource($user->load(['address', 'addresses', 'seller', 'courier.logisticsCompany', 'logisticsCompany'])),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'Logged out.']);
    }

    public function me(Request $request): JsonResponse
    {
        $user = $request->user()->load(['address', 'addresses', 'seller', 'courier.logisticsCompany', 'logisticsCompany']);

        return response()->json([
            'user' => new UserResource($user),
        ]);
    }
}
