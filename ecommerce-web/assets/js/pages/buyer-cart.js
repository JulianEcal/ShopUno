// assets/js/pages/buyer-cart.js
// Buyer cart page (buyer/cart.html). Loads GET /cart, groups items by
// seller (a cart can span multiple sellers — checkout splits it into one
// order per seller, so the cart view mirrors that grouping), lets the
// buyer adjust quantity / remove items / enter one voucher code per
// seller, then checks out via POST /orders. On success it renders an
// inline order-confirmation state (there's no orders.html yet to redirect
// to — see buyer-shell.js NAV_LINKS).

import { api } from "../api.js";
import { API_BASE_URL } from "../config.js";
import { initShell, refreshCartBadge } from "../partials/buyer-shell.js";
import { escapeHtml, money, toast } from "../lib/ui.js";

const APP_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

const content = initShell({ page: null });

// One voucher code per seller_id, kept in memory only — applied at
// checkout time (the backend validates/prices it; we don't try to
// replicate discount math client-side).
const voucherCodes = {};

let cart = null;
let busy = false; // guards against overlapping qty/remove requests re-rendering mid-flight

render(loadingState());
loadCart();

async function loadCart() {
  try {
    const res = await api.get("/cart");
    cart = res?.cart || { items: [], total: 0 };
    render(cart.items.length ? cartView(cart) : emptyState());
  } catch (err) {
    render(errorState(err.message));
  }
}

