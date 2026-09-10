<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Storage;

class MessageResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $me = $request->user();
        $isUnsent = (bool) $this->unsent_at;

        return [
            'id' => $this->id,
            // An unsent message has already had its body/attachment wiped
            // in the database (see ConversationController::unsendMessage),
            // but this guards the same either way so nothing leaks if a
            // future write path forgets to clear one of these columns.
            'body' => $isUnsent ? null : $this->body,
            'sender_id' => $this->sender_id,
            'sender_name' => "{$this->sender->first_name} {$this->sender->last_name}",
            'is_mine' => $this->sender_id === $me->id,
            'is_unsent' => $isUnsent,
            'attachment' => (! $isUnsent && $this->attachment_path) ? [
                'type' => $this->attachment_type,
                'url' => Storage::disk('public')->url($this->attachment_path),
                'name' => $this->attachment_name,
                'mime' => $this->attachment_mime,
                'size' => $this->attachment_size,
            ] : null,
            // Grouped by emoji so the bubble can render one pill per emoji
            // with a count, rather than the client having to group raw
            // rows itself — `reacted_by_me` drives the pill's active state
            // (tap to remove) without a second lookup. Reactions are
            // cleared server-side the moment a message is unsent, so this
            // just short-circuits to empty rather than relying on that.
            'reactions' => $isUnsent ? [] : $this->whenLoaded('reactions', function () use ($me) {
                return $this->reactions
                    ->groupBy('emoji')
                    ->map(fn ($group, $emoji) => [
                        'emoji' => $emoji,
                        'count' => $group->count(),
                        'reacted_by_me' => $group->contains('user_id', $me->id),
                    ])
                    ->values();
            }),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
