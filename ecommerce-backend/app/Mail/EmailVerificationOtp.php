<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class EmailVerificationOtp extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    public function __construct(public string $code, public int $expiresInMinutes)
    {
    }

    public function build(): self
    {
        return $this
            ->subject("{$this->code} is your ShopUno verification code")
            ->markdown('emails.email-verification-otp', [
                'code' => $this->code,
                'expiresInMinutes' => $this->expiresInMinutes,
            ]);
    }
}
