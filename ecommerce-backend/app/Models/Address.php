<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Address extends Model
{
    protected $fillable = [
        'user_id', 'label', 'province', 'municipality', 'barangay', 'street', 'house_number',
        'recipient_name', 'recipient_phone', 'is_default',
    ];

    protected $casts = [
        'is_default' => 'boolean',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** One-line "house_number, street, barangay, municipality, province" for display. */
    public function fullLine(): string
    {
        return collect([$this->house_number, $this->street, $this->barangay, $this->municipality, $this->province])
            ->filter()
            ->implode(', ');
    }
}
