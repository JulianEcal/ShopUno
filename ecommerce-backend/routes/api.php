<?php

use App\Http\Controllers\Api\AccountController as SelfAccountController;
use App\Http\Controllers\Api\AvatarController;
use App\Http\Controllers\Api\Admin\AccountController;
use App\Http\Controllers\Api\Admin\AnnouncementController as AdminAnnouncementController;
use App\Http\Controllers\Api\Admin\ComplianceController;
use App\Http\Controllers\Api\Admin\ComplaintController as AdminComplaintController;
use App\Http\Controllers\Api\Admin\DashboardController;
use App\Http\Controllers\Api\Admin\RegistrationController as AdminRegistrationController;
use App\Http\Controllers\Api\Admin\ReportController;
use App\Http\Controllers\Api\Admin\LogisticsOversightController;
use App\Http\Controllers\Api\Admin\SellerApplicationController as AdminSellerApplicationController;
use App\Http\Controllers\Api\Admin\SettingController;
use App\Http\Controllers\Api\AnnouncementController;
use App\Http\Controllers\Api\Auth\AuthController;
use App\Http\Controllers\Api\Auth\EmailVerificationController;
use App\Http\Controllers\Api\Auth\RegistrationController;
use App\Http\Controllers\Api\Buyer\AddressController;
use App\Http\Controllers\Api\Buyer\CartController;
use App\Http\Controllers\Api\Buyer\OrderController as BuyerOrderController;
use App\Http\Controllers\Api\Buyer\SellerApplicationController as BuyerSellerApplicationController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\ComplaintController;
use App\Http\Controllers\Api\ConversationController;
use App\Http\Controllers\Api\Courier\DashboardController as CourierDashboardController;
use App\Http\Controllers\Api\Courier\DeliveryController as CourierDeliveryController;
use App\Http\Controllers\Api\Courier\ReportController as CourierReportController;
use App\Http\Controllers\Api\DocumentController;
use App\Http\Controllers\Api\DocumentRequirementsController;
use App\Http\Controllers\Api\Logistics\DeliveryController as LogisticsDeliveryController;
use App\Http\Controllers\Api\Logistics\RiderController as LogisticsRiderController;
use App\Http\Controllers\Api\LogisticsCompanyController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\SellerController as PublicSellerController;
use App\Http\Controllers\Api\Seller\BannerController;
use App\Http\Controllers\Api\Seller\BusinessPermitController;
use App\Http\Controllers\Api\Seller\DashboardController as SellerDashboardController;
use App\Http\Controllers\Api\Seller\LogoController;
use App\Http\Controllers\Api\Seller\OrderController as SellerOrderController;
use App\Http\Controllers\Api\Seller\ProductController as SellerProductController;
use App\Http\Controllers\Api\Seller\ProductImageController;
use App\Http\Controllers\Api\Seller\ProductOptionController;
use App\Http\Controllers\Api\Seller\ProductVariationController;
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

// Public shop page — see SellerController for why this is separate from
// the authenticated /seller/* routes below.
Route::get('/sellers/{seller}', [PublicSellerController::class, 'show']);
Route::get('/sellers/{seller}/ratings', [PublicSellerController::class, 'ratings']);

// Powers the "which logistics company are you applying to?" dropdown on
// courier registration — see RegisterCourierRequest.
Route::get('/logistics-companies', [LogisticsCompanyController::class, 'index']);

/*
|--------------------------------------------------------------------------
| Registration & Auth
|--------------------------------------------------------------------------
| Only TWO direct registration types: Buyer (auto-approved, no wait) and
| Logistics (admin-approved, same as before). Seller is no longer a
| registration type — it's an upgrade applied for from an existing Buyer
| account (see the /me/seller-application routes below). Courier applies
| to a specific Logistics company (logistics_company_id required) — that
| company reviews the application, not platform admin. See README
| "Roles & Registration Flow" for the full reasoning.
*/

Route::post('/register/buyer', [RegistrationController::class, 'buyer']);
Route::post('/register/courier', [RegistrationController::class, 'courier']);
Route::post('/register/logistics', [RegistrationController::class, 'logistics']);

// Email OTP gate inside Step 1 of the buyer sign-up wizard — see
// EmailVerificationController's docblock. Public/unauthenticated: there's
// no account to authenticate as yet at this point in sign-up.
Route::post('/email/verification/send', [EmailVerificationController::class, 'send']);
Route::post('/email/verification/verify', [EmailVerificationController::class, 'verify']);

Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:5,1');

