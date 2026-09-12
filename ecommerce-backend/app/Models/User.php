<?php

namespace App\Models;

use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Facades\URL;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = [
        'last_name', 'first_name', 'middle_initial', 'sex',
        'email', 'username', 'password',
        'contact_no', 'birthday', 'age', 'upload_id_path', 'avatar_path',
        'role', 'status',
    ];

    protected $hidden = [
        'password', 'remember_token',
    ];

    protected $casts = [
        'email_verified_at' => 'datetime',
        'birthday' => 'date',
        'password' => 'hashed',
    ];

    /**
     * Resolves `avatar_path` to a ready-to-use URL, same pass-through
     * logic as ProductImage::getUrlAttribute (seeded/demo data may store a
     * full external URL instead of a local one). Null when no avatar has
     * ever been uploaded — UserResource passes that null through as-is,
     * and the frontend falls back to initials when avatar_url is falsy.
     */
    public function getAvatarUrlAttribute(): ?string
    {
        if (! $this->avatar_path) {
            return null;
        }

        if (str_starts_with($this->avatar_path, 'http://') || str_starts_with($this->avatar_path, 'https://')) {
            return $this->avatar_path;
        }

        return \Illuminate\Support\Facades\Storage::disk('public')->url($this->avatar_path);
    }

    // ---- Role-specific extension tables ----

    /**
     * The user's default/primary address — the only one every non-buyer
     * role ever has (set at registration), and for a buyer the one
     * preselected at checkout. Filtered by is_default so this keeps
     * working unchanged even once a buyer has several rows in addresses().
     */
    public function address(): HasOne
    {
        return $this->hasOne(Address::class)->where('is_default', true);
    }

    /** Full address book — every saved address, default first. Mainly a
     * buyer thing (checkout picker + account page), but nothing stops any
     * role from having more than one row here. */
    public function addresses(): HasMany
    {
        return $this->hasMany(Address::class)->orderByDesc('is_default')->orderByDesc('id');
    }

    public function seller(): HasOne
    {
        return $this->hasOne(Seller::class);
    }

    public function courier(): HasOne
    {
        return $this->hasOne(Courier::class);
    }

    public function logisticsCompany(): HasOne
    {
        return $this->hasOne(LogisticsCompany::class);
    }

    /** A buyer may have applied (and reapplied) to become a seller more than once. */
    public function sellerApplications(): HasMany
    {
        return $this->hasMany(SellerApplication::class);
    }

    public function cart(): HasOne
    {
        return $this->hasOne(Cart::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class, 'buyer_id');
    }

    public function complaintsFiled(): HasMany
    {
        return $this->hasMany(Complaint::class, 'filed_by_user_id');
    }

    public function conversations(): BelongsToMany
    {
        return $this->belongsToMany(Conversation::class)
            ->withPivot('last_read_at')
            ->withTimestamps();
    }

    // ---- Moderation ----

    /** Actions taken against this account. */
    public function moderationLogs(): HasMany
    {
        return $this->hasMany(ModerationLog::class, 'user_id');
    }

    /** Actions this user performed as an admin. */
    public function adminActions(): HasMany
    {
        return $this->hasMany(ModerationLog::class, 'admin_id');
    }

    // ---- Convenience scopes ----

    public function scopeRole($query, string $role)
    {
        return $query->where('role', $role);
    }

    public function scopePendingApproval($query)
    {
        return $query->where('status', 'pending');
    }

    public function isAdmin(): bool
    {
        return $this->role === 'admin';
    }

    public function isLogistics(): bool
    {
        return $this->role === 'logistics';
    }

    /**
     * Short-lived signed URLs for this user's uploaded documents.
     * Files live on the private 'local' disk (never 'public'), so this is
     * the only way to view them — a link expires in $minutes and the route
     * itself re-checks that the requester is this user or an admin. See
     * DocumentController and README "Document privacy" for the full picture.
     */
    public function documentUrls(int $minutes = 10): array
    {
        $docs = [];

        if ($this->upload_id_path) {
            $docs['id'] = URL::temporarySignedRoute('documents.show', now()->addMinutes($minutes), [
                'user' => $this->id, 'type' => 'id',
            ]);
        }

        if ($this->seller?->business_permit_path) {
            $docs['business_permit'] = URL::temporarySignedRoute('documents.show', now()->addMinutes($minutes), [
                'user' => $this->id, 'type' => 'business_permit',
            ]);
        }

        if ($this->courier?->or_cr_path) {
            $docs['or_cr'] = URL::temporarySignedRoute('documents.show', now()->addMinutes($minutes), [
                'user' => $this->id, 'type' => 'or_cr',
            ]);
        }

        if ($this->courier?->license_path) {
            $docs['license'] = URL::temporarySignedRoute('documents.show', now()->addMinutes($minutes), [
                'user' => $this->id, 'type' => 'license',
            ]);
        }

        if ($this->logisticsCompany?->business_permit_path) {
            $docs['business_permit'] = URL::temporarySignedRoute('documents.show', now()->addMinutes($minutes), [
                'user' => $this->id, 'type' => 'business_permit',
            ]);
        }

        return $docs;
    }
}
