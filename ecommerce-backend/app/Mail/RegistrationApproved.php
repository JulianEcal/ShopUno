<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class RegistrationApproved extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(public User $user)
    {
    }

    public function build(): self
    {
        return $this
            ->subject('Your E-commerce registration has been approved')
            ->markdown('emails.registration-approved', [
                'firstName' => $this->user->first_name,
                'role' => $this->user->role,
            ]);
    }
}
