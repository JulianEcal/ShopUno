<?php

namespace App\Mail;

use App\Models\Courier;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class RiderApplicationStatus extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(public Courier $courier, public string $decision, public ?string $reason = null)
    {
    }

    public function build(): self
    {
        $companyName = $this->courier->logisticsCompany->company_name;

        $subject = $this->decision === 'approved'
            ? "You're approved to ride for {$companyName}"
            : "Update on your application to {$companyName}";

        return $this
            ->subject($subject)
            ->markdown('emails.rider-application-status', [
                'firstName' => $this->courier->user->first_name,
                'companyName' => $companyName,
                'decision' => $this->decision,
                'reason' => $this->reason,
            ]);
    }
}
