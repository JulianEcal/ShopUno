<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class RegistrationRejected extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(public User $user, public string $reason)
    {
    }

    public function build(): self
    {
        return $this
            ->subject('Update on your E-commerce registration')
            ->markdown('emails.registration-rejected', [
                'firstName' => $this->user->first_name,
                'reason' => $this->reason,
            ]);
    }
}
