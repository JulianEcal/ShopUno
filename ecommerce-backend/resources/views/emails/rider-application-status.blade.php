@component('mail::message')
@if ($decision === 'approved')
# You're approved!

Hi {{ $firstName }},

**{{ $companyName }}** has approved your rider application. You can now log in and start accepting deliveries.
@else
# Update on your application

Hi {{ $firstName }},

Thanks for applying to ride for **{{ $companyName }}**. After review, they're unable to approve your application right now.

**Reason:** {{ $reason }}
@endif

Thanks,<br>
The E-commerce Team
@endcomponent
