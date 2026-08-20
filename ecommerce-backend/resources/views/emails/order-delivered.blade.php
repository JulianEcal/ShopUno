@component('mail::message')
# Order delivered

Hi {{ $firstName }},

Good news — order **#{{ $orderId }}** (₱{{ $total }}) has been confirmed delivered by the courier. Cash on delivery has been collected.

Thanks,<br>
The Team
@endcomponent
