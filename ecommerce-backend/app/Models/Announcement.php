<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Announcement extends Model
{
    protected $fillable = ['admin_id', 'title', 'body', 'is_published'];

    protected $casts = [
        'is_published' => 'boolean',
    ];

    public function admin(): BelongsTo
    {
        return $this->belongsTo(User::class, 'admin_id');
    }

    public function scopePublished($query)
    {
        return $query->where('is_published', true);
    }
}
