<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Product;
use App\Models\Seller;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

/**
 * Sample storefront data so the buyer catalog / quick-view / cart pages
 * have something real to render. Run with:
 *   php artisan db:seed --class=Database\\Seeders\\DemoProductSeeder
 *
 * ProductResource passes `path` straight through, and the buyer
 * frontend's resolveImage() already treats any http(s) path as absolute
 * and uses it as-is — nothing needs to be uploaded to local storage.
 *
 * Images are hotlinked from Wikimedia Commons via Special:FilePath, e.g.
 *   https://commons.wikimedia.org/wiki/Special:FilePath/Jackfruit.jpg
 * (a stable, permanent redirect straight to the full-size file — no need
 * to resolve the hashed /upload.wikimedia.org/.../a/ab/ path yourself).
 * This replaces the previous LoremFlickr-based URLs, which depended on a
 * third-party keyword-matching proxy that Flickr has repeatedly rate
 * limited/blocked (down for stretches in 2024-2025), causing demo photos
 * to intermittently fail to load. Commons files are permanent, CC-licensed
 * uploads with no such dependency, and each one below was picked to
 * actually match its product's name.
 *
 * `options` describes the Shopee-style option groups for a product (at
 * most two, e.g. "Style" + "Size"). Each combination of values gets its
 * own generated stock/price via `combos` — a flat list keyed by the same
 * order as the cross-product of the option values, OR, for products with
 * only one option group, simply one entry per value. Products with no
 * `options` key sell as a single flat item using `stock`/`base_price`.
 */
