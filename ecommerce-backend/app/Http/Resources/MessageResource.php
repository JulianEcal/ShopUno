<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MessageResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'body' => $this->body,
            'sender_id' => $this->sender_id,
            'sender_name' => "{$this->sender->first_name} {$this->sender->last_name}",
            'is_mine' => $this->sender_id === $request->user()->id,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
