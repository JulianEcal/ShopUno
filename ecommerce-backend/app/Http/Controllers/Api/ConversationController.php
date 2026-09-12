<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Messaging\SendMessageRequest;
use App\Http\Requests\Messaging\StartConversationRequest;
use App\Http\Resources\ConversationResource;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ConversationController extends Controller
{
    /** Mirrors the frontend's own UNSEND_WINDOW_MS (see seller-messages.js
     *  / buyer-messages.js) — keep the two in sync if this ever changes. */
    protected const UNSEND_WINDOW_MINUTES = 10;

    /** GET /conversations — the current user's threads, most recently active first. */
    public function index(Request $request): JsonResponse
    {
        $conversations = $request->user()->conversations()
            ->with(['participants.seller', 'latestMessage', 'product.images', 'productVariation'])
            ->orderByDesc(
                \App\Models\Message::select('created_at')
                    ->whereColumn('conversation_id', 'conversations.id')
                    ->latest()
                    ->limit(1)
            )
            ->get();

        return response()->json([
            'data' => ConversationResource::collection($conversations),
        ]);
    }

    /**
     * POST /conversations
     * Finds an existing 1:1 thread with the recipient before creating a new
     * one — repeatedly messaging the same person shouldn't fork into
     * duplicate conversations. Scoping works like a three-level fallback:
     * an order_id (if given) is the strongest scope, since everything
     * about that order belongs in one thread. Without an order, a
     * product_id (e.g. "Message" from a product's quick-view) scopes it
     * instead, so separate "which item is this about" threads don't get
     * merged into one — and if a specific variant was selected
     * (product_variation_id), that's part of the scope too, so asking
     * about a different size/style of the same product opens its own
     * thread rather than dropping into whatever thread that product last
     * matched. With neither order nor product, it's a single general
     * thread with that recipient.
     */
    public function store(StartConversationRequest $request): JsonResponse
    {
        $me = $request->user();
        $recipient = User::findOrFail($request->validated('recipient_id'));
        $orderId = $request->validated('order_id');
        $productId = $request->validated('product_id');
        $variationId = $request->validated('product_variation_id');

        $conversation = DB::transaction(function () use ($me, $recipient, $orderId, $productId, $variationId, $request) {
            $existing = Conversation::query()
                ->when(
                    $orderId,
                    fn ($q) => $q->where('order_id', $orderId),
                    fn ($q) => $q->whereNull('order_id')
                        ->when(
                            $productId,
                            fn ($q) => $q->where('product_id', $productId)
                                ->when(
                                    $variationId,
                                    fn ($q) => $q->where('product_variation_id', $variationId),
                                    fn ($q) => $q->whereNull('product_variation_id')
                                ),
                            fn ($q) => $q->whereNull('product_id')->whereNull('product_variation_id')
                        )
                )
                ->whereHas('participants', fn ($q) => $q->where('user_id', $me->id))
                ->whereHas('participants', fn ($q) => $q->where('user_id', $recipient->id))
                ->first();

            $conversation = $existing ?? Conversation::create([
                'order_id' => $orderId,
                'product_id' => $productId,
                'product_variation_id' => $variationId,
            ]);

            if (! $existing) {
                $conversation->participants()->attach([$me->id, $recipient->id]);
            }

            $conversation->messages()->create([
                'sender_id' => $me->id,
                'body' => $request->validated('body'),
            ]);

            return $conversation;
        });

        return response()->json([
            'message' => 'Message sent.',
            'conversation' => new ConversationResource(
                $conversation->load(['participants.seller', 'latestMessage', 'product.images', 'productVariation'])
            ),
        ], 201);
    }

    /** GET /conversations/{id}/messages — also marks the thread read for the current user. */
    public function messages(Request $request, Conversation $conversation): JsonResponse
    {
        $this->ensureParticipant($request, $conversation);

        $messages = $conversation->messages()->with(['sender:id,first_name,last_name', 'reactions'])->paginate(30);

        $conversation->participants()->updateExistingPivot($request->user()->id, [
            'last_read_at' => now(),
        ]);

        return $this->paginatedResponse(MessageResource::collection($messages), $messages);
    }

    public function sendMessage(SendMessageRequest $request, Conversation $conversation): JsonResponse
    {
        $this->ensureParticipant($request, $conversation);

        $attachment = [];
        if ($request->hasFile('attachment')) {
            $file = $request->file('attachment');
            $attachment = [
                'attachment_path' => $file->store('message-attachments/' . $conversation->id, 'public'),
                'attachment_name' => $file->getClientOriginalName(),
                'attachment_mime' => $file->getMimeType(),
                'attachment_size' => $file->getSize(),
                'attachment_type' => Str::startsWith($file->getMimeType(), 'image/') ? 'image' : 'file',
            ];
        }

        $message = $conversation->messages()->create([
            'sender_id' => $request->user()->id,
            'body' => $request->validated('body'),
            ...$attachment,
        ]);

        $conversation->touch();

        return response()->json([
            'message' => new MessageResource($message->load(['sender:id,first_name,last_name', 'reactions'])),
        ], 201);
    }

    /**
     * POST /conversations/{conversation}/messages/{message}/reactions
     * Toggle: tapping an emoji you've already put on this message removes
     * it, tapping a new one adds it — one endpoint covers both so the
     * frontend doesn't need to track "is this add or remove" itself.
     */
    public function toggleReaction(Request $request, Conversation $conversation, Message $message): JsonResponse
    {
        $this->ensureParticipant($request, $conversation);

        if ($message->conversation_id !== $conversation->id) {
            abort(404, 'This message does not belong to this conversation.');
        }

        $validated = $request->validate([
            'emoji' => ['required', 'string', 'max:16'],
        ]);

        $user = $request->user();
        $existing = $message->reactions()->where('user_id', $user->id)->where('emoji', $validated['emoji'])->first();

        if ($existing) {
            $existing->delete();
        } else {
            $message->reactions()->create(['user_id' => $user->id, 'emoji' => $validated['emoji']]);
        }

        return response()->json([
            'message' => new MessageResource($message->load(['sender:id,first_name,last_name', 'reactions'])),
        ]);
    }

    /**
     * DELETE /conversations/{conversation}/messages/{message}
     * "Unsends" a message — mirrors Shopee's own rule: only the sender,
     * and only within 10 minutes of sending it. The row itself is never
     * deleted (that would shift pagination/order for whoever's mid-scroll
     * on the other end); instead its content is wiped and `unsent_at` is
     * stamped, and MessageResource collapses it into a placeholder for
     * both participants from that point on. Any attachment file and
     * reactions go with it — there's nothing left to react to.
     */
    public function unsendMessage(Request $request, Conversation $conversation, Message $message): JsonResponse
    {
        $this->ensureParticipant($request, $conversation);

        if ($message->conversation_id !== $conversation->id) {
            abort(404, 'This message does not belong to this conversation.');
        }

        if ($message->sender_id !== $request->user()->id) {
            abort(403, 'You can only unsend your own messages.');
        }

        if ($message->unsent_at) {
            abort(422, 'This message has already been unsent.');
        }

        if ($message->created_at->diffInMinutes(now()) >= self::UNSEND_WINDOW_MINUTES) {
            abort(422, 'Messages can only be unsent within 10 minutes of sending.');
        }

        if ($message->attachment_path) {
            Storage::disk('public')->delete($message->attachment_path);
        }

        $message->reactions()->delete();
        $message->forceFill([
            'body' => null,
            'attachment_path' => null,
            'attachment_name' => null,
            'attachment_mime' => null,
            'attachment_size' => null,
            'attachment_type' => null,
            'unsent_at' => now(),
        ])->save();

        return response()->json([
            'message' => new MessageResource($message->fresh(['sender:id,first_name,last_name', 'reactions'])),
        ]);
    }

    protected function ensureParticipant(Request $request, Conversation $conversation): void
    {
        if (! $conversation->participants()->where('user_id', $request->user()->id)->exists()) {
            abort(403, 'You are not part of this conversation.');
        }
    }
}
