<?php

namespace App\Mail;

use App\Models\Product;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class ProductComplianceNotice extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(public Product $product, public string $type, public string $note)
    {
    }

    public function build(): self
    {
        $subjects = [
            'flag' => "Your listing \"{$this->product->name}\" needs review",
            'resolve' => "Update on your listing \"{$this->product->name}\"",
            'archive' => "Your listing \"{$this->product->name}\" has been removed",
        ];

        return $this
            ->subject($subjects[$this->type] ?? 'Update on your product listing')
            ->markdown('emails.product-compliance-notice', [
                'firstName' => $this->product->seller->user->first_name,
                'productName' => $this->product->name,
                'type' => $this->type,
                'note' => $this->note,
            ]);
    }
}
