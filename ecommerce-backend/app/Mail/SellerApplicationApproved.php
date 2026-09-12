<?php

namespace App\Mail;

use App\Models\SellerApplication;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class SellerApplicationApproved extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(public SellerApplication $application)
    {
    }

    public function build(): self
    {
        return $this
            ->subject('Your seller application has been approved')
            ->markdown('emails.seller-application-approved', [
                'firstName' => $this->application->user->first_name,
                'businessName' => $this->application->business_name,
            ]);
    }
}
