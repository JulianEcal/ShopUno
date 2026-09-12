// assets/js/pages/buyer-cart.js
// Buyer cart page (buyer/cart.html) — "the till". Loads GET /cart, groups
// items by seller (checkout splits the cart into one order per seller), and
// renders two things that stay in sync as the buyer edits: an editorial
// item list with a checkbox per item/seller/cart, and a live receipt "tape"
// that only ever reflects the SELECTED items and ticks its total up or down
// like a real register.
//
// Quantity edits are optimistic and debounced (UI updates instantly, the
// PUT fires after a short pause). Removals are optimistic-with-undo (the
// row leaves immediately, the DELETE only actually fires once the undo
// window in the toast expires).
//
// Partial checkout: the API's POST /orders always converts the buyer's
// *entire* server-side cart into orders — there's no "only these item ids"
// parameter. To honor item selection anyway, checkout temporarily "parks"
// unselected items (DELETE /cart/items/{id}) immediately before calling
// POST /orders, then restores them (POST /cart/items) right after —
// whether the order succeeds or fails — so nothing the buyer left
// unchecked is ever actually purchased or lost.

import { api } from "../api.js";
import { API_BASE_URL } from "../config.js";
import { initShell, refreshCartBadge } from "../partials/buyer-shell.js";
import { escapeHtml, money, toast, openModal, closeModal } from "../lib/ui.js";
import { addressFormFieldsHtml, bindAddressForm } from "../lib/address-form.js";

const APP_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
const QTY_SYNC_DELAY = 550; // ms of quiet before a quantity change is sent to the server
const UNDO_WINDOW = 4500; // ms the buyer has to undo a removal before it's sent to the server

const content = initShell({ page: null });

// One voucher code per seller_id, kept in memory only.
const voucherCodes = {};
// seller_id (string) -> true once a voucher has been checked against
// GET /vouchers and found to currently apply. The backend is still the
// final word at checkout (POST /orders re-validates and re-prices every
// voucher itself), but we look the code up and preview the discount
// as soon as the buyer hits Apply so the cart total isn't lying to them
// in the meantime.
const appliedVouchers = new Set();
// seller_id (string) -> { amount, voucher } — the previewed discount and
// the voucher record it came from (kept so quantity/selection changes can
// recompute the amount, or invalidate it, without another fetch).
const voucherDiscounts = {};
// seller_id (string) -> message to show under that seller's voucher input
// when a code doesn't check out (not found, expired, or below its
// minimum order amount for the seller's current selected subtotal).
const voucherErrors = {};
// seller_id (string) -> true while a voucher lookup/apply for that seller
// is in flight, so the row can show an "Applying…" state.
const voucherLoading = new Set();
// seller_id (string) -> array of that seller's vouchers, as last returned
// by GET /vouchers?seller_id=. Populated by fetchSellerVouchers() and
// shared between the voucher picker modal and applyVoucher() so browsing
// then picking a voucher never fires the request twice.
const sellerVouchersCache = {};

// seller_id -> business_name. GET /cart only returns seller_id on each
// item (no name), so we backfill names by fetching one product per
// unseen seller_id and reading product.seller.business_name off it.
// Cached for the life of the page so repeat loadCart() calls (after
// qty/removal edits) don't re-fetch names we already have.
const sellerNames = {};

let cart = null;
// This buyer's saved address book (see Buyer\AddressController), and which
// one is currently picked for checkout — Shopee-style "Deliver to" card in
// the tape column, changeable via openAddressPickerModal(). Loaded
// independently of the cart itself since neither depends on the other;
// whichever finishes first just shows a brief "Loading…" placeholder for
// the other's section (see deliveryAddressHtml()).
let addresses = [];
let selectedAddressId = null;
// item.id -> true (via Set membership) — which items are checked for
// checkout. Starts with everything selected (the common ecommerce
// default) and is reconciled against the live cart on every load so
// removed items don't linger in the set.
let selected = new Set();
let selectionInitialized = false;
// itemId -> { timeoutId, quantity } — debounced quantity syncs in flight.
const pendingQtySync = new Map();
// itemId -> { timeoutId, item, wasSelected } — items visually removed but
// not yet deleted server-side (still inside the undo window).
const pendingRemovals = new Map();

render(loadingState());
loadCart();
loadAddresses();

async function loadAddresses() {
  try {
    const res = await api.get("/addresses");
    addresses = res?.addresses || [];
    const defaultAddress = addresses.find((a) => a.is_default) || addresses[0] || null;
    selectedAddressId = defaultAddress ? defaultAddress.id : null;
  } catch {
    addresses = [];
    selectedAddressId = null;
  }
  // If the cart already rendered before this resolved, refresh just the
  // tape column so the "Deliver to" card updates without disturbing
  // anything else on the page. If the cart hasn't loaded yet, its own
  // first render will already read the (by-then-updated) state above.
  if (cart) refreshTapeAndCounts();
}

async function loadCart() {
  try {
    const res = await api.get("/cart");
    cart = res?.cart || { items: [], total: 0 };
    if (!selectionInitialized) {
      selected = new Set(cart.items.map((i) => i.id));
      selectionInitialized = true;
    } else {
      selected = new Set([...selected].filter((id) => cart.items.some((i) => i.id === id)));
    }
    render(cart.items.length ? cartView() : emptyState());
    setupMobileBarObserver();
    syncCheckboxStates();
    fillInSellerNames();
  } catch (err) {
    render(errorState(err.message));
  }
}

// Backfills sellerNames for any seller_id present in the cart that we
// haven't looked up yet, then re-renders so the "ShopUno seller"
// placeholder is swapped for the real shop name. Runs after the first
// paint so the cart still shows instantly while names trickle in.
async function fillInSellerNames() {
  if (!cart) return;
  const unknownSellerIds = [...new Set(cart.items.map((i) => i.seller_id))].filter(
    (id) => id != null && !(id in sellerNames)
  );
  if (!unknownSellerIds.length) return;

  await Promise.all(
    unknownSellerIds.map(async (sellerId) => {
      const anyItem = cart.items.find((i) => i.seller_id === sellerId);
      if (!anyItem) return;
      try {
        const res = await api.get(`/products/${anyItem.product_id}`);
        sellerNames[sellerId] = res?.product?.seller?.business_name || null;
      } catch {
        sellerNames[sellerId] = null; // don't retry a failed lookup every load
      }
    })
  );

  if (cart.items.length) {
    render(cartView());
    setupMobileBarObserver();
    syncCheckboxStates();
  }
}

