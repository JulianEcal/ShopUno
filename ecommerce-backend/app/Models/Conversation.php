<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Conversation extends Model
{
    protected $fillable = ['order_id', 'product_id', 'product_variation_id'];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    /** The product this conversation started from (e.g. "Message" from a product's quick-view), if any. */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /** The specific variant (e.g. "Small / Jersey Only") this conversation started from, if the buyer had one selected. */
    public function productVariation(): BelongsTo
    {
        return $this->belongsTo(ProductVariation::class);
    }

    public function participants(): BelongsToMany
    {
        return $this->belongsToMany(User::class)
            ->withPivot('last_read_at')
            ->withTimestamps();
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class)->oldest();
    }

    public function latestMessage(): HasOne
    {
        return $this->hasOne(Message::class)->latestOfMany();
    }

    /** Unread messages in this conversation for a given user (not sent by them). */
    public function unreadCountFor(User $user): int
    {
        $lastReadAt = $this->participants()
            ->where('user_id', $user->id)
            ->first()
            ?->pivot
            ?->last_read_at;

        return $this->messages()
            ->where('sender_id', '!=', $user->id)
            ->when($lastReadAt, fn ($q) => $q->where('created_at', '>', $lastReadAt))
            ->count();
    }
}
