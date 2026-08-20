@component('mail::message')
@if ($type === 'flag')
# A listing needs your attention

Hi {{ $firstName }},

Your listing **{{ $productName }}** has been flagged for review by our team.

**Reason:** {{ $note }}

Please review and update the listing if needed. It's still visible to buyers while under review.
@elseif ($type === 'resolve')
# Review complete

Hi {{ $firstName }},

Good news — after review, your listing **{{ $productName }}** has been cleared. No action is needed.
@if ($note)

**Note:** {{ $note }}
@endif
@elseif ($type === 'archive')
# Listing removed

Hi {{ $firstName }},

Your listing **{{ $productName }}** has been removed from E-commerce by our compliance team.

**Reason:** {{ $note }}

If you believe this was a mistake, please reply to this email.
@endif

Thanks,<br>
The E-commerce Team
@endcomponent
