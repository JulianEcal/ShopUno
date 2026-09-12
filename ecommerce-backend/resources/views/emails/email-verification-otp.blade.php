@component('mail::message')
# Verify your email

Enter this code to confirm your email address and continue creating your ShopUno account:

@component('mail::panel')
<div style="font-size:28px; font-weight:700; letter-spacing:6px; text-align:center;">{{ $code }}</div>
@endcomponent

This code expires in {{ $expiresInMinutes }} minutes. If you didn't request this, you can safely ignore this email.

Thanks,<br>
The ShopUno Team
@endcomponent
