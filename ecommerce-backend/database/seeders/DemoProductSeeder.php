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
 * Uses picsum.photos seeded URLs for images so nothing needs to be
 * uploaded to local storage — ProductResource passes `path` straight
 * through, and the buyer frontend's resolveImage() already treats any
 * http(s) path as absolute and uses it as-is.
 */
class DemoProductSeeder extends Seeder
{
    public function run(): void
    {
        $categories = collect([
            'Fresh Produce', 'Electronics', 'Home & Living', 'Fashion', 'Health & Beauty',
        ])->mapWithKeys(fn ($name) => [$name => Category::firstOrCreate(['name' => $name])->id]);

        $sellerA = $this->makeSeller('Aling Nena\'s Sari-Sari Store', 'Fresh Produce', 'nena@shopuno.test');
        $sellerB = $this->makeSeller('Bright Bytes Electronics', 'Electronics', 'brightbytes@shopuno.test');
        $sellerC = $this->makeSeller('Casa Linda Home Goods', 'Home & Living', 'casalinda@shopuno.test');
        $sellerD = $this->makeSeller('Tela & Thread Apparel', 'Fashion', 'telathread@shopuno.test');

        $products = [
            [
                'seller_id' => $sellerA->id,
                'category' => 'Fresh Produce',
                'name' => 'Sweet Langka (Jackfruit), 1kg',
                'description' => 'Ripe, fragrant jackfruit sourced fresh from Batangas farms every morning. Sold by the kilo, hand-picked for sweetness.',
                'base_price' => 180.00,
                'stock' => 40,
                'image' => 'https://picsum.photos/seed/langka-fruit/700/700',
                'variations' => [],
            ],
            [
                'seller_id' => $sellerA->id,
                'category' => 'Fresh Produce',
                'name' => 'Farm-Fresh Free-Range Eggs (Tray of 30)',
                'description' => 'Free-range eggs from backyard farms in Laguna. No hormones, no antibiotics — just good eggs.',
                'base_price' => 245.00,
                'stock' => 60,
                'image' => 'https://picsum.photos/seed/farm-eggs/700/700',
                'variations' => [],
            ],
            [
                'seller_id' => $sellerB->id,
                'category' => 'Electronics',
                'name' => 'TrueSound Wireless Earbuds',
                'description' => 'Bluetooth 5.3 earbuds with active noise cancellation, 28-hour battery life with the charging case, and IPX5 sweat resistance.',
                'base_price' => 1499.00,
                'stock' => 25,
                'image' => 'https://picsum.photos/seed/wireless-earbuds/700/700',
                'variations' => [
                    ['variation_type' => 'Color', 'value' => 'Matte Black', 'price_adjustment' => 0, 'stock' => 15],
                    ['variation_type' => 'Color', 'value' => 'Pearl White', 'price_adjustment' => 0, 'stock' => 10],
                ],
            ],
            [
                'seller_id' => $sellerB->id,
                'category' => 'Electronics',
                'name' => '20000mAh Fast-Charge Power Bank',
                'description' => 'Slim power bank with 22.5W PD fast charging — two full phone charges on the go, with a built-in LED indicator.',
                'base_price' => 899.00,
                'stock' => 4,
                'image' => 'https://picsum.photos/seed/power-bank/700/700',
                'variations' => [],
            ],
            [
                'seller_id' => $sellerC->id,
                'category' => 'Home & Living',
                'name' => 'Rattan-Weave Storage Basket Set (3-piece)',
                'description' => 'Handwoven rattan baskets in three sizes, perfect for laundry, toys, or pantry organizing. Made by local weavers in Cebu.',
                'base_price' => 1250.00,
                'stock' => 18,
                'image' => 'https://picsum.photos/seed/rattan-basket/700/700',
                'variations' => [],
            ],
            [
                'seller_id' => $sellerC->id,
                'category' => 'Home & Living',
                'name' => 'Ceramic Pour-Over Coffee Set',
                'description' => 'Hand-glazed ceramic dripper, matching mug, and reusable filter — a slow-morning ritual in a box.',
                'base_price' => 975.00,
                'stock' => 0,
                'image' => 'https://picsum.photos/seed/pour-over-coffee/700/700',
                'variations' => [
                    ['variation_type' => 'Glaze', 'value' => 'Terracotta', 'price_adjustment' => 0, 'stock' => 0],
                    ['variation_type' => 'Glaze', 'value' => 'Sage Green', 'price_adjustment' => 50, 'stock' => 0],
                ],
            ],
            [
                'seller_id' => $sellerD->id,
                'category' => 'Fashion',
                'name' => 'Linen-Blend Oversized Shirt',
                'description' => 'Breathable linen-cotton blend, relaxed fit, garment-dyed for a soft worn-in feel. Runs true to size.',
                'base_price' => 799.00,
                'stock' => 30,
                'image' => 'https://picsum.photos/seed/linen-shirt/700/700',
                'variations' => [
                    ['variation_type' => 'Size', 'value' => 'S', 'price_adjustment' => 0, 'stock' => 6],
                    ['variation_type' => 'Size', 'value' => 'M', 'price_adjustment' => 0, 'stock' => 10],
                    ['variation_type' => 'Size', 'value' => 'L', 'price_adjustment' => 0, 'stock' => 9],
                    ['variation_type' => 'Size', 'value' => 'XL', 'price_adjustment' => 50, 'stock' => 5],
                ],
            ],
            [
                'seller_id' => $sellerD->id,
                'category' => 'Fashion',
                'name' => 'Everyday Canvas Tote Bag',
                'description' => 'Heavy-duty 12oz canvas tote with reinforced handles — fits a laptop, a water bottle, and then some.',
                'base_price' => 399.00,
                'stock' => 3,
                'image' => 'https://picsum.photos/seed/canvas-tote/700/700',
                'variations' => [
                    ['variation_type' => 'Color', 'value' => 'Natural', 'price_adjustment' => 0, 'stock' => 2],
                    ['variation_type' => 'Color', 'value' => 'Black', 'price_adjustment' => 0, 'stock' => 1],
                ],
            ],
            [
                'seller_id' => $sellerC->id,
                'category' => 'Health & Beauty',
                'name' => 'Virgin Coconut Oil, Cold-Pressed 500ml',
                'description' => 'Unrefined, cold-pressed VCO from Quezon province — for cooking, skin, and hair. No additives.',
                'base_price' => 320.00,
                'stock' => 50,
                'image' => 'https://picsum.photos/seed/coconut-oil/700/700',
                'variations' => [],
            ],
        ];

        foreach ($products as $p) {
            $product = Product::firstOrCreate(
                ['seller_id' => $p['seller_id'], 'name' => $p['name']],
                [
                    'category_id' => $categories[$p['category']],
                    'description' => $p['description'],
                    'base_price' => $p['base_price'],
                    'stock' => $p['stock'],
                    'is_archived' => false,
                ]
            );

            if ($product->images()->count() === 0) {
                $product->images()->create(['path' => $p['image'], 'sort_order' => 0]);
            }

            if ($product->variations()->count() === 0) {
                foreach ($p['variations'] as $v) {
                    $product->variations()->create($v);
                }
            }
        }
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
