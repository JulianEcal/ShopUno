<?php

return [

    // Only these keys can be written via PATCH /admin/settings — keeps the
    // settings table from becoming an arbitrary key-value dumping ground.
    // Each entry's label/description is what the admin UI can render as a
    // form field, same pattern as config/documents.php driving its guide endpoint.
    'fields' => [
        'platform_name' => [
            'label' => 'Platform Name',
            'description' => 'Shown in emails and the app header.',
        ],
        'support_email' => [
            'label' => 'Support Email',
            'description' => 'Where users are told to reach out with issues.',
        ],
        'terms_of_service' => [
            'label' => 'Terms of Service',
            'description' => 'Full policy text shown to users during registration.',
        ],
        'privacy_policy' => [
            'label' => 'Privacy Policy',
            'description' => 'Full policy text shown to users during registration.',
        ],
        'seller_agreement' => [
            'label' => 'Seller Agreement',
            'description' => 'Terms specific to sellers — commission, compliance expectations, etc.',
        ],
    ],

];
