<?php

namespace App\Http\Controllers\Api\Buyer;

use App\Http\Controllers\Controller;
use App\Http\Requests\Buyer\AddCartItemRequest;
use App\Http\Resources\CartResource;
use App\Models\CartItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class CartController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $cart = $this->cartFor($request)->load('items.product.images', 'items.product.seller', 'items.variation');

        return response()->json(['cart' => new CartResource($cart)]);
    }

    public function addItem(AddCartItemRequest $request): JsonResponse
    {
        $cart = $this->cartFor($request);

        $existing = $cart->items()
            ->where('product_id', $request->validated('product_id'))
            ->where('product_variation_id', $request->validated('product_variation_id'))
            ->first();

        if ($existing) {
            $existing->increment('quantity', $request->validated('quantity'));
        } else {
            $cart->items()->create($request->validated());
        }

        return response()->json([
            'message' => 'Added to cart.',
            'cart' => new CartResource($cart->fresh(['items.product.images', 'items.product.seller', 'items.variation'])),
        ]);
    }

    public function updateItem(Request $request, CartItem $cartItem): JsonResponse
    {
        $this->ensureOwnedByBuyer($request, $cartItem);

        $request->validate(['quantity' => ['required', 'integer', 'min:1']]);

        $cartItem->update(['quantity' => $request->input('quantity')]);

        return response()->json(['message' => 'Cart updated.']);
    }

    public function removeItem(Request $request, CartItem $cartItem): JsonResponse
    {
        $this->ensureOwnedByBuyer($request, $cartItem);

        $cartItem->delete();

        return response()->json(['message' => 'Removed from cart.']);
    }

    /** Every buyer gets a cart lazily on first use — no separate "create cart" step. */
    protected function cartFor(Request $request)
    {
        return $request->user()->cart()->firstOrCreate([]);
    }

    protected function ensureOwnedByBuyer(Request $request, CartItem $cartItem): void
    {
        if ($cartItem->cart->user_id !== $request->user()->id) {
            throw ValidationException::withMessages(['cart_item' => ['This item is not in your cart.']]);
        }
    }
}
