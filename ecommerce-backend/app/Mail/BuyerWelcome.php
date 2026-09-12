<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class BuyerWelcome extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(public User $user)
    {
    }

    public function build(): self
    {
        return $this
            ->subject('Welcome — your account is ready')
            ->markdown('emails.buyer-welcome', [
                'firstName' => $this->user->first_name,
            ]);
    }
}
