@component('mail::message')
# Welcome to E-commerce

Hi {{ $firstName }},

Good news — your **{{ ucfirst($role) }}** registration has been reviewed and approved. You can now log in and start using your account.

@component('mail::button', ['url' => config('app.frontend_url', config('app.url'))])
Log in to E-commerce
@endcomponent

If you have any questions, just reply to this email.

Thanks,<br>
The E-commerce Team
@endcomponent
