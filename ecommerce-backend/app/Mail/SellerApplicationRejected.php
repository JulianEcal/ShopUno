<?php

namespace App\Mail;

use App\Models\SellerApplication;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class SellerApplicationRejected extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(public SellerApplication $application)
    {
    }

    public function build(): self
    {
        return $this
            ->subject('Update on your seller application')
            ->markdown('emails.seller-application-rejected', [
                'firstName' => $this->application->user->first_name,
                'businessName' => $this->application->business_name,
                'reason' => $this->application->rejection_reason,
            ]);
    }
}
