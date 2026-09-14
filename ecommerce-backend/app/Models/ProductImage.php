<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

class ProductImage extends Model
{
    protected $fillable = ['product_id', 'path', 'sort_order'];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /**
     * Resolves `path` to a ready-to-use URL. Real uploads (via
     * ProductImageController::store()) always store a local relative path,
     * but seeded/demo data can store a full external URL directly — so this
     * passes those through as-is instead of nesting them inside a broken
     * local storage URL.
     */
    public function getUrlAttribute(): string
    {
        return \App\Support\StorageUrl::for($this->path);
    }
}