Route::middleware('auth:sanctum')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/me', [AuthController::class, 'me']);
    Route::patch('/me', [SelfAccountController::class, 'updateProfile']);
    Route::patch('/me/password', [SelfAccountController::class, 'updatePassword']);
    Route::post('/me/avatar', [AvatarController::class, 'store']);
    Route::delete('/me/avatar', [AvatarController::class, 'destroy']);

    // Buyer -> Seller upgrade path
    Route::get('/me/seller-application', [BuyerSellerApplicationController::class, 'show']);
    Route::post('/me/seller-application', [BuyerSellerApplicationController::class, 'store']);

    // Private document viewing — requires BOTH a valid signature (checked by
    // the 'signed' middleware) AND a logged-in user (checked here, then
    // re-checked for owner/admin inside the controller itself). See README
    // "Document privacy" and DocumentController for the full reasoning.
    Route::get('/documents/{user}/{type}', [DocumentController::class, 'show'])
        ->middleware('signed')
        ->name('documents.show');

    // A pending Seller Application has no Seller row yet (that's only
    // created on approval), so its business permit can't be reached through
    // the route above. This is the only way to view that file while the
    // application is still awaiting review.
    Route::get('/documents/seller-applications/{sellerApplication}/permit', [DocumentController::class, 'sellerApplicationPermit'])
        ->middleware('signed')
        ->name('documents.seller-application-permit');

    // Address book (buyer's saved addresses) — used both by the account
    // page and the "choose a delivery address" step at checkout (see
    // Buyer\OrderController::store's address_id).
    Route::get('/addresses', [AddressController::class, 'index']);
    Route::post('/addresses', [AddressController::class, 'store']);
    Route::put('/addresses/{address}', [AddressController::class, 'update']);
    Route::delete('/addresses/{address}', [AddressController::class, 'destroy']);
    Route::post('/addresses/{address}/default', [AddressController::class, 'setDefault']);

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
    Route::post('/conversations/{conversation}/messages/{message}/reactions', [ConversationController::class, 'toggleReaction']);
    Route::delete('/conversations/{conversation}/messages/{message}', [ConversationController::class, 'unsendMessage']);
});

/*
|--------------------------------------------------------------------------
| Admin routes
|--------------------------------------------------------------------------
| 'admin' middleware alias must be registered in bootstrap/app.php — see README.
| Note: /admin/registrations only ever queues Logistics applicants at the
| data layer — Buyers auto-approve and never appear here, Sellers apply
| through the separate /admin/seller-applications table, Couriers are
| reviewed by their Logistics company, not admin. The admin frontend's
| "Applicant queue" merges both /admin/registrations and
| /admin/seller-applications into one view — see /admin/registrations/counts
| for the per-role tallies that power that merged UI.
*/

