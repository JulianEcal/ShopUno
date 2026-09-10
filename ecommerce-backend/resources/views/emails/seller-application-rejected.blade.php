@component('mail::message')
# Update on your seller application

Hi {{ $firstName }},

Thanks for applying to sell as **{{ $businessName }}**. After review, we're unable to approve this application right now.

**Reason:** {{ $reason }}

You're welcome to correct the details and reapply, or reply to this email with questions. Your buyer account is unaffected either way.

Thanks,<br>
The E-commerce Team
@endcomponent
