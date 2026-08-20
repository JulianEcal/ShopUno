@component('mail::message')
# Your complaint has been resolved

Hi {{ $firstName }},

Your complaint **"{{ $subject }}"** has been reviewed and resolved.

**Resolution:** {{ $resolutionNotes }}

If you have further questions, just reply to this email.

Thanks,<br>
The E-commerce Team
@endcomponent
