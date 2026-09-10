@component('mail::message')
# You're now a Seller

Hi {{ $firstName }},

Good news — your application for **{{ $businessName }}** has been approved. Your account now has seller access, and you can start listing products right away.

Thanks,<br>
The E-commerce Team
@endcomponent
