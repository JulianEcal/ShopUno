@component('mail::message')
@if ($type === 'warn')
# A note about your account

Hi {{ $firstName }},

Our team reviewed your account and wanted to flag something:

**{{ $note }}**

No action is needed right now, but repeated issues may lead to account suspension. If you have questions, just reply to this email.
@elseif ($type === 'activate')
# Your account is active

Hi {{ $firstName }},

Your E-commerce account has been (re)activated and you can now log in as usual.
@if ($note)

**Note:** {{ $note }}
@endif
@elseif ($type === 'suspend')
# Your account has been suspended

Hi {{ $firstName }},

Your E-commerce account has been temporarily suspended.

**Reason:** {{ $note }}

You won't be able to log in while your account is suspended. If you'd like to appeal this, please reply to this email.
@elseif ($type === 'deactivate')
# Your account has been deactivated

Hi {{ $firstName }},

Your E-commerce account has been deactivated.

**Reason:** {{ $note }}

If you believe this was a mistake, please reply to this email.
@endif

Thanks,<br>
The E-commerce Team
@endcomponent