class DemoProductSeeder extends Seeder
{
    public function run(): void
    {
        $categories = collect([
            'Fresh Produce', 'Electronics', 'Home & Living', 'Fashion', 'Health & Beauty', 'Sports & Outdoors',
        ])->mapWithKeys(fn ($name) => [$name => Category::firstOrCreate(['name' => $name])->id]);

        $sellerA = $this->makeSeller('Aling Nena\'s Sari-Sari Store', 'Fresh Produce', 'nena@shopuno.test');
        $sellerB = $this->makeSeller('Bright Bytes Electronics', 'Electronics', 'brightbytes@shopuno.test');
        $sellerC = $this->makeSeller('Casa Linda Home Goods', 'Home & Living', 'casalinda@shopuno.test');
        $sellerD = $this->makeSeller('Tela & Thread Apparel', 'Fashion', 'telathread@shopuno.test');
        $sellerE = $this->makeSeller('Kickoff Kits PH', 'Sports & Outdoors', 'kickoffkits@shopuno.test');

        $products = [
            [
                'seller_id' => $sellerA->id,
                'category' => 'Fresh Produce',
                'name' => 'Sweet Langka (Jackfruit), 1kg',
                'description' => 'Ripe, fragrant jackfruit sourced fresh from Batangas farms every morning. Sold by the kilo, hand-picked for sweetness.',
                'base_price' => 180.00,
                'stock' => 40,
                'image' => 'https://commons.wikimedia.org/wiki/Special:FilePath/Jackfruit.jpg',
            ],
            [
                'seller_id' => $sellerA->id,
                'category' => 'Fresh Produce',
                'name' => 'Farm-Fresh Free-Range Eggs (Tray of 30)',
                'description' => 'Free-range eggs from backyard farms in Laguna. No hormones, no antibiotics — just good eggs.',
                'base_price' => 245.00,
                'stock' => 60,
                'image' => 'https://commons.wikimedia.org/wiki/Special:FilePath/Carton_of_eggs.jpg',
            ],
            [
                'seller_id' => $sellerB->id,
                'category' => 'Electronics',
                'name' => 'TrueSound Wireless Earbuds',
                'description' => 'Bluetooth 5.3 earbuds with active noise cancellation, 28-hour battery life with the charging case, and IPX5 sweat resistance.',
                'base_price' => 1499.00,
                'image' => 'https://commons.wikimedia.org/wiki/Special:FilePath/JLab_true_wireless.jpg',
                'options' => [
                    ['name' => 'Color', 'values' => ['Matte Black', 'Pearl White']],
                ],
                'combos' => [15, 10],
            ],
            [
                'seller_id' => $sellerB->id,
                'category' => 'Electronics',
                'name' => '20000mAh Fast-Charge Power Bank',
                'description' => 'Slim power bank with 22.5W PD fast charging — two full phone charges on the go, with a built-in LED indicator.',
                'base_price' => 899.00,
                'stock' => 4,
                'image' => 'https://commons.wikimedia.org/wiki/Special:FilePath/Power_bank.JPG',
            ],
            [
                'seller_id' => $sellerC->id,
                'category' => 'Home & Living',
                'name' => 'Rattan-Weave Storage Basket Set (3-piece)',
                'description' => 'Handwoven rattan baskets in three sizes, perfect for laundry, toys, or pantry organizing. Made by local weavers in Cebu.',
                'base_price' => 1250.00,
                'stock' => 18,
                'image' => 'https://commons.wikimedia.org/wiki/Special:FilePath/Rattan_baskets_in_IKEA_Taichung.jpg',
            ],
            [
                'seller_id' => $sellerC->id,
                'category' => 'Home & Living',
                'name' => 'Ceramic Pour-Over Coffee Set',
                'description' => 'Hand-glazed ceramic dripper, matching mug, and reusable filter — a slow-morning ritual in a box.',
                'base_price' => 975.00,
                'image' => 'https://commons.wikimedia.org/wiki/Special:FilePath/Kalita_Wave_Steel_coffee_dripper_(31187297112).jpg',
                'options' => [
                    ['name' => 'Glaze', 'values' => ['Terracotta', 'Sage Green']],
                ],
                'price_adjustments' => [0, 50],
                'combos' => [0, 0],
            ],
            [
                'seller_id' => $sellerD->id,
                'category' => 'Fashion',
                'name' => 'Linen-Blend Oversized Shirt',
                'description' => 'Breathable linen-cotton blend, relaxed fit, garment-dyed for a soft worn-in feel. Runs true to size.',
                'base_price' => 799.00,
                'image' => 'https://commons.wikimedia.org/wiki/Special:FilePath/T_Shirt.jpg',
                'options' => [
                    ['name' => 'Size', 'values' => ['S', 'M', 'L', 'XL']],
                ],
                'price_adjustments' => [0, 0, 0, 50],
                'combos' => [6, 10, 9, 5],
            ],
            [
                'seller_id' => $sellerD->id,
                'category' => 'Fashion',
                'name' => 'Everyday Canvas Tote Bag',
                'description' => 'Heavy-duty 12oz canvas tote with reinforced handles — fits a laptop, a water bottle, and then some.',
                'base_price' => 399.00,
                'image' => 'https://commons.wikimedia.org/wiki/Special:FilePath/Tote_bag_blacu_tas_blacu.jpg',
                'options' => [
                    ['name' => 'Color', 'values' => ['Natural', 'Black']],
                ],
                'combos' => [2, 1],
            ],
            [
                'seller_id' => $sellerC->id,
                'category' => 'Health & Beauty',
                'name' => 'Virgin Coconut Oil, Cold-Pressed 500ml',
                'description' => 'Unrefined, cold-pressed VCO from Quezon province — for cooking, skin, and hair. No additives.',
                'base_price' => 320.00,
                'stock' => 50,
                'image' => 'https://commons.wikimedia.org/wiki/Special:FilePath/Coconut_Oil_(4404443713).jpg',
            ],
            // Two option groups at once (Style × Size) — the same shape as
            // the Shopee reference screenshot this feature was modeled on:
            // pick a jersey style, then a size, and see that combination's
            // own stock, not just "the product's" stock.
            [
                'seller_id' => $sellerE->id,
                'category' => 'Sports & Outdoors',
                'name' => 'Club Crest Home Jersey 25/26',
                'description' => 'Official-cut replica home jersey, breathable mesh fabric. Add a name/number and patch, or keep it clean with "Only jersey".',
                'base_price' => 1250.00,
                'image' => 'https://commons.wikimedia.org/wiki/Special:FilePath/Panathinaikos_shirt.jpg',
                'options' => [
                    ['name' => 'Style', 'values' => ['Only jersey', '+#10 name +UCL patch', '+#7 name +UCL patch']],
                    ['name' => 'Size', 'values' => ['S', 'M', 'L', 'XL', '2XL']],
                ],
                // Price adjustment per Style value (applies across every size in that style).
                'price_adjustments' => [0, 350, 350],
                // Stock per (Style, Size) combination, row-major over Style then Size —
                // i.e. all 5 sizes for "Only jersey" first, then all 5 for the next style, etc.
                'combos' => [
                    12, 20, 18, 10, 4,   // Only jersey: S, M, L, XL, 2XL
                    6, 9, 8, 5, 0,       // +#10 name +UCL patch
                    5, 7, 6, 3, 0,       // +#7 name +UCL patch
                ],
            ],
        ];

        foreach ($products as $p) {
            $product = Product::firstOrCreate(
                ['seller_id' => $p['seller_id'], 'name' => $p['name']],
                [
                    'category_id' => $categories[$p['category']],
                    'description' => $p['description'],
                    'base_price' => $p['base_price'],
                    'stock' => $p['stock'] ?? 0,
                    'is_archived' => false,
                ]
            );

            if ($product->images()->count() === 0) {
                $product->images()->create(['path' => $p['image'], 'sort_order' => 0]);
            }

            if (! empty($p['options']) && $product->options()->count() === 0) {
                $this->seedOptions($product, $p);
            }
        }
    }

