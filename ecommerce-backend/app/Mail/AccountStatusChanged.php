<?php

namespace App\Mail;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class AccountStatusChanged extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(public User $user, public string $type, public string $note = '')
    {
    }

    public function build(): self
    {
        $subjects = [
            'warn' => 'A note about your E-commerce account',
            'activate' => 'Your E-commerce account is active',
            'suspend' => 'Your E-commerce account has been suspended',
            'deactivate' => 'Your E-commerce account has been deactivated',
        ];

        return $this
            ->subject($subjects[$this->type] ?? 'Update on your E-commerce account')
            ->markdown('emails.account-status-changed', [
                'firstName' => $this->user->first_name,
                'type' => $this->type,
                'note' => $this->note,
            ]);
    }
}
