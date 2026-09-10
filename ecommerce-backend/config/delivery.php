<?php

return [
    // Flat fee (in pesos) paid to the courier per completed delivery.
    // Computed on the fly from delivered deliveries — never stored per-row,
    // same reasoning as config/commission.php: one place to change the rate,
    // and reports can never disagree with each other about what it currently is.
    //
    // A distance/size-based fee would need a real column on `deliveries` and
    // is a bigger decision than this project has settled on yet — flat fee
    // was chosen as the simplest thing that's still genuinely useful.
    'flat_fee_per_delivery' => 50,
];
