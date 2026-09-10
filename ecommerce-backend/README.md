# E-commerce — Backend Starter

These files aren't a runnable project on their own — they're meant to be dropped
into a real Laravel install. This sandbox can't reach packagist.org, so the
actual `laravel new` / `composer install` step has to happen on your own machine.

## Setup

1. Create the Laravel project (if you haven't already):
   ```
   composer create-project laravel/laravel e-commerce-backend
   cd e-commerce-backend
   composer require laravel/sanctum
   php artisan install:api
   ```

2. Copy these files into your project, overwriting the defaults:
   - `database/migrations/*.php` → your project's `database/migrations/`
     (delete the default `..._create_users_table.php` that ships with Laravel first,
     since this replaces it)
   - `app/**`, `config/**`, `resources/**`, `routes/api.php`, `public/.user.ini`
     → the matching folders in your project. **`routes/api.php` and
     `app/Providers/AppServiceProvider.php` replace the defaults** —
     if you've already added other routes/provider code, merge instead of
     overwriting.

3. Register the `admin` and `seller` middleware aliases in `bootstrap/app.php`:
   ```php
   ->withMiddleware(function (Middleware $middleware) {
       $middleware->alias([
           'admin' => \App\Http\Middleware\EnsureUserIsAdmin::class,
           'seller' => \App\Http\Middleware\EnsureUserIsSeller::class,
           'courier' => \App\Http\Middleware\EnsureUserIsCourier::class,
           'logistics' => \App\Http\Middleware\EnsureUserIsLogistics::class,
       ]);
   })
   ```

4. Set your `.env` database credentials to your MySQL instance, then:
   ```
   php artisan migrate
   ```
   There's no seeded admin account — create one manually via `php artisan tinker`:
   `User::create([...])` with `role: 'admin', status: 'active'`.

   **If you already ran `migrate` before on an earlier version of this
   schema**, migration `2024_01_01_000030` uses raw SQL to widen the
   `deliveries.status` enum (Laravel's schema builder can't modify an
   existing enum's allowed values). Editing an already-run migration file
   in place does nothing — Laravel only runs migrations it hasn't seen
   before. If your database predates this batch, either run
   `php artisan migrate` normally (it'll pick up just the new files), or
   `php artisan migrate:fresh` if you'd rather rebuild clean and don't
   have real data worth keeping yet.

5. Either `php artisan queue:work` or set `QUEUE_CONNECTION=sync` in `.env`
   (for emails — all mailables are queued).

6. Run `php artisan storage:link` — **needed now**, specifically for
   product images (`/seller/products/{id}/images`), which live on the
   `public` disk since buyers need to view them without logging in.
   Sensitive documents (ID, permits, licenses) still deliberately live on
   the private `local` disk and are NOT affected by this — see "Document
   privacy" below for why those two are handled completely differently.

## What's built so far

| Area | Endpoints |
|---|---|
| Document guide | `GET /document-requirements` |
| Auth | register (buyer/courier/logistics), login, logout, me |
| Registrations (admin) | list/view/approve/reject — now Logistics only, see "Roles & Registration Flow" |
| Seller Applications | buyer applies (`/me/seller-application`); admin reviews (`/admin/seller-applications`) |
| Logistics & Riders | public company list (`/logistics-companies`); company reviews own riders (`/logistics/riders`) |
| Logistics Delivery Review | company confirms seller-ready orders (`/logistics/deliveries/{id}/confirm`) — see "Logistics-Reviewed Delivery Flow" |
| Admin Logistics Oversight | `GET /admin/logistics-companies`, `GET /admin/riders` — read-only, no override |
| Courier Dashboard & Earnings | `GET /courier/dashboard`, `GET /courier/reports/earnings` — flat fee per delivery |
| Product Variations & Images | `/seller/products/{id}/variations`, `/seller/products/{id}/images` — images are PUBLIC (different disk than documents) |
| Courier Deliveries | browse/accept — scoped to the courier's own logistics company (not platform-wide) |
| Accounts (admin) | list/view accounts, warn, activate, suspend, deactivate |
| Categories & Products | public browse (`/products`, `/categories`) + seller CRUD (`/seller/products`) |
| Compliance (admin) | list/view products, flag, resolve, archive |
| Cart & Checkout | view/add/update/remove cart items, checkout → orders |
| Orders | buyer view/track; seller confirms ready (`/confirm-ready`) or cancels only |
| Complaints | any role files/views own; admin lists + resolves |
| Reports (admin) | `GET /admin/reports/sales`, `GET /admin/reports/commission` — both accept `?from=&to=` |
| Messaging | `GET/POST /conversations`, `GET/POST /conversations/{id}/messages` — any role |
| Platform Settings (admin) | `GET/PATCH /admin/settings`, full `/admin/announcements` CRUD; `GET /announcements` public |
| Dashboard (admin) | `GET /admin/dashboard` — counts, needs-attention summary, recent activity feed |
| Document privacy | `GET /documents/{user}/{type}` — signed + authenticated, owner/admin only |
| Vouchers | seller CRUD (`/seller/vouchers`); buyer applies at checkout via `POST /orders` |
| Ratings & Feedback | `POST /orders/{id}/rating` (buyer, post-delivery); `GET /seller/ratings` |
| Account Management | `PATCH /me` (name, username, email, contact, address, plus role-specific business fields), `PATCH /me/password`, `POST /me/avatar`, `DELETE /me/avatar` — shared across every role. Avatars are PUBLIC (same disk/pattern as product images), not signed like ID/permit documents. |
| Seller Sales Report | `GET /seller/reports/sales?from=&to=` — own totals, COD collected, commission owed, top products |
| Seller Dashboard | `GET /seller/dashboard` — same shape as the admin dashboard, scoped to one store |
| Seller Waybill / Shipping Label | `GET /seller/orders/{id}/waybill` (JSON) and `GET /seller/orders/{id}/waybill/print` (printable HTML label) — see "Waybill / Shipping Label" below |

## Logistics-Reviewed Delivery Flow — read this before touching Orders/Deliveries

This replaced an earlier, simpler model where any courier from any
logistics company could see and accept any pending delivery platform-wide
the instant a seller marked it ready. That model quietly had **two real
bugs**: sellers could walk an order all the way to `delivered` themselves
(bypassing the courier system so it never actually got used), and nothing
scoped deliveries to a specific company at all. Both are fixed as part of
this change, not just the new feature on top.

**The actual flow, end to end:**

```
Buyer checks out
  → picks a logistics company PER SELLER-ORDER (required, offered by the seller)
  → Order.logistics_company_id is set

Seller confirms the order is packed: POST /seller/orders/{id}/confirm-ready
  → creates a Delivery, status = 'awaiting_logistics_confirmation'
  → visible ONLY to the chosen company's own review queue
  → Order.status stays 'to_ship' — nothing buyer-visible changes yet

Logistics company reviews: GET /logistics/deliveries (their own only)
  → "ready to ship"? → POST /logistics/deliveries/{id}/confirm
  → this ONE action collapses "assign sorting center / starts transfer /
    arrives sorting center" into a single status flag (see below) —
    Delivery.status becomes 'pending'
  → NOW it's visible to that company's own riders — never another
    company's, and never a global pool

Courier (of that company only) accepts: POST /courier/deliveries/{id}/accept
  → first-come-first-served, DB-locked (see accept() for the exact race
    condition it prevents), AND company-checked as real enforcement,
    not just because the list happened to be filtered

→ pickup → out for delivery → delivered
  → delivered is what actually completes the order and notifies the
    seller — the seller never marks their own order delivered anymore
```

**Why "Assign Sorting Center" is one status flag, not a real entity** —
project decision, made explicitly rather than assumed: building an
actual `sorting_centers` table/model would be real, unnecessary scope for
what this project needs. `Delivery.confirmed_by_user_id` +
`confirmed_at` capture "who at the company signed off and when," which is
the auditable part that actually matters; a literal sorting-center
location isn't tracked anywhere.

**Why there's no "reject" action on the Logistics review queue** — the
flowchart this is based on only shows a wait-and-recheck loop ("Product
Ready to Ship? No" just goes back to viewing), not a rejection path. If a
company genuinely needs to bounce an order back to the seller later,
that's a real gap worth deciding on, not something quietly assumed here.

**A seller can now only cancel an order directly** — every status past
`to_ship` is driven by the Delivery pipeline above, not manual seller
action. `PATCH /seller/orders/{id}/status` will reject anything except
`cancelled` with a message pointing at `confirm-ready` instead.

## Waybill / Shipping Label

This closes out the last unbuilt item from the Seller checklist: "Prepare
orders — pack items, print waybill/shipping label." It sits at the
packing step, deliberately *before* `confirm-ready` — a seller prints the
label while boxing the order up, sticks it on, then hands off.

```
GET /seller/orders/{id}/waybill        -> JSON: everything a label needs
GET /seller/orders/{id}/waybill/print  -> the same data, pre-rendered as a
                                           printable HTML page (open it,
                                           Ctrl/Cmd+P, "Save as PDF" if needed)
```

**The tracking number is generated once and reused on every reprint** —
`orders.waybill_number` / `waybill_generated_at`, derived from the order's
own id (`WB` + `YYMM` + zero-padded order id), so it's guaranteed unique
without a retry-on-collision loop and stays stable if a seller reprints
the label later. It's exposed on `OrderResource` too, so a buyer's own
order-tracking view can show the same number their package is labeled
with.

**Why HTML instead of a generated PDF file** — this sandbox has no
`packagist.org` access (see Setup, above), so a PDF library like
`barryvdh/laravel-dompdf` isn't installable here. A plain print-styled
Blade view needs no new dependency and gets a seller the exact same
physical result: open it, print, done. If a real PDF file becomes a hard
requirement later, `resources/views/waybills/show.blade.php` is already
the template to feed into one.

**Guarded the same way `confirm-ready` is** — needs a logistics company
already chosen at checkout, and refuses on a cancelled order (nothing to
ship). Unlike `confirm-ready`, it does NOT require `status === 'to_ship'`
specifically — a seller should still be able to reprint a lost/damaged
label later without the order status blocking them.

## Roles & Registration Flow — read this before touching auth

This changed significantly partway through the project (confirmed via an
adviser conversation) and is genuinely different from a typical
"pick your role at signup" system. **Only two roles register directly
with the platform: Buyer and Logistics.** Seller and (functionally)
Courier approval are both *applications*, not registrations, reviewed by
two different authorities.

```
Buyer   — registers directly, auto-approved instantly (no admin wait)
            └─ can later APPLY to become a Seller (reviewed by ADMIN)
Logistics — registers directly, admin-approved (same as the old flow)
            └─ Couriers APPLY to a specific Logistics company
                (reviewed by that COMPANY, not admin)
Admin   — no self-registration, created manually (unchanged)
```

**Buyer** (`POST /register/buyer`) — auto-approves. A valid ID is still
required and stored, but there's no pending state, no admin review, and a
Sanctum token is issued immediately in the response. This is the one role
that behaves completely differently from the other three.

**Seller is no longer a registration type.** An existing Buyer applies
from inside their account: `POST /me/seller-application` (business name,
line of business, permit). Admin reviews it
(`GET/POST /admin/seller-applications/...`). Only on approval does
`Seller::create()` run and the user's `role` flip from `buyer` to
`seller` — until then, the account is a fully normal, fully functional
Buyer. A rejected application doesn't touch the buyer role at all.

**Logistics** (`POST /register/logistics`) — registers directly, same
`pending → admin approves/rejects → active` flow that Seller used to
have. Requires a company name and business permit. Once active, the
company shows up in `GET /logistics-companies` (public), which is what
populates the "which company are you applying to?" dropdown on courier
registration.

**Courier** (`POST /register/courier`) — now requires
`logistics_company_id`, validated against an *active* logistics company.
**The company reviews the application, not platform admin** —
`GET/POST /logistics/riders/...`, gated by the new `logistics` middleware
and scoped so a company only ever sees its own applicants
(`Courier::logistics_company_id` must match the reviewer's own company).

### Why this shape, specifically

- Buyer auto-approval removes an entire admin workflow step for what's
  almost certainly the platform's highest-volume registration — the
  tradeoff is accepting unverified IDs at signup, which was an explicit
  decision, not an oversight.
- Making Seller an *upgrade* rather than a registration type means a
  rejected application doesn't strand someone with no account at all —
  they're still a working Buyer either way.
- Splitting rider approval to the Logistics company (not admin) mirrors
  how real courier partners work (J&T, SPX, etc. manage their own
  riders) — admin doesn't want or need to be the bottleneck for every
  individual rider a partner company hires.

### Admin oversight of Logistics — resolved (visibility, not override)

The adviser conversation this is based on left one thing unconfirmed:
whether admin should have any oversight of Logistics companies' rider
approvals. The implemented answer is **read-only oversight**:

- `GET /admin/logistics-companies` — every company on the platform, with
  a rider-count breakdown (total / pending / active)
- `GET /admin/logistics-companies/{id}` — one company + its full rider list
- `GET /admin/riders?company_id=&status=&search=` — every rider across
  every company in one place, so admin can audit patterns (a company
  approving everyone instantly, one with an unusually high rejection
  rate) without being the one who has to review each applicant
- `GET /admin/riders/{courier}` — one rider's full detail and review history

**Deliberately no approve/reject in any of these** — that authority stays
with the logistics company the rider applied to
(`Logistics\RiderController`). The whole point of introducing the
Logistics role was to take individual rider vetting off the platform's
plate; giving admin override power back would undo that. This is a
reasonable default given the conversation's intent, but it's still a
judgment call I made rather than something explicitly confirmed —
worth a quick sanity check with your adviser before treating it as final.

## Key design decisions

**Account lifecycle** — `users.status`:
`pending`/`rejected` (registration, via `/admin/registrations/*`) →
`active`/`suspended`/`deactivated` (post-approval, via `/admin/accounts/*`).
`warn` is a logged action that doesn't change status (Compliance calls out
warnings separately from suspension). All seven actions
(`approve`/`reject`/`warn`/`activate`/`suspend`/`deactivate`) share one audit
trail: `moderation_logs`.

**Compliance is manual, not automated** — `GET /admin/compliance/products`
lists listings for an admin to read against the seller's registered
`line_of_business` themselves. There's no classifier matching product
category to business type; that was a deliberate scope decision (see
earlier project planning) rather than a missing feature. Flags are tracked
in `product_flags`, structurally identical to `moderation_logs` but scoped
to products instead of accounts.

**Suspended sellers disappear from browsing automatically** — the public
`/products` query filters on `seller.user.status = active`. No separate
cleanup step needed when Compliance suspends someone.

**Checkout splits by seller** — a cart can hold items from multiple
sellers; `POST /orders` groups cart items by `seller_id` and creates one
`Order` per seller, all in a single DB transaction. Stock is checked and
decremented per line item; insufficient stock aborts the whole checkout
with a clear message naming the product.

**Order status only moves forward one step at a time** —
`to_ship → in_transit → out_for_delivery → delivered`, enforced in
`Seller\OrderController::assertValidTransition`. Cancelling is only
allowed while still `to_ship`. Every transition is logged to
`order_status_history`, which is what powers the buyer's tracking view.

**Order items snapshot product name/price at purchase time** — a seller
editing a product later never rewrites what a buyer already paid for.

**Commission is computed, never stored** — `config('commission.rate')`
(10%) is the only place the rate lives. Both reports build from the same
`Order::billable()` scope (excludes cancelled orders) and the same
per-seller breakdown — Sales Summary just hides the `commission_amount`
field that Commission Report shows. If a payment/paid-status gate gets
added later, `Order::scopeBillable()` is the one place to tighten what
counts as a sale.

**Messaging is simple threads, not real-time** — `conversations` +
`conversation_user` (pivot, tracks per-user `last_read_at`) + `messages`.
Deliberately not sockets/websockets/Pusher — matches the earlier scoping
decision to keep Chat simple given the 2-person team and 3-month timeline.
Starting a new conversation with someone you already have a thread with
reuses the existing thread instead of forking a duplicate —
`ConversationController::store` checks for this before creating anything.
Scoping is a two-level fallback: an `order_id` (if given) is the strongest
scope, since everything about that order belongs in one thread; without an
order, a `product_id` (e.g. "Message" from a product's quick-view) scopes
it instead, so separate "which item is this about" threads don't collapse
into one; with neither, it's a single general thread with that recipient.
`unread_count` is computed on read (`Conversation::unreadCountFor()`), not
stored, so it can never drift out of sync with the actual messages.
`ConversationResource` also resolves each seller participant's display
`name` to their `seller.business_name` (falling back to their personal
name only if no shop name is set) — a buyer messaging a seller sees the
shop, not the owner's personal name, matching a real storefront; sellers
still see the buyer's personal name, since buyers have no shop.

**Settings use an allow-list, not a free-for-all key-value store** —
`config('platform_settings.fields')` is the single list of editable keys
(platform name, support email, ToS, privacy policy, seller agreement).
`PATCH /admin/settings` rejects any key not in that list. Adding a new
setting later means adding one entry to the config file — the validation,
the `GET` response shape, and (eventually) an admin UI form field can all
read from the same source instead of drifting apart. Announcements are a
separate, simpler CRUD (`Announcement` model, `is_published` flag) — the
public `GET /announcements` only ever shows published ones; the admin
listing shows everything including drafts.

**Dashboard has no new tables — it's entirely derived** from
registrations, accounts, complaints, product_flags, and orders. `counts`
gives raw numbers; `needs_attention` is the same numbers reshaped as a
flat list with anything at zero dropped (so a notification badge can just
count the keys); `recent_activity` merges the last 5 entries each from
moderation_logs, product_flags, and complaints into one sorted feed. This
closes out all 11 admin functions from the original requirements doc.

## Document privacy

Uploaded documents (valid ID, business permit, OR/CR, driver's license)
are stored on Laravel's **private `local` disk**, not `public` — they are
never reachable at a plain `/storage/...` URL the way early versions of
this project had them. These are government IDs and business permits;
treat them like the sensitive data they are.

**Viewing a document requires two things at once, not one:**
1. A **signed URL** (`documents.show` route, `'signed'` middleware) that
   expires after ~10 minutes — generated by `User::documentUrls()`, and
   surfaced automatically in `UserResource` under a `documents` key, but
   **only** when the person making the request is the account owner or an
   admin (everyone else doesn't even see the key).
2. A **valid Sanctum token belonging to that same owner/admin** — checked
   again inside `DocumentController::show`, independently of the
   signature. A leaked signed link alone (screenshot, forwarded email,
   browser history, shared network log) is not enough to view someone's ID.

**Frontend integration gotcha — read this before wiring up document
viewing:** because the route also requires `auth:sanctum`, you **cannot**
just put a signed URL in a plain `<img src="...">` or `<a href="...">` —
a normal browser navigation/image load has no way to attach a Bearer
token. Instead, fetch it with your HTTP client (axios/fetch on web,
`http`/`dio` in Flutter) *with the Authorization header attached*, then
render the response as a blob/object URL (web) or bytes (Flutter). This
is a deliberate tradeoff — real security over `<img>`-tag convenience —
and it's the one thing most likely to trip someone up if they assume
signed URLs work like a normal image link.

## Admin function checklist — status

All 11 are now built at the API level:

- [x] Login
- [x] View dashboard
- [x] Manage account registrations — **scope changed**: now only reviews
      Logistics applicants (Buyer auto-approves, Seller is a separate
      applications queue, Courier is reviewed by their Logistics company)
- [x] Manage user accounts (Activate/Suspend/Deactivate)
- [x] Monitor Seller Compliance
- [x] Manage Complaints and Disputes
- [x] Manage Commission (10%)
- [x] Generate Reports (Sales Summary, Commission Report)
- [x] Manage Platform Settings
- [x] Chat/Messaging
- [x] Logout
- [x] Admin's own profile management — `PATCH /me`, shared with every role

**Complaints can be filed by any role**, not just buyers — the request/
controller live outside any role-specific folder on purpose. Admin
resolution (`PATCH /admin/complaints/{id}/resolve`) emails the filer
when marked `resolved`.

**Every admin/seller decision that affects another user sends an email** —
consistent pattern across registrations, accounts, and compliance actions.
All mailables are markdown + `ShouldQueue`.

## Known deviations from the earlier ERD

- `cart_items`/`order_items` reference `product_id` directly with
  `product_variation_id` **nullable**, not variation-only — not every
  seller will bother creating variations, so requiring one would block
  simple products from being purchasable.
- `orders.seller_id` was already in the original ERD design — confirmed
  here since it's what makes the per-seller checkout split possible.

## Courier Earnings & Product Media

**Courier earnings are computed, never stored** — same philosophy as
commission: `config('delivery.flat_fee_per_delivery')` (₱50 default) is
the only place the rate lives. `GET /courier/dashboard` and
`GET /courier/reports/earnings` both multiply a courier's *count* of
delivered deliveries by that one config value, so there's no `earnings`
column anywhere that could ever drift out of sync with reality.

**Product images are public; documents are private — and that's not an
inconsistency, it's two different threat models on purpose.** IDs and
business permits (`Document privacy`, above) are gated behind signed URLs
because they're sensitive personal/business documents. Product photos are
the opposite — buyers need to see them without logging in, so they live
on the `public` disk and `ProductResource` returns real, directly-usable
URLs (`Storage::disk('public')->url($path)`). Don't "fix" this by making
product images private later without a real reason — it would just break
every product image on the storefront for no security benefit.

**Product variations are hard-deleted; products are archived — this
mirrors the difference in what each one means historically.** A product's
archive/is_archived flag exists because a whole listing might be
referenced by real past orders. A single variation (say, one color
option) being removed is a smaller, more routine edit — and since
`order_items`/`cart_items` reference `product_variation_id` with
`nullOnDelete`, removing a variation never breaks a past order's
financial record (the name/price were already snapshotted); it just
stops showing which specific variation was ordered.

## API response shape — pagination (read this before wiring up any list screen)

**Every paginated list endpoint now returns the same shape:**

```json
{
  "data": [ /* array of items */ ],
  "meta": {
    "current_page": 1,
    "last_page": 5,
    "per_page": 20,
    "total": 93
  }
}
```

That `meta` block is new. Before this pass, it didn't exist at all on
most endpoints, and was nested incorrectly on a handful of others. If any
frontend code was already built against this API, here's exactly what
changed and why, endpoint by endpoint:

**Endpoints that gained `meta` (items were already directly at `data`,
nothing else changes there):**
`GET /products`, `GET /seller/products`, `GET /seller/orders`,
`GET /orders` (buyer), `GET /admin/registrations`, `GET /admin/accounts`,
`GET /admin/compliance/products`, `GET /admin/complaints`,
`GET /my-complaints`, `GET /conversations/{id}/messages`,
`GET /courier/deliveries/available`, `GET /courier/deliveries`,
`GET /logistics/deliveries`.

Root cause, for anyone curious: `response()->json(['data' => SomeResource::collection($paginator)])`
only gets Laravel's automatic pagination `meta`/`links` treatment when
the resource collection is returned directly as the *route's* response.
Nested one level down inside a plain `json([...])` call — which every one
of these did — only the bare array of items comes through. The fix adds
a small shared helper, `Controller::paginatedResponse()`, so this can't
drift out of sync again across 13+ endpoints.

**Endpoints whose shape changed (items moved, don't just add a meta check
— re-point where you read the list from):**

| Endpoint | Before | Now |
|---|---|---|
| `GET /admin/logistics-companies` | items at `data.data`, page info at `data.current_page` etc. | items at `data`, page info at `meta` |
| `GET /admin/riders` | same as above | same fix |
| `GET /admin/announcements` | same as above | same fix |
| `GET /admin/seller-applications` | same as above | same fix |
| `GET /logistics/riders` | same as above | same fix |
| `GET /seller/ratings` | items at `data`, but with the SAME double-nesting bug as above (paginator returned raw) | `average_rating` still top-level, `data` is now a flat array, page info moved to `meta` |

These five (six, counting seller/ratings) had been returning the raw
`LengthAwarePaginator` object directly under `data` instead of a plain
array — which doesn't lose the pagination info (the paginator serializes
its own meta), but nests it wrong: real items ended up at `data.data`,
and `current_page`/`last_page`/`total` ended up as siblings of that,
not grouped under a `meta` key. That's a different shape from every
other list endpoint in the API, which made a single reusable
"parse this paginated list" function on the frontend impossible. Now
every one of the ~19 paginated endpoints in the whole API returns the
exact same `{data: [...], meta: {...}}` shape — same keys, same nesting,
every time.

**Endpoints that intentionally do NOT have `meta`** (they return every
row, not a page of one) — nothing changed here: `GET /vouchers`,
`GET /seller/vouchers`, `GET /conversations`, `GET /admin/settings`,
`GET /logistics-companies`, `GET /categories`, `GET /admin/logistics-companies/{id}`'s
`riders` array.

## Bug fixes — Buyer/Seller/Admin polish pass

Three real bugs found and fixed while closing out the waybill feature,
none of them new regressions from this batch — all pre-existing:

- **Admin Compliance `?flagged=1` broke pagination.** `ComplianceController::index`
  used to `paginate()` first and then `->filter()` the flagged items out of
  the already-fetched page. That looks like it works but quietly breaks
  the pagination metadata (`total`/`last_page` still describe the
  *unfiltered* set) and can drop matching products that happened to land
  on a page that got thinned out after filtering. Fixed with a proper
  query-level scope, `Product::scopeCurrentlyFlagged()`, applied before
  `paginate()` instead of after.
- **A seller could edit a percent voucher's value past 100 via PATCH.**
  `StoreVoucherRequest` guards against a percent-type voucher's value
  exceeding 100; `UpdateVoucherRequest` didn't have the same check, since
  `type` isn't part of the update payload. Fixed by reading the voucher's
  actual `type` off the route-bound model inside `withValidator()`.
- **`product_id` and `product_variation_id` were never checked against
  each other when adding to cart.** Both were validated independently
  (`exists:products,id` / `exists:product_variations,id`), but nothing
  stopped pairing a real product with a real variation that actually
  belongs to a *different* product — which would silently apply the wrong
  `price_adjustment` and, at checkout, decrement stock on the wrong
  product's variation. Fixed in `AddCartItemRequest`.

**Endpoints that intentionally do NOT have `meta`** (they return every
row, not a page of one) — nothing changed here: `GET /vouchers`,
`GET /seller/vouchers`, `GET /conversations`, `GET /admin/settings`,
`GET /logistics-companies`, `GET /categories`, `GET /admin/logistics-companies/{id}`'s
`riders` array.

## Bug fix — `OrderResource` was missing `buyer` entirely

`Seller\OrderController` eager-loads the `buyer` relation on every single
order action (`index`, `show`, `updateStatus`, `confirmReady`) —
specifically so a seller can see who they're shipping to. `OrderResource`
never actually had a `buyer` key in its output, though, so that data was
being loaded from the database on every request and then silently
dropped before it ever reached the response. A seller's order list and
order-detail screens had no buyer name, contact number, or address at
all through the normal order endpoints — the only place that information
surfaced was the separate waybill endpoint. Added a `buyer` block to
`OrderResource`, mirroring the shape `DeliveryResource` already uses for
the same thing:

```json
"buyer": {
  "id": 42,
  "name": "Juan Dela Cruz",
  "contact_no": "0917...",
  "address": { "province": "...", "municipality": "...", "barangay": "...", "street": "...", "house_number": "..." }
}
```

`address` is only present when the buyer's address relation happens to
be loaded alongside `buyer` (it isn't, on the current Seller order
endpoints — only `name`/`contact_no`/`id` will actually show up there
today); it's there so the same resource works correctly if/when an
endpoint starts eager-loading `buyer.address` too.

## Bug fixes — full-backend pass

A second, wider pass across every controller/model/middleware/request/
mail/migration in the project (not just Buyer/Seller/Admin this time)
turned up four more, all pre-existing:

- **A seller could cancel an order that had already been handed off for
  delivery — including one a courier had already accepted.**
  `order.status` deliberately stays `'to_ship'` through the entire
  confirm-ready → logistics-confirm → courier-accept sequence (see
  "Logistics-Reviewed Delivery Flow" above — nothing buyer-visible
  changes until a courier actually picks up). `Seller\OrderController::updateStatus`'s
  cancel path only checked `status !== 'to_ship'`, which that whole
  sequence passes right through. A seller could hit cancel on an order a
  courier already had in hand, leaving an orphaned `Delivery` the courier
  could still complete — flipping `is_paid` true and emailing a
  delivery-complete notice for an order everyone else thought was
  cancelled. Fixed by also blocking cancellation once `$order->delivery`
  exists, the mirror image of the guard `confirmReady()` already has.
- **The courier dashboard's "available deliveries" count wasn't scoped to
  the courier's own logistics company.** Every other delivery-listing
  endpoint (`Courier\DeliveryController::available()`, `accept()`) is
  strictly scoped to `logistics_company_id` — a rider only ever sees or
  can accept work routed to their own company. `Courier\DashboardController::index`
  counted `Delivery::where('status', 'pending')` platform-wide, so the
  number on a courier's own dashboard could include deliveries from other
  companies they can't actually see or accept. Fixed to scope the same way.
- **Two null-unsafe property accesses on `->variation`, hit on every cart
  item for a product *without* variations** (arguably the common case).
  `CartItem::unitPrice()` and `Buyer\OrderController::assertStockAvailable()`
  both did `$item->variation->stock` / `->price_adjustment` — when
  `product_variation_id` is null, `->variation` resolves to `null`, and
  reading a property off `null` throws a PHP 8 warning on every such
  request (functionally recovered by the `??` fallback, but noisy, and a
  strict error-handling setup could turn it into a real failure). Fixed
  with the nullsafe operator (`?->`) in both places — `CartResource` and
  `decrementStock()` already guarded this correctly and needed no change.

## Cross-cutting / Not tied to one role

Every function from the original Buyer/Seller/Admin requirements doc, plus
the full Courier/Logistics addition, now has a real endpoint behind it.
What's genuinely left is operational, not functional:

- **Never actually executed** — every batch here was written and reasoned
  about, but this sandbox can't install Laravel (no packagist.org access),
  so nothing has been run against a real database yet. This is still the
  single biggest remaining risk — see "Running the Backend For Real" for
  the exact steps.
- **Push/real-time delivery for messages** — current messaging is
  poll-based (the client re-fetches `/conversations/{id}/messages`); fine
  for a capstone, not production-grade chat. A deliberate scope decision,
  not an oversight.
- **Distance/size-based delivery fees** — the flat fee in
  `config/delivery.php` is a deliberate simplification; a real fee model
  would need a new column on `deliveries` and isn't a decision this
  project has made yet.
- **Payment gateway** — not applicable; Cash on Delivery is the confirmed
  and only payment method, so there's nothing missing here, just worth
  restating so it doesn't look like an oversight.

## Vouchers, Ratings, and Account Management

**Vouchers are per-seller, not platform-wide** — a code like `WELCOME10`
from one seller has no meaning to another seller's storefront (`unique(['seller_id','code'])`),
matching how checkout already splits a multi-seller cart into separate
orders. Checkout (`POST /orders`) optionally accepts
`vouchers: [{ seller_id, code }]` — each code is validated
(`Voucher::isValidFor()`: active, not expired, under its usage cap, meets
minimum order amount) and only discounts that seller's portion of the
order. An invalid or expired code fails the whole checkout with a clear
message naming the code, rather than silently ignoring it.

**Ratings are keyed to (order, rated_user), not just order** — deliberately,
so that once couriers exist, a buyer rating both the seller and the
courier for the same order is two rows, not a schema change. Rating is
only allowed once an order is `delivered`, and only once per order —
attempting to rate twice is a 409. `Seller::averageRating()` and
`ratingsReceived()` back `GET /seller/ratings`, which is what "Handle
customer feedback" reads from.

**Account Management is one shared endpoint for every role**, not four
near-identical ones — `PATCH /me` only writes the fields present in the
request that are actually relevant to that user's role (a buyer sending
`business_name` just has it ignored, not rejected). Password changes are
a separate `PATCH /me/password` on purpose, so profile edits and
security-sensitive changes aren't the same request.

**The seller sales report reuses the admin report's exact logic**, just
scoped to `$request->user()->seller` instead of every seller — same
`billable`/`paid` distinction, same commission rate from
`config('commission.rate')`. It adds one thing the admin report doesn't
need: `net_earnings` (collected minus commission owed), since that's the
number an individual seller actually cares about, plus a `top_products`
breakdown by revenue for "performance tracking" — not just "how much did
I make" but "what's actually selling."

**The seller dashboard mirrors the admin dashboard's shape on purpose** —
same `counts` / `needs_attention` / `recent_activity` structure — so a
frontend can reuse one dashboard-rendering component for both screens
instead of building two unrelated ones. `needs_attention` surfaces
pending orders to prepare, low-stock products (`stock <= 5`, adjustable
via `DashboardController::LOW_STOCK_THRESHOLD`), and any of *this
seller's* products currently flagged by Compliance — a seller sees their
own compliance issues without needing admin access. `recent_activity`
merges new orders and new ratings, since those are the two things a
seller checks in most often.

## Cash on Delivery

Confirmed: **COD is the only payment method** — no gateway integration
(no PayMongo/GCash/Maya), no webhooks, no sandbox. This removes what
would otherwise have been one of the biggest remaining pieces of work.

- `orders.payment_method` exists as a column (currently always `'cod'`)
  so a second method could be added later without a schema change — but
  nothing depends on that happening.
- `orders.is_paid` / `paid_at` track whether cash has actually been
  collected. This flips to `true` the moment the **courier** completes the
  delivery (`Courier\DeliveryController::deliver`), since they're the one
  physically handling the COD handoff — sellers can no longer mark an
  order `delivered` themselves at all (see "Logistics-Reviewed Delivery
  Flow"). An earlier version of this README described this as a
  seller-side placeholder still waiting on the courier flow to be built;
  that's now done, this note is just corrected to match.
- Reports distinguish **sales** (orders placed) from **collected**
  (cash actually in hand, i.e. delivered) — see `total_collected` in
  `GET /admin/reports/sales` and `total_commission_collected` in
  `GET /admin/reports/commission`. For a COD business these are genuinely
  different numbers — money sitting on undelivered orders isn't money
  in hand yet, and both a seller and the platform care about that gap.

See `e-commerce_api_contract.md` from earlier in the project for the full
endpoint list these still need to support.