function resolveImage(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${APP_ORIGIN}/storage/${path.replace(/^\/?storage\//, "")}`;
}

function render(html) {
  content.innerHTML = html;
}

function loadingState() {
  return `
    <div class="cart-head">
      <h1>Your cart</h1>
    </div>
    <div class="cart-layout">
      <div class="cart-items-col">
        ${Array(2).fill(cartSkelGroup()).join("")}
      </div>
      <div class="cart-summary-col">
        <div class="cart-summary sk-thumb" style="height:220px;"></div>
      </div>
    </div>
  `;
}

function cartSkelGroup() {
  return `
    <div class="cart-seller-group">
      <div class="sk-line w40" style="margin:0 0 14px;"></div>
      <div class="cart-item-row">
        <div class="sk-thumb" style="width:72px;height:72px;border-radius:12px;"></div>
        <div style="flex:1;"><div class="sk-line w60"></div><div class="sk-line w40"></div></div>
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

function groupBySeller(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.seller_id;
    if (!groups.has(key)) {
      groups.set(key, { seller_id: key, seller_name: item.seller_name || "ShopUno seller", items: [] });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

function cartView(cart) {
  const groups = groupBySeller(cart.items);
  const itemCount = cart.items.reduce((sum, i) => sum + i.quantity, 0);

  return `
    <div class="cart-head">
      <h1>Your cart</h1>
      <p>${itemCount} item${itemCount === 1 ? "" : "s"} from ${groups.length} seller${groups.length === 1 ? "" : "s"}</p>
    </div>
    <div class="cart-layout">
      <div class="cart-items-col">
        ${groups.map(sellerGroupHtml).join("")}
      </div>
      <div class="cart-summary-col">
        <div class="cart-summary">
          <h2>Order summary</h2>
          <div class="cart-summary-row">
            <span>Subtotal</span>
            <strong id="cartSubtotal">${money(cart.total)}</strong>
          </div>
          <p class="cart-summary-note">Vouchers are applied per seller at checkout. Shipping is arranged with each seller after ordering.</p>
          <button type="button" class="btn btn-primary" id="checkoutBtn" style="width:100%;margin-top:10px;">
            <span class="btn-label">Place order · ${money(cart.total)}</span>
            <span class="spinner"></span>
          </button>
          <div class="field-error" id="checkoutError" hidden></div>
        </div>
      </div>
    </div>
  `;
}

function sellerGroupHtml(group) {
  const subtotal = group.items.reduce((sum, i) => sum + i.line_total, 0);
  const code = voucherCodes[group.seller_id] || "";

  return `
    <div class="cart-seller-group" data-seller-id="${group.seller_id}">
      <div class="cart-seller-head">
        <span class="cart-seller-name">${escapeHtml(group.seller_name)}</span>
        <span class="cart-seller-subtotal">${money(subtotal)}</span>
      </div>

      ${group.items.map(itemRowHtml).join("")}

      <div class="cart-voucher-row">
        <input type="text" class="cart-voucher-input" placeholder="Voucher code (optional)" value="${escapeHtml(code)}" data-voucher-seller="${group.seller_id}">
        <span class="cart-voucher-hint">Applied when you place the order</span>
      </div>
    </div>
  `;
}

function itemRowHtml(item) {
  const thumb = item.image
    ? `<img src="${escapeHtml(resolveImage(item.image))}" alt="${escapeHtml(item.product_name)}">`
    : `<span>${escapeHtml((item.product_name || "?").slice(0, 1).toUpperCase())}</span>`;

  return `
    <div class="cart-item-row" data-item-id="${item.id}">
      <div class="cart-item-thumb">${thumb}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.product_name)}</div>
        ${item.variation ? `<div class="cart-item-variation">${escapeHtml(item.variation.variation_type)}: ${escapeHtml(item.variation.value)}</div>` : ""}
        <div class="cart-item-price">${money(item.unit_price)} each</div>
        <button type="button" class="cart-item-remove" data-remove="${item.id}">Remove</button>
      </div>
      <div class="cart-item-right">
        <div class="qv-stepper cart-stepper">
          <button type="button" data-qty-minus="${item.id}" aria-label="Decrease quantity" ${item.quantity <= 1 ? "disabled" : ""}>−</button>
          <span>${item.quantity}</span>
          <button type="button" data-qty-plus="${item.id}" aria-label="Increase quantity" ${item.quantity >= item.stock ? "disabled" : ""}>+</button>
        </div>
        <div class="cart-item-line-total">${money(item.line_total)}</div>
      </div>
    </div>
  `;
}

/* ---------------- event delegation ---------------- */

content.addEventListener("click", (e) => {
  const minus = e.target.closest("[data-qty-minus]");
  const plus = e.target.closest("[data-qty-plus]");
  const remove = e.target.closest("[data-remove]");
  const checkoutBtn = e.target.closest("#checkoutBtn");

  if (minus) return changeQuantity(Number(minus.dataset.qtyMinus), -1);
  if (plus) return changeQuantity(Number(plus.dataset.qtyPlus), 1);
  if (remove) return removeItem(Number(remove.dataset.remove));
  if (checkoutBtn) return checkout();
});

content.addEventListener("input", (e) => {
  const input = e.target.closest("[data-voucher-seller]");
  if (input) voucherCodes[input.dataset.voucherSeller] = input.value.trim();
});

async function changeQuantity(itemId, delta) {
  if (busy || !cart) return;
  const item = cart.items.find((i) => i.id === itemId);
  if (!item) return;
  const nextQty = item.quantity + delta;
  if (nextQty < 1 || nextQty > item.stock) return;

  busy = true;
  try {
    await api.put(`/cart/items/${itemId}`, { quantity: nextQty });
    await loadCart();
    refreshCartBadge();
  } catch (err) {
    toast(err.message || "Couldn't update quantity.", "error");
  } finally {
    busy = false;
  }
}

async function removeItem(itemId) {
  if (busy) return;
  busy = true;
  try {
    await api.delete(`/cart/items/${itemId}`);
    toast("Removed from cart.", "default");
    await loadCart();
    refreshCartBadge();
  } catch (err) {
    toast(err.message || "Couldn't remove that item.", "error");
  } finally {
    busy = false;
  }
}

async function checkout() {
  const btn = document.getElementById("checkoutBtn");
  const errorBox = document.getElementById("checkoutError");
  if (!btn) return;

  errorBox.hidden = true;
  btn.classList.add("is-loading");
  btn.disabled = true;

  const vouchers = Object.entries(voucherCodes)
    .filter(([, code]) => code)
    .map(([seller_id, code]) => ({ seller_id: Number(seller_id), code }));

  try {
    const res = await api.post("/orders", vouchers.length ? { vouchers } : {});
    refreshCartBadge();
    render(orderConfirmedView(res));
  } catch (err) {
    errorBox.textContent = err.message || "Couldn't place your order. Please try again.";
    errorBox.hidden = false;
    btn.classList.remove("is-loading");
    btn.disabled = false;
  }
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
