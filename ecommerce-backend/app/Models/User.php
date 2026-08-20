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
        'email', 'password',
        'contact_no', 'birthday', 'age', 'upload_id_path',
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

    // ---- Role-specific extension tables ----

    public function address(): HasOne
    {
        return $this->hasOne(Address::class);
    }

    public function seller(): HasOne
    {
        return $this->hasOne(Seller::class);
    }

    public function courier(): HasOne
    {
        return $this->hasOne(Courier::class);
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

        return $docs;
    }
}