function resolveImage(img) {
  if (!img) return "";
  // Product images from the API come back as objects ({ id, url, sort_order })
  // with a ready-to-use absolute url. Older/legacy call sites may still pass
  // a plain string path, so both are supported here.
  if (typeof img === "object") return img.url || "";
  if (/^https?:\/\//i.test(img)) return img;
  return `${APP_ORIGIN}/storage/${img.replace(/^\/?storage\//, "")}`;
}

function render(html) {
  content.innerHTML = html;
}

/* ---------------- states ---------------- */

function loadingState() {
  return `
    <div class="cart-head"><h1>Your cart</h1></div>
    <div class="cart-layout">
      <div class="cart-items-col">
        <div class="cart-items-panel">
          ${Array(3).fill(0).map(() => `
            <div class="cart-skel-row">
              <div class="sk-thumb" style="width:84px;height:84px;border-radius:14px;"></div>
              <div style="flex:1;"><div class="sk-line w60"></div><div class="sk-line w40"></div></div>
            </div>
          `).join("")}
        </div>
      </div>
      <div class="cart-tape-col">
        <div class="cart-tape sk-thumb" style="height:280px;border-radius:4px;"></div>
      </div>
    </div>
  `;
}

function emptyState() {
  return `
    <div class="cart-head"><h1>Your cart</h1></div>
    <div class="state-card">
      <span class="state-seal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      </span>
      <h3>Your cart is empty</h3>
      <p>Add something you like from the storefront and it'll show up here.</p>
      <a href="/buyer/index.html" class="btn btn-primary" style="margin-top:6px;"><span class="btn-label">Start browsing</span></a>
    </div>
  `;
}

function errorState(message) {
  return `
    <div class="cart-head"><h1>Your cart</h1></div>
    <div class="state-card">
      <span class="state-seal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>
      </span>
      <h3>Couldn't load your cart</h3>
      <p>${escapeHtml(message || "Something went wrong. Please try again in a moment.")}</p>
    </div>
  `;
}

/* ---------------- grouping / selection helpers ---------------- */

function groupBySeller(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.seller_id;
    if (!groups.has(key)) {
      groups.set(key, {
        seller_id: key,
        seller_name: sellerNames[key] || item.seller?.business_name || item.seller_name || "ShopUno seller",
        items: [],
      });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The previewed discount amount for a seller (0 if none applied). */
function discountForSeller(sellerId) {
  return voucherDiscounts[String(sellerId)]?.amount || 0;
}

/** Subtotal of a seller's currently-SELECTED items — this is the number
 * the backend actually checks a voucher's min_order_amount against, so
 * previews must use it too (not the seller's whole cart). */
function selectedSubtotalForSeller(sellerId) {
  return selectedVisibleItems()
    .filter((i) => String(i.seller_id) === String(sellerId))
    .reduce((sum, i) => sum + i.line_total, 0);
}

/** subtotal / discount / total for a set of items, discount summed per
 * seller group from voucherDiscounts. Single source of truth so the tape,
 * mobile bar, and checkout review modal never drift from each other. */
function computeTotals(items) {
  const subtotal = items.reduce((sum, i) => sum + i.line_total, 0);
  const discount = groupBySeller(items).reduce((sum, g) => sum + discountForSeller(g.seller_id), 0);
  return { subtotal, discount, total: round2(Math.max(0, subtotal - discount)) };
}

function visibleItems() {
  if (!cart) return [];
  return cart.items.filter((i) => !pendingRemovals.has(i.id));
}

function selectedVisibleItems() {
  return visibleItems().filter((i) => selected.has(i.id));
}

/* ---------------- main view ---------------- */

function cartView() {
  const items = visibleItems();
  const groups = groupBySeller(items);
  const selectedItems = selectedVisibleItems();
  const { subtotal, total } = computeTotals(selectedItems);
  const allSelected = items.length > 0 && selectedItems.length === items.length;

  return `
    <div class="cart-head">
      <div>
        <a href="/buyer/index.html" class="cart-continue-shopping">Continue shopping</a>
        <h1>Your cart</h1>
        <p>${groups.length} seller${groups.length === 1 ? "" : "s"} · ready when you are</p>
      </div>
      <span class="cart-head-count" id="cartHeadCount">${selectedItems.length} of ${items.length} selected</span>
    </div>
    <div class="cart-layout">
      <div class="cart-items-col" id="cartItemsCol">
        <div class="cart-items-panel">
          <div class="cart-select-all-row">
            <label class="cart-select-all-label">
              <input type="checkbox" class="cart-checkbox-input" id="selectAllCheckbox" data-select-all ${allSelected ? "checked" : ""}>
              Select all items
            </label>
            <button type="button" class="cart-clear-selection" id="clearSelectionBtn">Clear selection</button>
          </div>
          <p class="cart-swipe-hint">Swipe an item left to remove it</p>
          ${groups.map(sellerBlockHtml).join("")}
        </div>
      </div>
      <div class="cart-tape-col">
        ${deliveryAddressHtml()}
        ${tapeHtml(groupBySeller(selectedItems), subtotal)}
      </div>
    </div>
    <div class="cart-mobile-bar" id="cartMobileBar">
      <div class="cart-mobile-bar-total">
        <span>Total</span>
        <strong id="mobileBarTotal">${money(total)}</strong>
      </div>
      <button type="button" class="btn btn-primary" id="mobileCheckoutBtn" ${selectedItems.length && selectedAddressId ? "" : "disabled"}>
        <span class="btn-label">${selectedItems.length ? "Place order" : "Nothing selected"}</span>
        <span class="spinner"></span>
      </button>
    </div>
  `;
}

/**
 * The Shopee-style "Deliver to" card that sits above the receipt tape —
 * shows the currently selected saved address with a "Change" link that
 * opens openAddressPickerModal(), or a prompt to add one if the buyer has
 * none saved yet. An address is required before "Review & place order"
 * is enabled (see tapeHtml()).
 */
function deliveryAddressHtml() {
  const address = addresses.find((a) => a.id === selectedAddressId) || null;
  const locationIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;

  if (!address) {
    return `
      <div class="cart-delivery-card is-empty">
        <div class="cart-delivery-head">
          ${locationIcon}
          <span>Deliver to</span>
        </div>
        <p class="cart-delivery-empty-note">No delivery address saved yet.</p>
        <button type="button" class="cart-delivery-change" id="cartAddAddressBtn">+ Add a delivery address</button>
      </div>
    `;
  }

  return `
    <div class="cart-delivery-card">
      <div class="cart-delivery-head">
        ${locationIcon}
        <span>Deliver to</span>
        <button type="button" class="cart-delivery-change" id="cartChangeAddressBtn">Change</button>
      </div>
      <div class="cart-delivery-body">
        <span class="cart-delivery-recipient">
          ${escapeHtml(address.recipient_name || "")} <span class="cart-delivery-phone">${escapeHtml(address.recipient_phone || "")}</span>
        </span>
        ${address.label ? `<span class="cart-delivery-tag">${escapeHtml(address.label)}</span>` : ""}
        <p class="cart-delivery-line">${escapeHtml(address.full_line || "")}</p>
      </div>
    </div>
  `;
}

function sellerBlockHtml(group) {
  const selCount = group.items.filter((i) => selected.has(i.id)).length;
  const allSelected = selCount === group.items.length;
  const initial = (group.seller_name || "?").trim().slice(0, 1).toUpperCase();

  return `
    <div class="cart-seller-block" data-seller-id="${group.seller_id}">
      <div class="cart-seller-head">
        <label class="cart-seller-check">
          <input type="checkbox" class="cart-checkbox-input" data-select-seller="${group.seller_id}" ${allSelected ? "checked" : ""}>
        </label>
        <a class="cart-seller-link" href="/buyer/seller.html?id=${group.seller_id}">
          <span class="cart-seller-avatar" aria-hidden="true">${escapeHtml(initial)}</span>
          <span class="cart-seller-name">${escapeHtml(group.seller_name)}</span>
        </a>
      </div>

      ${group.items.map((item, i) => itemRowHtml(item, i)).join("")}

      <div class="cart-voucher-row" data-voucher-row="${group.seller_id}">
        ${voucherRowHtml(group.seller_id)}
      </div>
    </div>
  `;
}

/** Renders the voucher control for one seller in either browsing mode (a
 * button that opens openVoucherPickerModal() so the buyer can see what's
 * actually available, rather than typing a code blind) or applied mode (a
 * locked read-only chip with a checkmark + Change link) — swapped in place
 * via replaceVoucherRow() rather than a full cartView() re-render. */
function voucherRowHtml(sellerId) {
  const code = voucherCodes[sellerId] || "";
  const key = String(sellerId);
  const isApplied = appliedVouchers.has(key);
  const isLoading = voucherLoading.has(key);
  const error = voucherErrors[key];

  if (isApplied) {
    const discount = discountForSeller(sellerId);
    return `
      <div class="cart-voucher-row-inner">
        <span class="cart-voucher-applied">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>
          Voucher <strong>${escapeHtml(code)}</strong> applied${discount > 0 ? ` — <strong>−${money(discount)}</strong>` : ""}
        </span>
        <button type="button" class="cart-voucher-change" data-voucher-change="${sellerId}">Change</button>
      </div>
    `;
  }

  return `
    <div class="cart-voucher-row-inner">
      <button type="button" class="cart-voucher-select" data-voucher-select="${sellerId}" ${isLoading ? "disabled" : ""}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.59 13.41 12 22 2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><circle cx="6.5" cy="6.5" r="1.4" fill="currentColor" stroke="none"/></svg>
        ${isLoading ? "Applying…" : "View available vouchers"}
      </button>
    </div>
    ${error ? `<div class="field-error cart-voucher-error">${escapeHtml(error)}</div>` : ""}
  `;
}

/** A short, human description of what a voucher does — "10% off" or
 * "₱50 off", plus a cap note for percent vouchers with one — "20% off
 * (up to ₱1,000)" — for use in the voucher picker list. */
function voucherDescription(voucher) {
  const headline = voucher.type === "percent" ? `${Number(voucher.value)}% off` : `${money(voucher.value)} off`;
  if (voucher.type === "percent" && voucher.max_discount_amount) {
    return `${headline} (up to ${money(voucher.max_discount_amount)})`;
  }
  return headline;
}

/** Applies a voucher's discount rule to a subtotal — percent-of-subtotal
 * (capped at max_discount_amount when the voucher has one) or a flat
 * amount, itself never exceeding the subtotal. Mirrors
 * Voucher::discountFor() on the backend exactly, so the preview here
 * never disagrees with what checkout actually charges. */
function computeVoucherDiscount(voucher, subtotal) {
  let raw = voucher.type === "percent" ? subtotal * (voucher.value / 100) : voucher.value;
  if (voucher.type === "percent" && voucher.max_discount_amount != null) {
    raw = Math.min(raw, voucher.max_discount_amount);
  }
  return round2(Math.min(raw, subtotal));
}

/** True if this buyer can still redeem this voucher under its
 * per_user_limit — GET /vouchers annotates each voucher with
 * used_by_current_user only when it has a per_user_limit (see
 * VoucherResource), so an unset value here always means "unlimited". */
function reachedPerUserLimit(voucher) {
  return voucher.per_user_limit != null
    && voucher.used_by_current_user != null
    && voucher.used_by_current_user >= voucher.per_user_limit;
}

/** Fetches (and caches) a seller's currently-usable vouchers from
 * GET /vouchers?seller_id= — the endpoint already excludes anything
 * expired, inactive, or used up. Shared by the voucher picker modal and
 * applyVoucher() so browsing then picking one never fires the request
 * twice in a row. */
async function fetchSellerVouchers(sellerId) {
  const key = String(sellerId);
  if (sellerVouchersCache[key]) return sellerVouchersCache[key];
  const res = await api.get(`/vouchers?seller_id=${sellerId}`);
  const list = res?.data || [];
  sellerVouchersCache[key] = list;
  return list;
}

/** Lets the buyer browse a seller's currently-usable vouchers and tap one
 * to use it, instead of having to already know and type a code. Vouchers
 * that don't qualify against this seller's currently-selected subtotal are
 * shown greyed out with a note explaining why, rather than hidden — the
 * same min_order_amount rule applyVoucher() and the backend both enforce. */
function openVoucherPickerModal(sellerId) {
  openModal((box) => {
    function renderLoading() {
      box.innerHTML = `
        <div class="modal-header">
          <div><h3>Available vouchers</h3></div>
          <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
        </div>
        <div class="modal-body"><p class="is-empty">Loading vouchers…</p></div>
      `;
      box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    }

    async function renderList() {
      let vouchers = [];
      let loadError = "";
      try {
        vouchers = await fetchSellerVouchers(sellerId);
      } catch (err) {
        loadError = err.message || "Couldn't load vouchers — please try again.";
      }

      const subtotal = selectedSubtotalForSeller(sellerId);
      const appliedCode = appliedVouchers.has(String(sellerId)) ? voucherCodes[sellerId] : null;

      box.innerHTML = `
        <div class="modal-header">
          <div><h3>Available vouchers</h3></div>
          <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          ${loadError ? `<p class="field-error">${escapeHtml(loadError)}</p>` : ""}
          ${!loadError && !vouchers.length ? `<p class="is-empty">This seller doesn't have any vouchers available right now.</p>` : ""}
          <div class="voucher-picker-list">
            ${vouchers.map((v) => {
              const meetsMinimum = v.min_order_amount == null || subtotal >= v.min_order_amount;
              const limitReached = reachedPerUserLimit(v);
              const qualifies = meetsMinimum && !limitReached;
              const isCurrent = appliedCode === v.code;
              return `
                <div class="voucher-picker-option${qualifies ? "" : " is-disabled"}${isCurrent ? " is-current" : ""}">
                  <div class="voucher-picker-body">
                    <div class="voucher-picker-top">
                      <span class="voucher-picker-code">${escapeHtml(v.code)}</span>
                      <span class="voucher-picker-value">${escapeHtml(voucherDescription(v))}</span>
                    </div>
                    ${v.min_order_amount ? `<span class="voucher-picker-min">Min. spend ${money(v.min_order_amount)}</span>` : ""}
                    ${v.per_user_limit ? `<span class="voucher-picker-min">Limit ${v.per_user_limit} per buyer</span>` : ""}
                    ${!meetsMinimum ? `<span class="voucher-picker-note">Add ${money(v.min_order_amount - subtotal)} more from this seller to use this</span>` : ""}
                    ${meetsMinimum && limitReached ? `<span class="voucher-picker-note">You've already used this voucher the maximum number of times</span>` : ""}
                  </div>
                  <button type="button" class="btn btn-outline voucher-picker-use" data-voucher-use="${escapeHtml(v.code)}" ${qualifies && !isCurrent ? "" : "disabled"}>
                    ${isCurrent ? "Applied" : "Use"}
                  </button>
                </div>
              `;
            }).join("")}
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" data-close>Close</button>
        </div>
      `;

      box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
      box.querySelectorAll("[data-voucher-use]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const code = btn.dataset.voucherUse;
          closeModal();
          voucherCodes[sellerId] = code;
          applyVoucher(sellerId);
        });
      });
    }

    renderLoading();
    renderList();
  });
}

function itemRowHtml(item, index = 0) {
  const thumb = item.image
    ? `<img src="${escapeHtml(resolveImage(item.image))}" alt="${escapeHtml(item.product_name)}" loading="lazy">`
    : `<span>${escapeHtml((item.product_name || "?").slice(0, 1).toUpperCase())}</span>`;
  const isSelected = selected.has(item.id);
  const lowStock = Number.isFinite(item.stock) && item.stock <= 10;

  return `
    <div class="cart-item-row${isSelected ? "" : " is-unselected"}" data-item-id="${item.id}" style="--i:${index}">
      <div class="cart-item-swipe-bg">Remove</div>
      <div class="cart-item-surface" data-surface="${item.id}">
        <label class="cart-item-check">
          <input type="checkbox" class="cart-checkbox-input" data-select-item="${item.id}" ${isSelected ? "checked" : ""}>
        </label>
        <div class="cart-item-thumb">${thumb}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.product_name)}</div>
          ${item.variation ? `<div class="cart-item-variation">${escapeHtml(item.variation.label)}</div>` : ""}
          <div class="cart-item-price">${money(item.unit_price)} each${item.is_discounted ? ` <span class="price-tag-orig">${money(item.original_unit_price)}</span>` : ""}</div>
          ${lowStock ? `
            <div class="cart-item-stock-note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>
              Only ${item.stock} left in stock
            </div>` : ""}
          <button type="button" class="cart-item-remove" data-remove="${item.id}">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
            Remove
          </button>
        </div>
        <div class="cart-item-right">
          <div class="qv-stepper cart-stepper">
            <button type="button" data-qty-minus="${item.id}" aria-label="Decrease quantity" ${item.quantity <= 1 ? "disabled" : ""}>−</button>
            <span data-qty-value="${item.id}">${item.quantity}</span>
            <button type="button" data-qty-plus="${item.id}" aria-label="Increase quantity" ${item.quantity >= item.stock ? "disabled" : ""}>+</button>
          </div>
          <div class="cart-item-line-total" data-line-total="${item.id}">${money(item.line_total)}</div>
        </div>
      </div>
    </div>
  `;
}

/* ---------------- the tape (selected items only) ---------------- */

function tapeHtml(groups, subtotal) {
  const hasLines = groups.length > 0;
  const itemCount = groups.reduce((sum, g) => sum + g.items.reduce((s, i) => s + i.quantity, 0), 0);
  const orderCount = groups.length;
  const discountTotal = groups.reduce((sum, g) => sum + discountForSeller(g.seller_id), 0);
  const total = round2(Math.max(0, subtotal - discountTotal));
  const canCheckout = hasLines && !!selectedAddressId;

  return `
    <div class="cart-tape" id="cartTape">
      <div class="cart-tape-head">
        <span class="stamp" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:14px;height:14px;"><path d="M4.5 8.5h15l-1.4 10.3a2 2 0 0 1-2 1.7H7.9a2 2 0 0 1-2-1.7L4.5 8.5Z"/><path d="M8.5 8.5V6.8a3.5 3.5 0 0 1 7 0v1.7"/></svg>
        </span>
        <strong>ShopUno</strong>
        <span>Order receipt</span>
      </div>
      <hr class="cart-tape-rule">
      <div class="cart-tape-lines" id="cartTapeLines">
        ${hasLines ? groups.map(tapeGroupHtml).join("") : `<p class="cart-tape-empty-note">Nothing selected yet — check off items on the left to add them here.</p>`}
      </div>
      ${hasLines ? `
        <div class="cart-tape-subtotal-row">
          <span>Subtotal (${itemCount} item${itemCount === 1 ? "" : "s"})</span>
          <span>${money(subtotal)}</span>
        </div>
      ` : ""}
      ${discountTotal > 0 ? `
        <div class="cart-tape-discount-row">
          <span>Voucher discount</span>
          <span>−${money(discountTotal)}</span>
        </div>
      ` : ""}
      <div class="cart-tape-total-row">
        <span class="cart-tape-total-label">Total</span>
        <span class="cart-tape-total-amt" id="cartTapeTotal">${money(total)}</span>
      </div>
      <p class="cart-tape-note">Discount is confirmed again when the order is placed.<br>Shipping arranged with each seller after ordering.</p>
      <div class="cart-tape-tear"></div>
      <div class="cart-tape-action">
        ${hasLines ? `
          <p class="cart-tape-order-split-note">
            Placing this creates <strong>${orderCount} separate order${orderCount === 1 ? "" : "s"}</strong>${orderCount === 1 ? "" : " — one per seller"}, paid cash on delivery.
          </p>
        ` : ""}
        <button type="button" class="btn btn-primary" id="checkoutBtn" ${canCheckout ? "" : "disabled"}>
          <span class="btn-label">${!hasLines ? "Select items to continue" : !selectedAddressId ? "Add a delivery address" : "Review & place order"}</span>
          <span class="spinner"></span>
        </button>
        <div class="field-error" id="checkoutError" hidden></div>
      </div>
    </div>
  `;
}

function tapeGroupHtml(group) {
  const discount = discountForSeller(group.seller_id);
  return `
    <div data-tape-group="${group.seller_id}">
      <div class="cart-tape-seller">${escapeHtml(group.seller_name)}</div>
      ${group.items.map(tapeLineHtml).join("")}
      ${discount > 0 ? `
        <div class="cart-tape-line cart-tape-voucher-line" data-tape-voucher="${group.seller_id}">
          <span class="cart-tape-line-name">Voucher ${escapeHtml(voucherCodes[group.seller_id] || "")}</span>
          <span class="cart-tape-line-amt">−${money(discount)}</span>
        </div>
      ` : ""}
    </div>
  `;
}

function tapeLineHtml(item) {
  return `
    <div class="cart-tape-line" data-tape-line="${item.id}" title="${escapeHtml(item.product_name)}">
      <span class="cart-tape-line-name">${item.quantity}× ${escapeHtml(item.product_name)}</span>
      <span class="cart-tape-line-amt" data-tape-amt="${item.id}">${money(item.line_total)}</span>
    </div>
  `;
}

/* ---------------- number tween (register-style count up/down) ---------------- */

function animateNumber(el, from, to, duration = 320) {
  if (!el || from === to) { if (el) el.textContent = money(to); return; }
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = money(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = money(to);
  }
  requestAnimationFrame(step);
}

/* ---------------- mobile floating bar ---------------- */

let mobileBarObserver = null;

function setupMobileBarObserver() {
  mobileBarObserver?.disconnect();
  const tape = document.getElementById("cartTape");
  const bar = document.getElementById("cartMobileBar");
  if (!tape || !bar) return;
  mobileBarObserver = new IntersectionObserver(([entry]) => {
    bar.classList.toggle("is-visible", !entry.isIntersecting);
  }, { threshold: 0 });
  mobileBarObserver.observe(tape);
  document.getElementById("mobileCheckoutBtn")?.addEventListener("click", () => {
    if (document.getElementById("checkoutBtn")?.disabled) return;
    document.getElementById("checkoutBtn")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

/* ---------------- event delegation ---------------- */

content.addEventListener("click", (e) => {
  const minus = e.target.closest("[data-qty-minus]");
  const plus = e.target.closest("[data-qty-plus]");
  const remove = e.target.closest("[data-remove]");
  const checkoutBtn = e.target.closest("#checkoutBtn");
  const clearBtn = e.target.closest("#clearSelectionBtn");
  const voucherSelect = e.target.closest("[data-voucher-select]");
  const voucherChange = e.target.closest("[data-voucher-change]");
  const changeAddressBtn = e.target.closest("#cartChangeAddressBtn, #cartAddAddressBtn");

  if (minus) return changeQuantity(Number(minus.dataset.qtyMinus), -1);
  if (plus) return changeQuantity(Number(plus.dataset.qtyPlus), 1);
  if (remove) return removeItem(Number(remove.dataset.remove));
  if (changeAddressBtn) return openAddressPickerModal();
  if (checkoutBtn && !checkoutBtn.disabled) return openCheckoutReviewModal();
  if (clearBtn) return clearSelection();
  if (voucherSelect && !voucherSelect.disabled) {
    return openVoucherPickerModal(voucherSelect.dataset.voucherSelect);
  }
  if (voucherChange) {
    const sellerId = voucherChange.dataset.voucherChange;
    clearVoucher(sellerId);
    replaceVoucherRow(sellerId);
    refreshTapeAndCounts();
    openVoucherPickerModal(sellerId);
    return;
  }
});

content.addEventListener("change", (e) => {
  const itemBox = e.target.closest("[data-select-item]");
  const sellerBox = e.target.closest("[data-select-seller]");
  const allBox = e.target.closest("[data-select-all]");

  if (itemBox) return toggleItemSelection(Number(itemBox.dataset.selectItem), itemBox.checked);
  if (sellerBox) return toggleSellerSelection(Number(sellerBox.dataset.selectSeller), sellerBox.checked);
  if (allBox) return toggleAllSelection(allBox.checked);
});

/** Swaps a single seller's voucher row between browsing/applied mode
 * without re-rendering the whole cart. */
function replaceVoucherRow(sellerId) {
  const row = content.querySelector(`[data-voucher-row="${sellerId}"]`);
  if (row) row.innerHTML = voucherRowHtml(sellerId);
}

/** Clears everything tracked for one seller's voucher — used by "Change"
 * and whenever a previously-applied voucher stops qualifying. */
function clearVoucher(sellerId) {
  const key = String(sellerId);
  appliedVouchers.delete(key);
  delete voucherDiscounts[key];
  delete voucherErrors[key];
}

/** Re-validates the voucher code the buyer picked from
 * openVoucherPickerModal() against this seller's vouchers (via the shared
 * fetchSellerVouchers() cache) the same way the backend will at checkout
 * (active, not expired, not exhausted — filtered server-side already —
 * plus the min_order_amount check against this seller's
 * currently-selected subtotal), and previews the resulting discount. This
 * is only a preview: POST /orders revalidates and reprices every voucher
 * itself, so a code that stops qualifying between now and checkout is
 * still caught there. */
async function applyVoucher(sellerId) {
  const key = String(sellerId);
  const code = (voucherCodes[sellerId] || "").trim();
  if (!code) return;

  delete voucherErrors[key];
  voucherLoading.add(key);
  replaceVoucherRow(sellerId);

  try {
    const list = await fetchSellerVouchers(sellerId);
    const voucher = list.find((v) => v.code === code);
    const subtotal = selectedSubtotalForSeller(sellerId);
    const meetsMinimum = voucher && (voucher.min_order_amount == null || subtotal >= voucher.min_order_amount);

    if (voucher && meetsMinimum && reachedPerUserLimit(voucher)) {
      clearVoucher(sellerId);
      voucherErrors[key] = `You've already used voucher "${code}" the maximum ${voucher.per_user_limit} time${voucher.per_user_limit === 1 ? "" : "s"} allowed.`;
    } else if (!voucher || !meetsMinimum) {
      clearVoucher(sellerId);
      voucherErrors[key] = `The voucher code "${code}" is invalid, expired, or doesn't apply to this order.`;
    } else {
      voucherDiscounts[key] = { amount: computeVoucherDiscount(voucher, subtotal), voucher };
      appliedVouchers.add(key);
      delete voucherErrors[key];
    }
  } catch (err) {
    clearVoucher(sellerId);
    voucherErrors[key] = err.message || "Couldn't check that voucher — please try again.";
  } finally {
    voucherLoading.delete(key);
    replaceVoucherRow(sellerId);
    refreshTapeAndCounts();
  }
}

/** Re-checks every applied voucher's discount against each seller's
 * current selected subtotal — called on every quantity/selection change,
 * since a percent voucher's amount moves with the subtotal and a
 * min_order_amount voucher can stop qualifying entirely (e.g. the buyer
 * unchecks an item or lowers a quantity). Uses the voucher record cached
 * at apply-time, so this never needs another fetch. */
function recomputeAppliedVouchers() {
  for (const key of [...appliedVouchers]) {
    const entry = voucherDiscounts[key];
    if (!entry) continue;
    const { voucher } = entry;
    const subtotal = selectedSubtotalForSeller(key);

    if (subtotal <= 0 || (voucher.min_order_amount != null && subtotal < voucher.min_order_amount)) {
      clearVoucher(key);
      voucherErrors[key] = `Voucher "${voucher.code}" no longer applies — this seller's order is below its ${money(voucher.min_order_amount)} minimum.`;
      replaceVoucherRow(key);
      continue;
    }

    const amount = computeVoucherDiscount(voucher, subtotal);
    if (amount !== entry.amount) {
      voucherDiscounts[key] = { amount, voucher };
      replaceVoucherRow(key);
    }
  }
}

/* ---------------- selection ---------------- */

function toggleItemSelection(itemId, isChecked) {
  if (isChecked) selected.add(itemId);
  else selected.delete(itemId);

  const row = content.querySelector(`.cart-item-row[data-item-id="${itemId}"]`);
  row?.classList.toggle("is-unselected", !isChecked);

  syncCheckboxStates();
  refreshTapeAndCounts();
}

function toggleSellerSelection(sellerId, isChecked) {
  const items = visibleItems().filter((i) => i.seller_id === sellerId);
  items.forEach((i) => {
    if (isChecked) selected.add(i.id);
    else selected.delete(i.id);
    const box = content.querySelector(`[data-select-item="${i.id}"]`);
    if (box) box.checked = isChecked;
    content.querySelector(`.cart-item-row[data-item-id="${i.id}"]`)?.classList.toggle("is-unselected", !isChecked);
  });
  syncCheckboxStates();
  refreshTapeAndCounts();
}

function toggleAllSelection(isChecked) {
  const items = visibleItems();
  items.forEach((i) => {
    if (isChecked) selected.add(i.id);
    else selected.delete(i.id);
  });
  content.querySelectorAll("[data-select-item]").forEach((box) => { box.checked = isChecked; });
  content.querySelectorAll("[data-select-seller]").forEach((box) => { box.checked = isChecked; box.indeterminate = false; });
  content.querySelectorAll(".cart-item-row").forEach((row) => row.classList.toggle("is-unselected", !isChecked));
  refreshTapeAndCounts();
}

function clearSelection() {
  toggleAllSelection(false);
  const allBox = document.getElementById("selectAllCheckbox");
  if (allBox) { allBox.checked = false; allBox.indeterminate = false; }
}

/** Sets checked/indeterminate on the per-seller and master checkboxes to
 * reflect the current `selected` set — run after any item-level toggle. */
function syncCheckboxStates() {
  const items = visibleItems();
  const groups = groupBySeller(items);

  groups.forEach((g) => {
    const box = content.querySelector(`[data-select-seller="${g.seller_id}"]`);
    if (!box) return;
    const selCount = g.items.filter((i) => selected.has(i.id)).length;
    box.checked = selCount === g.items.length;
    box.indeterminate = selCount > 0 && selCount < g.items.length;
  });

  const allBox = document.getElementById("selectAllCheckbox");
  if (allBox) {
    const selCount = items.filter((i) => selected.has(i.id)).length;
    allBox.checked = items.length > 0 && selCount === items.length;
    allBox.indeterminate = selCount > 0 && selCount < items.length;
  }
}

/** Rebuilds the tape (which items appear on it change, not just amounts)
 * and the header/mobile-bar counters — used after every selection change. */
function refreshTapeAndCounts() {
  recomputeAppliedVouchers();

  const items = visibleItems();
  const selectedItems = selectedVisibleItems();
  const { subtotal, total } = computeTotals(selectedItems);

  const totalEl = document.getElementById("cartTapeTotal");
  const oldTotal = totalEl ? Number((totalEl.textContent || "").replace(/[^0-9.]/g, "")) || 0 : 0;

  const tapeCol = content.querySelector(".cart-tape-col");
  if (tapeCol) tapeCol.innerHTML = deliveryAddressHtml() + tapeHtml(groupBySeller(selectedItems), subtotal);
  animateNumber(document.getElementById("cartTapeTotal"), oldTotal, total);

  const headCount = document.getElementById("cartHeadCount");
  if (headCount) headCount.textContent = `${selectedItems.length} of ${items.length} selected`;

  const mobileTotal = document.getElementById("mobileBarTotal");
  if (mobileTotal) mobileTotal.textContent = money(total);
  const mobileBtn = document.getElementById("mobileCheckoutBtn");
  if (mobileBtn) {
    mobileBtn.disabled = selectedItems.length === 0 || !selectedAddressId;
    const label = mobileBtn.querySelector(".btn-label");
    if (label) label.textContent = selectedItems.length ? "Place order" : "Nothing selected";
  }
}

/* ---------------- swipe-to-remove (touch) ---------------- */

let swipe = null;

content.addEventListener("pointerdown", (e) => {
  const surface = e.target.closest("[data-surface]");
  if (!surface || e.pointerType === "mouse") return;
  if (e.target.closest("[data-qty-minus],[data-qty-plus],[data-remove],[data-select-item]")) return;
  const row = surface.closest(".cart-item-row");
  swipe = { row, surface, startX: e.clientX, dx: 0, itemId: Number(row.dataset.itemId) };
  surface.setPointerCapture(e.pointerId);
  row.classList.add("is-dragging");
});

content.addEventListener("pointermove", (e) => {
  if (!swipe) return;
  swipe.dx = Math.min(0, e.clientX - swipe.startX);
  swipe.surface.style.transform = `translateX(${swipe.dx}px)`;
  swipe.row.classList.toggle("is-swiping", swipe.dx < -12);
});

function endSwipe() {
  if (!swipe) return;
  const { row, surface, dx, itemId } = swipe;
  row.classList.remove("is-dragging");
  if (dx < -90) {
    removeItem(itemId);
  } else {
    surface.style.transition = "transform .22s var(--ease)";
    surface.style.transform = "translateX(0)";
    row.classList.remove("is-swiping");
    setTimeout(() => { surface.style.transition = ""; }, 240);
  }
  swipe = null;
}
content.addEventListener("pointerup", endSwipe);
content.addEventListener("pointercancel", endSwipe);

/* ---------------- quantity: optimistic + debounced sync ---------------- */

function changeQuantity(itemId, delta) {
  if (!cart) return;
  const item = cart.items.find((i) => i.id === itemId);
  if (!item || pendingRemovals.has(itemId)) return;
  const nextQty = item.quantity + delta;
  if (nextQty < 1 || nextQty > item.stock) return;

  item.quantity = nextQty;
  item.line_total = Number((item.unit_price * nextQty).toFixed(2));
  patchItemDom(item);
  if (selected.has(itemId)) refreshTapeAndCounts();
  scheduleQtySync(itemId, nextQty);
}

function patchItemDom(item) {
  const qtyEl = content.querySelector(`[data-qty-value="${item.id}"]`);
  if (qtyEl) qtyEl.textContent = item.quantity;
  const minusBtn = content.querySelector(`[data-qty-minus="${item.id}"]`);
  const plusBtn = content.querySelector(`[data-qty-plus="${item.id}"]`);
  if (minusBtn) minusBtn.disabled = item.quantity <= 1;
  if (plusBtn) plusBtn.disabled = item.quantity >= item.stock;

  const lineTotalEl = content.querySelector(`[data-line-total="${item.id}"]`);
  if (lineTotalEl) {
    lineTotalEl.textContent = money(item.line_total);
    lineTotalEl.classList.add("is-pulsing");
    setTimeout(() => lineTotalEl.classList.remove("is-pulsing"), 320);
  }

}

function scheduleQtySync(itemId, quantity) {
  const existing = pendingQtySync.get(itemId);
  if (existing) clearTimeout(existing.timeoutId);
  const timeoutId = setTimeout(async () => {
    pendingQtySync.delete(itemId);
    try {
      await api.put(`/cart/items/${itemId}`, { quantity });
      refreshCartBadge();
    } catch (err) {
      toast(err.message || "Couldn't update quantity — refreshing your cart.", "error");
      await loadCart();
    }
  }, QTY_SYNC_DELAY);
  pendingQtySync.set(itemId, { timeoutId, quantity });
}

/* ---------------- remove: optimistic + undo ---------------- */

function removeItem(itemId) {
  if (!cart || pendingRemovals.has(itemId)) return;
  const item = cart.items.find((i) => i.id === itemId);
  if (!item) return;

  // Cancel any in-flight quantity sync for this item — it's being removed.
  const pendingQty = pendingQtySync.get(itemId);
  if (pendingQty) { clearTimeout(pendingQty.timeoutId); pendingQtySync.delete(itemId); }

  const wasSelected = selected.has(itemId);
  selected.delete(itemId);

  const row = content.querySelector(`.cart-item-row[data-item-id="${itemId}"]`);
  row?.classList.add("is-leaving");

  const timeoutId = setTimeout(() => commitRemoval(itemId), UNDO_WINDOW);
  pendingRemovals.set(itemId, { timeoutId, item, wasSelected });

  setTimeout(() => {
    if (!pendingRemovals.has(itemId)) return; // already undone
    reflowAfterRemoval();
  }, 260);

  toast(`Removed "${item.product_name}"`, "default", {
    actionLabel: "Undo",
    duration: UNDO_WINDOW,
    onAction: () => undoRemoval(itemId),
  });
}

function reflowAfterRemoval() {
  if (!cart) return;
  const items = visibleItems();
  render(items.length ? cartView() : emptyState());
  setupMobileBarObserver();
  syncCheckboxStates();
  refreshCartBadge();
}

function undoRemoval(itemId) {
  const pending = pendingRemovals.get(itemId);
  if (!pending) return;
  clearTimeout(pending.timeoutId);
  pendingRemovals.delete(itemId);
  if (pending.wasSelected) selected.add(itemId);
  reflowAfterRemoval();
  toast(`"${pending.item.product_name}" is back in your cart.`, "success");
}

async function commitRemoval(itemId) {
  const pending = pendingRemovals.get(itemId);
  if (!pending) return;
  pendingRemovals.delete(itemId);
  try {
    await api.delete(`/cart/items/${itemId}`);
    cart.items = cart.items.filter((i) => i.id !== itemId);
    refreshCartBadge();
  } catch (err) {
    // Deletion failed server-side but we've already shown it as gone —
    // reload to reconcile rather than leave the UI lying about the cart.
    toast(err.message || "Couldn't remove that item — refreshing your cart.", "error");
    await loadCart();
  }
}

/** Flushes every still-pending removal immediately (used right before
 * checkout so the server-side cart matches exactly what's on screen). */
async function flushPendingRemovals() {
  const ids = [...pendingRemovals.keys()];
  await Promise.all(ids.map((id) => {
    const pending = pendingRemovals.get(id);
    clearTimeout(pending.timeoutId);
    return commitRemoval(id);
  }));
}

/* ---------------- checkout (only selected items) ---------------- */

/** Removes `items` from the server-side cart and returns the ones that
 * were parked successfully, each tagged with what's needed to re-add it. */
async function parkItems(items) {
  const parked = [];
  for (const item of items) {
    try {
      await api.delete(`/cart/items/${item.id}`);
      parked.push(item);
    } catch (err) {
      // Couldn't park it — safest thing is to stop and surface the error
      // rather than risk checking out an item the buyer didn't select.
      throw new Error(err.message || `Couldn't set aside "${item.product_name}" for checkout.`);
    }
  }
  return parked;
}

/** Re-adds previously parked items to the cart. Best-effort per item — if
 * one fails to restore (e.g. the cart response doesn't expose the field
 * names this expects), the rest still go back and the buyer is told which
 * one needs re-adding by hand. */
async function restoreParkedItems(items) {
  if (!items.length) return;
  const failed = [];
  for (const item of items) {
    try {
      await api.post("/cart/items", {
        product_id: item.product_id,
        product_variation_id: item.product_variation_id ?? item.variation?.id ?? null,
        quantity: item.quantity,
      });
    } catch {
      failed.push(item.product_name);
    }
  }
  await loadCart();
  if (failed.length) {
    toast(`Couldn't restore ${failed.join(", ")} to your cart — you may need to add ${failed.length > 1 ? "them" : "it"} again.`, "error");
  }
}

/** Does the actual checkout work (park → POST /orders → restore) and
 * either returns the API response or throws. No DOM/loading-state
 * concerns here — those live with whichever UI calls this (the review
 * modal's confirm button). */
async function performCheckout() {
  const selectedItems = selectedVisibleItems();
  if (!selectedItems.length) throw new Error("Nothing selected to check out.");
  if (!selectedAddressId) throw new Error("Please choose a delivery address first.");

  const selectedIds = new Set(selectedItems.map((i) => i.id));
  const unselectedItems = visibleItems().filter((i) => !selectedIds.has(i.id));

  // Only send codes that actually passed the client-side preview check —
  // a code left sitting in an input with an unresolved error (never
  // clicked Apply, or Apply came back invalid) shouldn't be sent and
  // fail the whole checkout on a code the buyer never confirmed.
  const vouchers = Object.entries(voucherCodes)
    .filter(([sellerId, code]) => code && appliedVouchers.has(String(sellerId)) && selectedItems.some((i) => String(i.seller_id) === sellerId))
    .map(([seller_id, code]) => ({ seller_id: Number(seller_id), code }));

  await flushPendingRemovals();
  for (const { timeoutId } of pendingQtySync.values()) clearTimeout(timeoutId);
  pendingQtySync.clear();

  let parked = [];
  try {
    // Only park items if some are actually unselected — the common
    // "everything selected" case skips this and checks out as before.
    if (unselectedItems.length) parked = await parkItems(unselectedItems);

    const payload = { address_id: selectedAddressId, ...(vouchers.length ? { vouchers } : {}) };
    const res = await api.post("/orders", payload);

    if (parked.length) await restoreParkedItems(parked); // put back what wasn't bought
    refreshCartBadge();
    mobileBarObserver?.disconnect();
    return res;
  } catch (err) {
    if (parked.length) await restoreParkedItems(parked); // undo any parking before the failure
    throw err;
  }
}

/** Opens a review-and-confirm modal before anything is actually ordered.
 * The buyer sees exactly what will be placed (split per seller, since
 * that's how checkout works), must tick an acknowledgement checkbox to
 * enable the confirm button, and only THEN does performCheckout() fire —
 * so "Place order" on the cart page is a deliberate two-step action, not
 * a single accidental click away from a real COD order. */
/**
 * Shopee-style "choose a delivery address" modal — a radio list of the
 * buyer's saved addresses (see Buyer\AddressController), plus an inline
 * "add new address" sub-view that reuses lib/address-form.js. Selecting
 * a radio and confirming just updates `selectedAddressId` and refreshes
 * the tape's "Deliver to" card; saving a brand-new address does the same
 * after reloading the address list from the server.
 */
function openAddressPickerModal() {
  openModal((box) => {
    function renderList() {
      box.innerHTML = `
        <div class="modal-header">
          <div><h3>Choose a delivery address</h3></div>
          <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <div class="addr-picker-list">
            ${addresses.length ? addresses.map((a) => `
              <label class="addr-picker-option${a.id === selectedAddressId ? " is-selected" : ""}">
                <input type="radio" name="addrPick" value="${a.id}" ${a.id === selectedAddressId ? "checked" : ""}>
                <span class="addr-picker-body">
                  <span class="addr-picker-top">
                    <strong>${escapeHtml(a.label || "Address")}</strong>
                    ${a.is_default ? `<span class="addr-default-badge">Default</span>` : ""}
                  </span>
                  <span class="addr-picker-recipient">${escapeHtml(a.recipient_name || "")} · ${escapeHtml(a.recipient_phone || "")}</span>
                  <span class="addr-picker-line">${escapeHtml(a.full_line || "")}</span>
                </span>
              </label>
            `).join("") : `<p class="is-empty">No saved addresses yet.</p>`}
          </div>
          <button type="button" class="cart-delivery-change addr-picker-add-btn" id="addrPickerAddBtn">+ Add new address</button>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" data-close>Cancel</button>
          <button type="button" class="btn btn-primary" id="addrPickerConfirmBtn" ${addresses.length ? "" : "disabled"}>
            <span class="btn-label">Deliver here</span>
          </button>
        </div>
      `;

      box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));

      box.querySelectorAll('input[name="addrPick"]').forEach((radio) => {
        radio.addEventListener("change", () => {
          box.querySelectorAll(".addr-picker-option").forEach((el) => el.classList.remove("is-selected"));
          radio.closest(".addr-picker-option")?.classList.add("is-selected");
        });
      });

      document.getElementById("addrPickerAddBtn").addEventListener("click", renderAdd);

      document.getElementById("addrPickerConfirmBtn").addEventListener("click", () => {
        const chosen = box.querySelector('input[name="addrPick"]:checked');
        if (!chosen) return;
        selectedAddressId = Number(chosen.value);
        closeModal();
        refreshTapeAndCounts();
      });
    }

    function renderAdd() {
      box.innerHTML = `
        <div class="modal-header">
          <div><h3>Add new address</h3></div>
          <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <form id="addrPickerForm">
            ${addressFormFieldsHtml("addrPicker", { showDefaultToggle: true })}
          </form>
          <div class="field-error" id="addrPickerError" hidden></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" id="addrPickerBackBtn">Back</button>
          <button type="button" class="btn btn-primary" id="addrPickerSaveBtn">
            <span class="btn-label">Save & use this address</span>
            <span class="spinner"></span>
          </button>
        </div>
      `;

      box.querySelector(".modal-close").addEventListener("click", closeModal);
      document.getElementById("addrPickerBackBtn").addEventListener("click", renderList);

      const saveBtn = document.getElementById("addrPickerSaveBtn");
      const errorBox = document.getElementById("addrPickerError");

      const form = bindAddressForm("addrPicker");
      saveBtn.disabled = true;
      form.watch(() => { saveBtn.disabled = !form.isComplete(); });

      if (!addresses.length) {
        // A buyer's very first address is always made the default
        // server-side regardless of this flag — reflect that rather than
        // offering a toggle with no real effect yet.
        const toggle = document.getElementById("addrPickerIsDefault");
        if (toggle) {
          toggle.checked = true;
          toggle.disabled = true;
        }
      }

      saveBtn.addEventListener("click", async () => {
        errorBox.hidden = true;

        if (!form.isComplete()) {
          errorBox.textContent = "Please complete every field.";
          errorBox.hidden = false;
          return;
        }

        saveBtn.classList.add("is-loading");
        saveBtn.disabled = true;
        try {
          const created = await api.post("/addresses", form.read());
          const reload = await api.get("/addresses");
          addresses = reload?.addresses || addresses;
          if (created?.address?.id) selectedAddressId = created.address.id;
          closeModal();
          refreshTapeAndCounts();
          toast("Address saved.", "success");
        } catch (err) {
          errorBox.textContent = err.message || "Couldn't save this address.";
          errorBox.hidden = false;
          saveBtn.disabled = false;
        } finally {
          saveBtn.classList.remove("is-loading");
        }
      });

      // A quicker start than reaching for the mouse.
      document.getElementById("addrPickerRecipientName")?.focus();
    }

    renderList();
  });
}

function openCheckoutReviewModal() {
  const selectedItems = selectedVisibleItems();
  if (!selectedItems.length) return;

  if (!selectedAddressId) {
    toast("Please choose a delivery address first.", "error");
    return openAddressPickerModal();
  }

  const address = addresses.find((a) => a.id === selectedAddressId) || null;
  const groups = groupBySeller(selectedItems);
  const { total: grandTotal } = computeTotals(selectedItems);
  const orderCount = groups.length;

  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>Review your order${orderCount === 1 ? "" : "s"}</h3>
          <p>This places <strong>${orderCount} separate order${orderCount === 1 ? "" : "s"}</strong>${orderCount === 1 ? "" : " — one per seller"}, paid cash on delivery. Nothing is ordered until you confirm below.</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        ${address ? `
          <div class="cart-delivery-card checkout-review-address">
            <div class="cart-delivery-head">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>Deliver to</span>
              <button type="button" class="cart-delivery-change" id="checkoutReviewChangeAddressBtn">Change</button>
            </div>
            <div class="cart-delivery-body">
              <span class="cart-delivery-recipient">
                ${escapeHtml(address.recipient_name || "")} <span class="cart-delivery-phone">${escapeHtml(address.recipient_phone || "")}</span>
              </span>
              ${address.label ? `<span class="cart-delivery-tag">${escapeHtml(address.label)}</span>` : ""}
              <p class="cart-delivery-line">${escapeHtml(address.full_line || "")}</p>
            </div>
          </div>
        ` : ""}
        <div class="checkout-review-orders">
          ${groups.map((g) => {
            const discount = discountForSeller(g.seller_id);
            const isApplied = appliedVouchers.has(String(g.seller_id));
            return `
            <div class="checkout-review-order">
              <div class="checkout-review-order-head">
                <span>${escapeHtml(g.seller_name)}</span>
                ${isApplied ? `<span class="checkout-review-voucher-tag">Voucher ${escapeHtml(voucherCodes[g.seller_id])}${discount > 0 ? ` −${money(discount)}` : ""}</span>` : ""}
              </div>
              <ul class="checkout-review-order-items">
                ${g.items.map((it) => `
                  <li>
                    <div class="checkout-review-item-thumb">${it.image
                      ? `<img src="${escapeHtml(resolveImage(it.image))}" alt="">`
                      : `<span>${escapeHtml((it.product_name || "?").slice(0, 1).toUpperCase())}</span>`}</div>
                    <span class="checkout-review-item-name">${it.quantity} × ${escapeHtml(it.product_name)}</span>
                    <span class="checkout-review-item-amt">${money(it.line_total)}</span>
                  </li>
                `).join("")}
              </ul>
            </div>
          `;
          }).join("")}
        </div>
        <div class="checkout-review-total-row">
          <span>Total${orderCount === 1 ? "" : " across all orders"}</span>
          <strong>${money(grandTotal)}</strong>
        </div>
        <label class="checkout-review-ack">
          <input type="checkbox" id="checkoutReviewAck">
          <span>I've reviewed ${orderCount === 1 ? "this order" : "these orders"} and I'm ready to place ${orderCount === 1 ? "it" : "them"}.</span>
        </label>
        <div class="field-error" id="checkoutReviewError" hidden></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" id="checkoutReviewConfirmBtn" disabled>
          <span class="btn-label">Confirm & place order${orderCount === 1 ? "" : "s"}</span>
          <span class="spinner"></span>
        </button>
      </div>
    `;

    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    box.querySelector("#checkoutReviewChangeAddressBtn")?.addEventListener("click", () => {
      closeModal();
      openAddressPickerModal();
    });

    const ack = box.querySelector("#checkoutReviewAck");
    const confirmBtn = box.querySelector("#checkoutReviewConfirmBtn");
    const errorBox = box.querySelector("#checkoutReviewError");

    ack.addEventListener("change", () => { confirmBtn.disabled = !ack.checked; });

    confirmBtn.addEventListener("click", async () => {
      if (!ack.checked || confirmBtn.disabled) return;
      errorBox.hidden = true;
      confirmBtn.disabled = true;
      confirmBtn.classList.add("is-loading");
      try {
        const res = await performCheckout();
        closeModal();
        render(orderConfirmedView(res));
      } catch (err) {
        errorBox.textContent = err.message || "Couldn't place your order. Please try again.";
        errorBox.hidden = false;
        confirmBtn.classList.remove("is-loading");
        confirmBtn.disabled = false;
      }
    });
  }, { wide: orderCount > 1 });
}

function orderConfirmedView(res) {
  const orders = res?.orders || [];
  const grandTotal = orders.reduce((sum, o) => sum + o.total, 0);

  return `
    <div class="cart-confirm">
      <span class="state-seal is-confirm">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="20 6 9 17 4 12"/></svg>
      </span>
      <h1>${escapeHtml(res?.message || "Order placed.")}</h1>
      <p class="welcome-sub">Sellers ship COD orders directly — you'll see status updates as they progress.</p>

      <div class="cart-confirm-orders">
        ${orders.map((o) => `
          <div class="cart-confirm-order">
            <div class="cart-confirm-order-head">
              <span>${escapeHtml(o.seller?.business_name || "Order")} · #${o.id}</span>
              <span>${money(o.total)}</span>
            </div>
            ${o.discount > 0 ? `<div class="cart-confirm-order-discount">Voucher applied — −${money(o.discount)}</div>` : ""}
            <ul class="cart-confirm-order-items">
              ${(o.items || []).map((it) => `<li>${it.quantity} × ${escapeHtml(it.product_name)}</li>`).join("")}
            </ul>
          </div>
        `).join("")}
      </div>

      <div class="cart-confirm-total">
        <span>Total paid on delivery</span>
        <strong>${money(grandTotal)}</strong>
      </div>

      <a href="/buyer/index.html" class="btn btn-primary" style="margin-top:8px;"><span class="btn-label">Continue shopping</span></a>
    </div>
  `;
}