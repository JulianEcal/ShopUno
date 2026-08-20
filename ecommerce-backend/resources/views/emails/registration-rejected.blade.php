@component('mail::message')
# Update on your registration

Hi {{ $firstName }},

Thanks for your interest in E-commerce. After review, we're unable to approve your registration at this time.

**Reason:** {{ $reason }}

If you believe this was a mistake, or you'd like to correct and resubmit your details, please reply to this email.

Thanks,<br>
The E-commerce Team
@endcomponent
