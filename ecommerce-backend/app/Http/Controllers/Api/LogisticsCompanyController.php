<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\LogisticsCompany;
use Illuminate\Http\JsonResponse;

class LogisticsCompanyController extends Controller
{
    public function index(): JsonResponse
    {
        $companies = LogisticsCompany::query()
            ->whereHas('user', fn ($q) => $q->where('status', 'active'))
            ->get(['id', 'company_name']);

        return response()->json(['data' => $companies]);
    }
}
