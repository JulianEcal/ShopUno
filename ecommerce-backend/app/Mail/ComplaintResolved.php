<?php

namespace App\Mail;

use App\Models\Complaint;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class ComplaintResolved extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(public Complaint $complaint)
    {
    }

    public function build(): self
    {
        return $this
            ->subject("Update on your complaint: {$this->complaint->subject}")
            ->markdown('emails.complaint-resolved', [
                'firstName' => $this->complaint->filedBy->first_name,
                'subject' => $this->complaint->subject,
                'resolutionNotes' => $this->complaint->resolution_notes,
            ]);
    }
}
