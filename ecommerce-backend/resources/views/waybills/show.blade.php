<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Waybill {{ $waybill['waybill_number'] }}</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            margin: 0;
            padding: 24px;
            background: #f2f2f2;
            color: #111;
        }
        .label {
            max-width: 620px;
            margin: 0 auto;
            background: #fff;
            border: 2px solid #111;
            padding: 20px;
        }
        .label__header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #111;
            padding-bottom: 12px;
            margin-bottom: 12px;
        }
        .label__platform { font-size: 14px; font-weight: bold; letter-spacing: 0.5px; }
        .label__cod {
            text-align: right;
            font-size: 12px;
        }
        .label__cod strong { display: block; font-size: 20px; }
        .barcode {
            font-family: 'Libre Barcode 39', monospace;
            letter-spacing: 2px;
        }
        .fake-barcode {
            display: flex;
            gap: 2px;
            height: 46px;
            align-items: flex-end;
            margin: 10px 0 6px;
        }
        .fake-barcode span {
            display: inline-block;
            width: 3px;
            background: #111;
        }
        .tracking {
            text-align: center;
            margin-bottom: 16px;
        }
        .tracking__number {
            font-size: 20px;
            font-weight: bold;
            letter-spacing: 3px;
        }
        .addresses {
            display: flex;
            gap: 16px;
            margin-bottom: 16px;
        }
        .address-block {
            flex: 1;
            border: 1px solid #ccc;
            padding: 10px 12px;
        }
        .address-block h4 {
            margin: 0 0 6px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #555;
        }
        .address-block p { margin: 2px 0; font-size: 13px; }
        table.items {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12px;
            font-size: 13px;
        }
        table.items th, table.items td {
            border: 1px solid #ccc;
            padding: 6px 8px;
            text-align: left;
        }
        table.items th { background: #f7f7f7; }
        .meta {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: #444;
            border-top: 1px dashed #999;
            padding-top: 10px;
        }
        .print-btn {
            display: block;
            max-width: 620px;
            margin: 0 auto 14px;
            text-align: right;
        }
        .print-btn button {
            padding: 8px 16px;
            font-size: 14px;
            cursor: pointer;
        }
        @media print {
            body { background: #fff; padding: 0; }
            .label { border: 2px solid #000; }
            .print-btn { display: none; }
        }
    </style>
</head>
<body>
    <div class="print-btn"><button onclick="window.print()">Print / Save as PDF</button></div>

    <div class="label">
        <div class="label__header">
            <div class="label__platform">{{ $waybill['platform_name'] }}<br><small>Shipping Label</small></div>
            <div class="label__cod">
                COD TO COLLECT
                <strong>&#8369;{{ number_format($waybill['cod_amount'], 2) }}</strong>
            </div>
        </div>

        <div class="tracking">
            <div class="fake-barcode" aria-hidden="true">
                @php
                    // Purely decorative bar pattern derived from the tracking
                    // number's characters — not a scannable barcode, just a
                    // visual cue that this is a label. No barcode library
                    // available in this sandbox (see README, no packagist access).
                    $bars = str_split($waybill['waybill_number']);
                @endphp
                @foreach ($bars as $i => $char)
                    <span style="height: {{ 18 + (ord($char) % 28) }}px;"></span>
                @endforeach
            </div>
            <div class="tracking__number">{{ $waybill['waybill_number'] }}</div>
            <div>Order #{{ $waybill['order_id'] }} &middot; via {{ $waybill['logistics_company'] }}</div>
        </div>

        <div class="addresses">
            <div class="address-block">
                <h4>From (Seller)</h4>
                <p><strong>{{ $waybill['sender']['name'] }}</strong></p>
                <p>{{ $waybill['sender']['contact_no'] ?? '—' }}</p>
                <p>{{ $waybill['sender']['address'] ?? 'No address on file' }}</p>
            </div>
            <div class="address-block">
                <h4>To (Buyer)</h4>
                <p><strong>{{ $waybill['receiver']['name'] }}</strong></p>
                <p>{{ $waybill['receiver']['contact_no'] ?? '—' }}</p>
                <p>{{ $waybill['receiver']['address'] ?? 'No address on file' }}</p>
            </div>
        </div>

        <table class="items">
            <thead>
                <tr><th>Item</th><th style="width: 60px;">Qty</th></tr>
            </thead>
            <tbody>
                @foreach ($waybill['items'] as $item)
                    <tr>
                        <td>{{ $item['product_name'] }}</td>
                        <td>{{ $item['quantity'] }}</td>
                    </tr>
                @endforeach
            </tbody>
        </table>

        <div class="meta">
            <span>Generated: {{ \Illuminate\Support\Carbon::parse($waybill['generated_at'])->format('M j, Y g:i A') }}</span>
            <span>Cash on Delivery</span>
        </div>
    </div>
</body>
</html>
