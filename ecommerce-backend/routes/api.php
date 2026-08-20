<?php

use App\Http\Controllers\Api\AccountController as SelfAccountController;
use App\Http\Controllers\Api\Admin\AccountController;
use App\Http\Controllers\Api\Admin\AnnouncementController as AdminAnnouncementController;
use App\Http\Controllers\Api\Admin\ComplianceController;
use App\Http\Controllers\Api\Admin\ComplaintController as AdminComplaintController;
use App\Http\Controllers\Api\Admin\DashboardController;
use App\Http\Controllers\Api\Admin\RegistrationController as AdminRegistrationController;
use App\Http\Controllers\Api\Admin\ReportController;
use App\Http\Controllers\Api\Admin\SettingController;
use App\Http\Controllers\Api\AnnouncementController;
use App\Http\Controllers\Api\Auth\AuthController;
use App\Http\Controllers\Api\Auth\RegistrationController;
use App\Http\Controllers\Api\Buyer\CartController;
use App\Http\Controllers\Api\Buyer\OrderController as BuyerOrderController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\ComplaintController;
use App\Http\Controllers\Api\ConversationController;
use App\Http\Controllers\Api\DocumentController;
use App\Http\Controllers\Api\DocumentRequirementsController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\Seller\DashboardController as SellerDashboardController;
use App\Http\Controllers\Api\Seller\OrderController as SellerOrderController;
use App\Http\Controllers\Api\Seller\ProductController as SellerProductController;
use App\Http\Controllers\Api\Seller\RatingController as SellerRatingController;
use App\Http\Controllers\Api\Seller\ReportController as SellerReportController;
use App\Http\Controllers\Api\Seller\VoucherController as SellerVoucherController;
use App\Http\Controllers\Api\VoucherController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Public routes
|--------------------------------------------------------------------------
*/

Route::get('/document-requirements', [DocumentRequirementsController::class, 'index']);
Route::get('/categories', [CategoryController::class, 'index']);
Route::get('/products', [ProductController::class, 'index']);
Route::get('/products/{product}', [ProductController::class, 'show']);
Route::get('/announcements', [AnnouncementController::class, 'index']);

/*
|--------------------------------------------------------------------------
| Auth routes — merge this into your project's routes/api.php
|--------------------------------------------------------------------------
| These are public except logout/me, which require a valid Sanctum token.
*/

Route::post('/register/buyer', [RegistrationController::class, 'buyer']);
Route::post('/register/seller', [RegistrationController::class, 'seller']);
Route::post('/register/courier', [RegistrationController::class, 'courier']);

Route::post('/login', [AuthController::class, 'login']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/me', [AuthController::class, 'me']);
    Route::patch('/me', [SelfAccountController::class, 'updateProfile']);
    Route::patch('/me/password', [SelfAccountController::class, 'updatePassword']);

    // Private document viewing — requires BOTH a valid signature (checked by
    // the 'signed' middleware) AND a logged-in user (checked here, then
    // re-checked for owner/admin inside the controller itself). See README
    // "Document privacy" and DocumentController for the full reasoning.
    Route::get('/documents/{user}/{type}', [DocumentController::class, 'show'])
        ->middleware('signed')
        ->name('documents.show');

    // Cart & checkout — buyer only in practice (sellers/couriers have no cart),
    // kept outside a role middleware since nothing here needs seller/courier data.
    Route::get('/cart', [CartController::class, 'show']);
    Route::post('/cart/items', [CartController::class, 'addItem']);
    Route::put('/cart/items/{cartItem}', [CartController::class, 'updateItem']);
    Route::delete('/cart/items/{cartItem}', [CartController::class, 'removeItem']);
    Route::post('/orders', [BuyerOrderController::class, 'store']);
    Route::get('/orders', [BuyerOrderController::class, 'index']);
    Route::get('/orders/{order}', [BuyerOrderController::class, 'show']);
    Route::post('/orders/{order}/rating', [BuyerOrderController::class, 'rate']);
    Route::get('/vouchers', [VoucherController::class, 'index']);

    // Complaints — any authenticated role can file one
    Route::get('/my-complaints', [ComplaintController::class, 'index']);
    Route::get('/my-complaints/{complaint}', [ComplaintController::class, 'show']);
    Route::post('/complaints', [ComplaintController::class, 'store']);

    // Messaging — any authenticated role
    Route::get('/conversations', [ConversationController::class, 'index']);
    Route::post('/conversations', [ConversationController::class, 'store']);
    Route::get('/conversations/{conversation}/messages', [ConversationController::class, 'messages']);
    Route::post('/conversations/{conversation}/messages', [ConversationController::class, 'sendMessage']);
});

