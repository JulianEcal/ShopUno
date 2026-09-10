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
                // Sellers are shown by their shop, not their personal name —
                // a buyer messaging a seller shouldn't see the owner's legal
                // name any more than they would on a real storefront. Buyers
                // (no `seller` row) fall through to their personal name,
                // which is what a seller sees when a buyer messages them.
                'name' => $u->role === 'seller'
                    ? ($u->seller?->business_name ?: "{$u->first_name} {$u->last_name}")
                    : "{$u->first_name} {$u->last_name}",
                'role' => $u->role,
                // Same reasoning as `name` above: a seller is shown by their
                // shop's own logo here, not the personal avatar_url used
                // when they're a buyer. Falls back to their personal avatar
                // (then initials, client-side) if the shop hasn't set a logo.
                'avatar_url' => $u->role === 'seller'
                    ? ($u->seller?->logo_url ?: $u->avatar_url)
                    : $u->avatar_url,
            ]),
            // The product this thread started from (e.g. buyer hit
            // "Message" from a product's quick-view) — null for
            // order-scoped or general threads.
            'product' => $this->whenLoaded('product', fn () => $this->product ? [
                'id' => $this->product->id,
                'name' => $this->product->name,
                'image_url' => $this->product->images->first()?->url,
                // The specific variant this thread was scoped to (e.g.
                // "Small / Jersey Only"), if the buyer had one selected —
                // null for a general "about this product" thread. This is
                // what lets the frontend tell threads about different
                // variants of the same product apart, instead of treating
                // every variant as one merged conversation.
                'variation' => $this->whenLoaded('productVariation', fn () => $this->productVariation ? [
                    'id' => $this->productVariation->id,
                    'label' => $this->productVariation->value,
                ] : null),
            ] : null),
            'last_message' => $this->whenLoaded('latestMessage', fn () => $this->latestMessage ? [
                // Attachment-only messages have no body — give the list
                // preview something to show instead of a blank line. An
                // unsent message has neither, and the frontend swaps in
                // its own "You/They unsent a message" line whenever
                // `is_unsent` is set, so `body` just goes null here.
                'body' => $this->latestMessage->unsent_at
                    ? null
                    : ($this->latestMessage->body
                        ?: ($this->latestMessage->attachment_type === 'image' ? '📷 Photo' : '📎 ' . ($this->latestMessage->attachment_name ?: 'Attachment'))),
                'sender_id' => $this->latestMessage->sender_id,
                'is_unsent' => (bool) $this->latestMessage->unsent_at,
                'created_at' => $this->latestMessage->created_at?->toIso8601String(),
            ] : null),
            'unread_count' => $this->unreadCountFor($me),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
