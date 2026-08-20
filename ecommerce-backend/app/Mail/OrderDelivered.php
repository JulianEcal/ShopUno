<?php

namespace App\Mail;

use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class OrderDelivered extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(public Order $order)
    {
    }

    public function build(): self
    {
        return $this
            ->subject("Order #{$this->order->id} has been delivered")
            ->markdown('emails.order-delivered', [
                'firstName' => $this->order->seller->user->first_name,
                'orderId' => $this->order->id,
                'total' => number_format((float) $this->order->total, 2),
            ]);
    }
}