/*
|--------------------------------------------------------------------------
| Admin routes
|--------------------------------------------------------------------------
| 'admin' middleware alias must be registered in bootstrap/app.php — see README.
*/

Route::middleware(['auth:sanctum', 'admin'])->prefix('admin')->group(function () {
    Route::get('/dashboard', [DashboardController::class, 'index']);

    Route::get('/registrations', [AdminRegistrationController::class, 'index']);
    Route::get('/registrations/{user}', [AdminRegistrationController::class, 'show']);
    Route::post('/registrations/{user}/approve', [AdminRegistrationController::class, 'approve']);
    Route::post('/registrations/{user}/reject', [AdminRegistrationController::class, 'reject']);

    Route::get('/accounts', [AccountController::class, 'index']);
    Route::get('/accounts/{user}', [AccountController::class, 'show']);
    Route::post('/accounts/{user}/warn', [AccountController::class, 'warn']);
    Route::post('/accounts/{user}/activate', [AccountController::class, 'activate']);
    Route::post('/accounts/{user}/suspend', [AccountController::class, 'suspend']);
    Route::post('/accounts/{user}/deactivate', [AccountController::class, 'deactivate']);

    Route::get('/compliance/products', [ComplianceController::class, 'index']);
    Route::get('/compliance/products/{product}', [ComplianceController::class, 'show']);
    Route::post('/compliance/products/{product}/flag', [ComplianceController::class, 'flag']);
    Route::post('/compliance/products/{product}/resolve', [ComplianceController::class, 'resolve']);
    Route::post('/compliance/products/{product}/archive', [ComplianceController::class, 'archive']);

    Route::get('/complaints', [AdminComplaintController::class, 'index']);
    Route::get('/complaints/{complaint}', [AdminComplaintController::class, 'show']);
    Route::patch('/complaints/{complaint}/resolve', [AdminComplaintController::class, 'resolve']);

    Route::get('/reports/sales', [ReportController::class, 'sales']);
    Route::get('/reports/commission', [ReportController::class, 'commission']);

    Route::get('/settings', [SettingController::class, 'index']);
    Route::patch('/settings', [SettingController::class, 'update']);

    Route::get('/announcements', [AdminAnnouncementController::class, 'index']);
    Route::post('/announcements', [AdminAnnouncementController::class, 'store']);
    Route::put('/announcements/{announcement}', [AdminAnnouncementController::class, 'update']);
    Route::delete('/announcements/{announcement}', [AdminAnnouncementController::class, 'destroy']);
});

/*
|--------------------------------------------------------------------------
| Seller routes
|--------------------------------------------------------------------------
| 'seller' middleware alias must be registered in bootstrap/app.php — see README.
*/

Route::middleware(['auth:sanctum', 'seller'])->prefix('seller')->group(function () {
    Route::get('/dashboard', [SellerDashboardController::class, 'index']);

    Route::get('/products', [SellerProductController::class, 'index']);
    Route::post('/products', [SellerProductController::class, 'store']);
    Route::put('/products/{product}', [SellerProductController::class, 'update']);
    Route::delete('/products/{product}', [SellerProductController::class, 'destroy']);

    Route::get('/orders', [SellerOrderController::class, 'index']);
    Route::get('/orders/{order}', [SellerOrderController::class, 'show']);
    Route::patch('/orders/{order}/status', [SellerOrderController::class, 'updateStatus']);

    Route::get('/vouchers', [SellerVoucherController::class, 'index']);
    Route::post('/vouchers', [SellerVoucherController::class, 'store']);
    Route::patch('/vouchers/{voucher}', [SellerVoucherController::class, 'update']);

    Route::get('/ratings', [SellerRatingController::class, 'index']);

    Route::get('/reports/sales', [SellerReportController::class, 'sales']);
});
