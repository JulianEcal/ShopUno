<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ConversationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $me = $request->user();
        $others = $this->participants->where('id', '!=', $me->id)->values();

        return [
            'id' => $this->id,
            'order_id' => $this->order_id,
            'participants' => $others->map(fn ($u) => [
                'id' => $u->id,
                'name' => "{$u->first_name} {$u->last_name}",
                'role' => $u->role,
            ]),
            'last_message' => $this->whenLoaded('latestMessage', fn () => $this->latestMessage ? [
                'body' => $this->latestMessage->body,
                'sender_id' => $this->latestMessage->sender_id,
                'created_at' => $this->latestMessage->created_at?->toIso8601String(),
            ] : null),
            'unread_count' => $this->unreadCountFor($me),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
