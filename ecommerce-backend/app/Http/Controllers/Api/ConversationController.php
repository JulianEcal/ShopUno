<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Messaging\SendMessageRequest;
use App\Http\Requests\Messaging\StartConversationRequest;
use App\Http\Resources\ConversationResource;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ConversationController extends Controller
{
    /** GET /conversations — the current user's threads, most recently active first. */
    public function index(Request $request): JsonResponse
    {
        $conversations = $request->user()->conversations()
            ->with(['participants', 'latestMessage'])
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
     * Finds an existing 1:1 thread with the recipient (scoped to the same
     * order, if one's given) before creating a new one — repeatedly
     * messaging the same person about the same order shouldn't fork into
     * duplicate conversations.
     */
    public function store(StartConversationRequest $request): JsonResponse
    {
        $me = $request->user();
        $recipient = User::findOrFail($request->validated('recipient_id'));
        $orderId = $request->validated('order_id');

        $conversation = DB::transaction(function () use ($me, $recipient, $orderId, $request) {
            $existing = Conversation::query()
                ->when($orderId, fn ($q) => $q->where('order_id', $orderId), fn ($q) => $q->whereNull('order_id'))
                ->whereHas('participants', fn ($q) => $q->where('user_id', $me->id))
                ->whereHas('participants', fn ($q) => $q->where('user_id', $recipient->id))
                ->first();

            $conversation = $existing ?? Conversation::create(['order_id' => $orderId]);

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
            'conversation' => new ConversationResource($conversation->load(['participants', 'latestMessage'])),
        ], 201);
    }

    /** GET /conversations/{id}/messages — also marks the thread read for the current user. */
    public function messages(Request $request, Conversation $conversation): JsonResponse
    {
        $this->ensureParticipant($request, $conversation);

        $messages = $conversation->messages()->with('sender:id,first_name,last_name')->paginate(30);

        $conversation->participants()->updateExistingPivot($request->user()->id, [
            'last_read_at' => now(),
        ]);

        return response()->json([
            'data' => MessageResource::collection($messages),
        ]);
    }

    public function sendMessage(SendMessageRequest $request, Conversation $conversation): JsonResponse
    {
        $this->ensureParticipant($request, $conversation);

        $message = $conversation->messages()->create([
            'sender_id' => $request->user()->id,
            'body' => $request->validated('body'),
        ]);

        $conversation->touch();

        return response()->json([
            'message' => new MessageResource($message->load('sender:id,first_name,last_name')),
        ], 201);
    }

    protected function ensureParticipant(Request $request, Conversation $conversation): void
    {
        if (! $conversation->participants()->where('user_id', $request->user()->id)->exists()) {
            abort(403, 'You are not part of this conversation.');
        }
    }
}