    /**
     * Creates the option groups/values for a demo product, then the
     * generated ProductVariation combo rows with the seeded stock/price —
     * i.e. exactly what Seller\ProductOptionController would produce, just
     * with real numbers already filled in instead of starting at 0.
     */
    protected function seedOptions(Product $product, array $p): void
    {
        $optionModels = [];
        foreach ($p['options'] as $i => $def) {
            $option = $product->options()->create(['name' => $def['name'], 'position' => $i]);
            $optionModels[$i] = collect($def['values'])->map(
                fn ($value, $j) => $option->values()->create(['value' => $value, 'position' => $j])
            );
        }

        $axis1 = $optionModels[0];
        $axis2 = $optionModels[1] ?? collect();
        $priceAdjustments = $p['price_adjustments'] ?? array_fill(0, $axis1->count(), 0);
        $stocks = $p['combos'];

        $i = 0;
        if ($axis2->isEmpty()) {
            foreach ($axis1 as $idx => $v1) {
                $product->variations()->create([
                    'option_value_1_id' => $v1->id,
                    'option_value_2_id' => null,
                    'variation_type' => 'options',
                    'value' => $v1->value,
                    'price_adjustment' => $priceAdjustments[$idx] ?? 0,
                    'stock' => $stocks[$i] ?? 0,
                ]);
                $i++;
            }
        } else {
            foreach ($axis1 as $idx1 => $v1) {
                foreach ($axis2 as $v2) {
                    $product->variations()->create([
                        'option_value_1_id' => $v1->id,
                        'option_value_2_id' => $v2->id,
                        'variation_type' => 'options',
                        'value' => $v1->value.' / '.$v2->value,
                        'price_adjustment' => $priceAdjustments[$idx1] ?? 0,
                        'stock' => $stocks[$i] ?? 0,
                    ]);
                    $i++;
                }
            }
        }

        $product->syncStockFromVariations();
    }

    protected function makeSeller(string $businessName, string $lineOfBusiness, string $email): Seller
    {
        $user = User::firstOrCreate(
            ['email' => $email],
            [
                'last_name' => 'Seller',
                'first_name' => explode(' ', $businessName)[0],
                'sex' => 'female',
                'password' => Hash::make('password'),
                'contact_no' => '09171234567',
                'birthday' => '1990-01-01',
                'age' => 34,
                'role' => 'seller',
                'status' => 'active',
            ]
        );

        return Seller::firstOrCreate(
            ['user_id' => $user->id],
            [
                'business_name' => $businessName,
                'line_of_business' => $lineOfBusiness,
                'business_permit_path' => 'demo/business-permits/placeholder.pdf',
            ]
        );
    }
}
