<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\URL;

class SellerApplication extends Model
{
    protected $fillable = [
        'user_id', 'business_name', 'line_of_business', 'business_permit_path',
        'status', 'reviewed_by_admin_id', 'reviewed_at', 'rejection_reason',
    ];

    protected $casts = [
        'reviewed_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function reviewedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by_admin_id');
    }

    /**
     * Short-lived signed URL to view the uploaded business permit while
     * this application is still pending — mirrors User::documentUrls(),
     * but a pending application has no Seller row yet, so it needs its
     * own signed route rather than reusing the 'business_permit' type
     * on /documents/{user}/{type}.
     */
    public function permitUrl(int $minutes = 10): ?string
    {
        if (! $this->business_permit_path) {
            return null;
        }

        return URL::temporarySignedRoute(
            'documents.seller-application-permit',
            now()->addMinutes($minutes),
            ['sellerApplication' => $this->id]
        );
    }
}