Route::middleware(['auth:sanctum', 'admin'])->prefix('admin')->group(function () {
    Route::get('/dashboard', [DashboardController::class, 'index']);

    Route::get('/registrations', [AdminRegistrationController::class, 'index']);
    // Declared before /registrations/{user} so "counts" is never swallowed
    // by the {user} wildcard's implicit model binding.
    Route::get('/registrations/counts', [AdminRegistrationController::class, 'counts']);
    Route::get('/registrations/{user}', [AdminRegistrationController::class, 'show']);
    Route::post('/registrations/{user}/approve', [AdminRegistrationController::class, 'approve']);
    Route::post('/registrations/{user}/reject', [AdminRegistrationController::class, 'reject']);

    Route::get('/seller-applications', [AdminSellerApplicationController::class, 'index']);
    Route::get('/seller-applications/{sellerApplication}', [AdminSellerApplicationController::class, 'show']);
    Route::post('/seller-applications/{sellerApplication}/approve', [AdminSellerApplicationController::class, 'approve']);
    Route::post('/seller-applications/{sellerApplication}/reject', [AdminSellerApplicationController::class, 'reject']);

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

    // Read-only oversight — no approve/reject here on purpose. See
    // LogisticsOversightController for why.
    Route::get('/logistics-companies', [LogisticsOversightController::class, 'companies']);
    Route::get('/logistics-companies/{logisticsCompany}', [LogisticsOversightController::class, 'company']);
    Route::get('/riders', [LogisticsOversightController::class, 'riders']);
    Route::get('/riders/{courier}', [LogisticsOversightController::class, 'rider']);

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

    Route::post('/business-permit', [BusinessPermitController::class, 'update']);

    Route::post('/banner', [BannerController::class, 'store']);
    Route::delete('/banner', [BannerController::class, 'destroy']);

    Route::post('/logo', [LogoController::class, 'store']);
    Route::delete('/logo', [LogoController::class, 'destroy']);

    Route::get('/products', [SellerProductController::class, 'index']);
    Route::get('/products/{product}', [SellerProductController::class, 'show']);
    Route::post('/products', [SellerProductController::class, 'store']);
    Route::put('/products/{product}', [SellerProductController::class, 'update']);
    Route::delete('/products/{product}', [SellerProductController::class, 'destroy']);
    Route::post('/products/{product}/restore', [SellerProductController::class, 'restore']);
    Route::delete('/products/{product}/force', [SellerProductController::class, 'forceDestroy']);
    Route::post('/products/{product}/publish', [SellerProductController::class, 'publish']);

    // Discounts — a separate mini-resource from the product edit form
    // itself (see Seller\ProductController's discount methods for why).
    Route::patch('/products/{product}/discount', [SellerProductController::class, 'setDiscount']);
    Route::patch('/products/{product}/discount/pause', [SellerProductController::class, 'pauseDiscount']);
    Route::patch('/products/{product}/discount/resume', [SellerProductController::class, 'resumeDiscount']);
    Route::delete('/products/{product}/discount', [SellerProductController::class, 'removeDiscount']);

    // Option groups (e.g. "Style", "Size") + their values — sellers manage
    // these, and ProductOptionController auto-generates/prunes the actual
    // buyable combination rows (ProductVariation) whenever they change.
    Route::post('/products/{product}/options', [ProductOptionController::class, 'storeOption']);
    Route::put('/products/{product}/options/{option}', [ProductOptionController::class, 'updateOption']);
    Route::delete('/products/{product}/options/{option}', [ProductOptionController::class, 'destroyOption']);
    Route::post('/products/{product}/options/{option}/values', [ProductOptionController::class, 'storeValue']);
    Route::put('/products/{product}/options/{option}/values/{value}', [ProductOptionController::class, 'updateValue']);
    Route::delete('/products/{product}/options/{option}/values/{value}', [ProductOptionController::class, 'destroyValue']);

    Route::put('/products/{product}/variations/{variation}', [ProductVariationController::class, 'update']);
    Route::patch('/products/{product}/variations/bulk', [ProductVariationController::class, 'bulkUpdate']);
    Route::delete('/products/{product}/variations/{variation}', [ProductVariationController::class, 'destroy']);

    Route::post('/products/{product}/images', [ProductImageController::class, 'store']);
    Route::patch('/products/{product}/images/reorder', [ProductImageController::class, 'reorder']);
    Route::delete('/products/{product}/images/{image}', [ProductImageController::class, 'destroy']);

    Route::get('/orders', [SellerOrderController::class, 'index']);
    Route::get('/orders/{order}', [SellerOrderController::class, 'show']);
    Route::patch('/orders/{order}/status', [SellerOrderController::class, 'updateStatus']);
    Route::post('/orders/{order}/confirm-ready', [SellerOrderController::class, 'confirmReady']);
    Route::get('/orders/{order}/waybill', [SellerOrderController::class, 'waybill']);
    Route::get('/orders/{order}/waybill/print', [SellerOrderController::class, 'printWaybill']);

    Route::get('/vouchers', [SellerVoucherController::class, 'index']);
    Route::post('/vouchers', [SellerVoucherController::class, 'store']);
    Route::patch('/vouchers/{voucher}', [SellerVoucherController::class, 'update']);

    Route::get('/ratings', [SellerRatingController::class, 'index']);

    Route::get('/reports/sales', [SellerReportController::class, 'sales']);
});

/*
|--------------------------------------------------------------------------
| Courier routes
|--------------------------------------------------------------------------
| 'courier' middleware alias must be registered in bootstrap/app.php — see README.
*/

Route::middleware(['auth:sanctum', 'courier'])->prefix('courier')->group(function () {
    Route::get('/dashboard', [CourierDashboardController::class, 'index']);
    Route::get('/reports/earnings', [CourierReportController::class, 'earnings']);

    Route::get('/deliveries/available', [CourierDeliveryController::class, 'available']);
    Route::get('/deliveries', [CourierDeliveryController::class, 'index']);
    Route::get('/deliveries/{delivery}', [CourierDeliveryController::class, 'show']);
    Route::post('/deliveries/accept', [CourierDeliveryController::class, 'accept']);
    Route::post('/deliveries/{delivery}/pickup', [CourierDeliveryController::class, 'pickup']);
    Route::post('/deliveries/{delivery}/out-for-delivery', [CourierDeliveryController::class, 'outForDelivery']);
    Route::post('/deliveries/{delivery}/deliver', [CourierDeliveryController::class, 'deliver']);
});

/*
|--------------------------------------------------------------------------
| Logistics routes
|--------------------------------------------------------------------------
| 'logistics' middleware alias must be registered in bootstrap/app.php — see README.
| This is the NEW role — a logistics company reviews its own riders'
| applications here. Platform admin never touches individual rider
| approvals; that authority belongs to the company the rider applied to.
*/

Route::middleware(['auth:sanctum', 'logistics'])->prefix('logistics')->group(function () {
    Route::get('/deliveries', [LogisticsDeliveryController::class, 'index']);
    Route::get('/deliveries/{delivery}', [LogisticsDeliveryController::class, 'show']);
    Route::post('/deliveries/{delivery}/confirm', [LogisticsDeliveryController::class, 'confirm']);

    Route::get('/riders', [LogisticsRiderController::class, 'index']);
    Route::get('/riders/{courier}', [LogisticsRiderController::class, 'show']);
    Route::post('/riders/{courier}/approve', [LogisticsRiderController::class, 'approve']);
    Route::post('/riders/{courier}/reject', [LogisticsRiderController::class, 'reject']);
});