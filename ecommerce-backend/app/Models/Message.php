<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\Storage;

class Message extends Model
{
    protected $fillable = [
        'conversation_id',
        'sender_id',
        'body',
        'attachment_path',
        'attachment_name',
        'attachment_mime',
        'attachment_size',
        'attachment_type',
    ];

    // `unsent_at` is deliberately left out of $fillable — it's never set
    // from user input, only stamped server-side via forceFill() inside
    // ConversationController::unsendMessage().
    protected $casts = [
        'unsent_at' => 'datetime',
    ];

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sender_id');
    }

    public function reactions(): HasMany
    {
        return $this->hasMany(MessageReaction::class);
    }

    /** Public URL for the attachment, if any — same public disk as product images. */
    public function attachmentUrl(): ?string
    {
        return $this->attachment_path ? \App\Support\StorageUrl::for($this->attachment_path) : null;
    }
}