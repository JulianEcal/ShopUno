<?php

return [

    // Applies to every document upload (ID, permit, OR/CR, license).
    'max_size_kb' => 5120, // 5MB — see README for the matching php.ini settings needed
    'accepted_extensions' => ['jpg', 'jpeg', 'png', 'pdf'],
    'accepted_formats_label' => 'JPG, PNG, or PDF',

    // Drives both the Form Request validation messages AND the
    // GET /document-requirements guide shown to users before they upload.
    'requirements' => [
        'buyer' => [
            [
                'field' => 'upload_id',
                'label' => 'Valid ID',
                'description' => 'A government-issued ID showing your full name and a clear photo (e.g. UMID, passport, driver\'s license, national ID).',
            ],
        ],
        'seller' => [
            [
                'field' => 'upload_id',
                'label' => 'Valid ID',
                'description' => 'A government-issued ID showing your full name and a clear photo.',
            ],
            [
                'field' => 'business_permit',
                'label' => 'Business Permit',
                'description' => 'Your current Mayor\'s/Business Permit or DTI registration. Make sure the business name and expiry date are visible.',
            ],
        ],
        'courier' => [
            [
                'field' => 'upload_id',
                'label' => 'Valid ID',
                'description' => 'A government-issued ID showing your full name and a clear photo.',
            ],
            [
                'field' => 'or_cr',
                'label' => 'OR/CR',
                'description' => 'Official Receipt and Certificate of Registration for the vehicle you\'ll use for deliveries.',
            ],
            [
                'field' => 'license',
                'label' => 'Driver\'s License',
                'description' => 'A valid, non-expired driver\'s license matching the vehicle type you selected.',
            ],
        ],
    ],

];
