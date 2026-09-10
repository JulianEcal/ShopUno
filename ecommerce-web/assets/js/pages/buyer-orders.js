// assets/js/pages/buyer-orders.js
// Buyer order history (buyer/orders.html). Lists every order the buyer has
// placed (GET /orders — one row per seller, since checkout splits a cart
// into one order per seller) as a stack of receipt-style cards. Clicking a
// card fetches the full order (GET /orders/{id}, which is the only endpoint
// that eager-loads statusHistory) and opens a detail modal with a step
// tracker, the itemized breakdown, a status log, and — once delivered — a
// star-rating form (POST /orders/{id}/rating).
//
// Status-tab filtering is done client-side over everything fetched so far:
// the index endpoint has no ?status= filter, so there's nothing server-side
// to call per tab. "Load more" just paginates the full list; switching tabs
// re-filters what's already in memory.

import { api } from "../api.js";
import { initShell } from "../partials/buyer-shell.js";
import { escapeHtml, money, toast, openModal, closeModal, normalizePaginated, formatDate, formatDateTime } from "../lib/ui.js";
import { messageUser } from "../lib/messaging.js";

const STATUS_SEQUENCE = ["to_ship", "in_transit", "out_for_delivery", "delivered"];
const STATUS_LABEL = {
  to_ship: "To ship",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const TRACKER_LABEL = {
  to_ship: "Order placed",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
};

const TABS = [
  { key: "all", label: "All" },
  { key: "to_ship", label: "To ship" },
  { key: "in_transit", label: "In transit" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];

const state = {
  orders: [],
  page: 1,
  lastPage: 1,
  loading: false,
  activeTab: "all",
};

const content = initShell({ page: "orders" });

content.innerHTML = `
  <section class="orders-head">
    <h1>Your <em style="color:var(--chili); font-style:italic;">orders</em></h1>
    <p class="welcome-sub" style="margin-top:6px;">Every order you've placed on ShopUno, split by seller — track status, review what shipped, and rate sellers once things arrive.</p>
  </section>

  <div class="order-stats-strip" id="orderStats"></div>

  <nav class="order-tabs" id="orderTabs" aria-label="Filter orders by status"></nav>

  <div class="order-list" id="orderList">
    ${skeletonRow()}${skeletonRow()}${skeletonRow()}
  </div>

  <div class="load-more-row" id="loadMoreRow" hidden>
    <button type="button" class="btn-load-more" id="loadMoreBtn">
      <span class="btn-label">Show more</span>
      <span class="spinner is-dark"></span>
    </button>
  </div>
`;

renderTabs();
document.getElementById("loadMoreBtn").addEventListener("click", () => {
  state.page += 1;
  loadOrders();
});

loadOrders();

// Deep link from elsewhere in the app (e.g. a "View order" link from the
// Messages thread header) — opens straight to that order's detail modal
// on top of the normal list load, same convention the seller console's
// orders page uses for its own ?view= link.
const viewId = new URLSearchParams(location.search).get("view");
if (viewId) openOrderDetail(viewId);

/* ---------------- loading + list rendering ---------------- */

function skeletonRow() {
  return `
    <div class="receipt receipt-skel">
      <div class="receipt-main">
        <div class="sk-line w30"></div>
        <div class="sk-line w50"></div>
        <div class="sk-line w70"></div>
      </div>
      <div class="receipt-stub">
        <div class="sk-line w60" style="margin:0 auto 10px;"></div>
        <div class="sk-line w40" style="margin:0 auto;"></div>
      </div>
    </div>
  `;
}

async function loadOrders() {
  if (state.loading) return;
  state.loading = true;

  const list = document.getElementById("orderList");
  const loadMoreRow = document.getElementById("loadMoreRow");
  const loadMoreBtn = document.getElementById("loadMoreBtn");
  const isFirstPage = state.page === 1;

  if (isFirstPage) list.innerHTML = `${skeletonRow()}${skeletonRow()}${skeletonRow()}`;
  else { loadMoreBtn.classList.add("is-loading"); loadMoreBtn.disabled = true; }

  try {
    const res = await api.get(`/orders?page=${state.page}`);
    const { items, meta } = normalizePaginated(res);
    state.lastPage = meta?.last_page || 1;
    state.orders = isFirstPage ? items : [...state.orders, ...items];

    renderTabs();
    renderList();
    loadMoreRow.hidden = state.page >= state.lastPage;
  } catch (err) {
    if (isFirstPage) {
      list.innerHTML = errorState(err.message);
      loadMoreRow.hidden = true;
    } else {
      toast(err.message || "Couldn't load more orders.", "error");
      state.page -= 1;
    }
  } finally {
    state.loading = false;
    loadMoreBtn.classList.remove("is-loading");
    loadMoreBtn.disabled = false;
  }
}

function renderTabs() {
  renderStatsStrip();
  const el = document.getElementById("orderTabs");
  el.innerHTML = TABS.map((tab) => {
    const count = tab.key === "all"
      ? state.orders.length
      : state.orders.filter((o) => o.status === tab.key).length;
    return `
      <button type="button" class="order-tab${state.activeTab === tab.key ? " is-active" : ""}" data-tab="${tab.key}">
        ${tab.label}<span class="order-tab-count">${count}</span>
      </button>
    `;
  }).join("");

  el.querySelectorAll(".order-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      renderTabs();
      renderList();
    });
  });
}

function renderStatsStrip() {
  const el = document.getElementById("orderStats");
  const total = state.orders.length;
  const active = state.orders.filter((o) => STATUS_SEQUENCE.includes(o.status) && o.status !== "delivered").length;
  const delivered = state.orders.filter((o) => o.status === "delivered").length;

  el.innerHTML = [
    { label: "Total orders", value: total },
    { label: "In progress", value: active },
    { label: "Delivered", value: delivered },
  ].map((s) => `
    <div class="order-stat-stub">
      <strong>${s.value}</strong>
      <span>${s.label}</span>
    </div>
  `).join("");
}

function renderList() {
  const list = document.getElementById("orderList");
  const filtered = state.activeTab === "all"
    ? state.orders
    : state.orders.filter((o) => o.status === state.activeTab);

  if (filtered.length === 0) {
    list.innerHTML = emptyState();
    return;
  }

  list.innerHTML = filtered.map(orderCard).join("");
  list.querySelectorAll("[data-order-id]").forEach((card) => {
    card.addEventListener("click", (e) => {
      // The seller name links to their shop page instead of opening this
      // order's receipt — can't nest a real <a> inside the card's own
      // <button> (invalid HTML), so it's caught and routed here, same
      // convention as the product-seller-link on Browse.
      const sellerLink = e.target.closest(".receipt-seller-link");
      if (sellerLink) {
        window.location.href = `/buyer/seller.html?id=${sellerLink.dataset.sellerId}`;
        return;
      }
      openOrderDetail(card.dataset.orderId);
    });
  });
}

function orderCard(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const preview = items.slice(0, 3);
  const extra = items.length - preview.length;
  const sellerName = escapeHtml(order.seller?.business_name || "ShopUno seller");

  return `
    <button type="button" class="receipt" data-order-id="${order.id}">
      <div class="receipt-main">
        <div class="receipt-row-top">
          <span class="receipt-id">Order № ${String(order.id).padStart(5, "0")}</span>
          <span class="receipt-date">${formatDate(order.created_at)}</span>
        </div>
        <div class="receipt-seller">
          ${order.seller?.id
            ? `<span class="receipt-seller-link" data-seller-id="${order.seller.id}" role="link" tabindex="0">${sellerName}</span>`
            : sellerName}
        </div>
        <div class="receipt-items">
          ${preview.map((i) => `
            <div class="receipt-line">
              <span class="receipt-line-name">${escapeHtml(i.product_name)}</span>
              <span class="receipt-dots"></span>
              <span class="receipt-line-qty">×${i.quantity}</span>
            </div>
          `).join("")}
          ${extra > 0 ? `<div class="receipt-more">+ ${extra} more item${extra === 1 ? "" : "s"}</div>` : ""}
        </div>
      </div>
      <div class="receipt-stub">
        <span class="receipt-stamp badge-${escapeHtml(order.status)}">${escapeHtml(STATUS_LABEL[order.status] || order.status)}</span>
        <strong class="receipt-total">${money(order.total)}</strong>
        <span class="receipt-total-note">Cash on delivery</span>
        <span class="receipt-view">View receipt →</span>
      </div>
    </button>
  `;
}

function emptyState() {
  const isAll = state.activeTab === "all";
  return `
    <div class="state-card">
      <span class="state-seal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      </span>
      <h3>${isAll ? "No orders yet" : "Nothing here yet"}</h3>
      <p>${isAll
        ? "Once you check out, your orders will show up here — you'll be able to track status and rate sellers after delivery."
        : "No orders currently match this status."}</p>
    </div>
  `;
}

function errorState(message) {
  return `
    <div class="state-card">
      <span class="state-seal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>
      </span>
      <h3>Couldn't load your orders</h3>
      <p>${escapeHtml(message || "Something went wrong. Please try again in a moment.")}</p>
    </div>
  `;
}

/* ---------------- order detail modal ---------------- */

async function openOrderDetail(orderId) {
  openModal((box) => {
    box.innerHTML = `<div class="modal-body"><div class="sk-line w30"></div><div class="sk-line w50"></div><div class="sk-line w70"></div></div>`;
  }, { wide: true });

  try {
    const res = await api.get(`/orders/${orderId}`);
    const order = res?.order;
    if (!order) throw new Error("Order not found.");
    renderOrderDetail(order);
  } catch (err) {
    closeModal();
    toast(err.message || "Couldn't load that order.", "error");
  }
}

function renderOrderDetail(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const history = Array.isArray(order.status_history) ? order.status_history : [];

  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>Order #${String(order.id).padStart(5, "0")}</h3>
          <p>${order.seller?.id
            ? `<a class="ord-detail-seller-link" href="/buyer/seller.html?id=${order.seller.id}">${escapeHtml(order.seller?.business_name || "ShopUno seller")}</a>`
            : escapeHtml(order.seller?.business_name || "ShopUno seller")} · Placed ${formatDateTime(order.created_at)}</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        ${order.status === "cancelled" ? cancelledSeal() : stepTracker(order.status)}

        <div class="ord-detail-items">
          ${items.map((i) => `
            <div class="ord-detail-item">
              <span class="ord-detail-item-name">${escapeHtml(i.product_name)}</span>
              <span class="receipt-dots"></span>
              <span class="ord-detail-item-qty">${money(i.unit_price)}${i.original_unit_price ? ` <span class="price-tag-orig">${money(i.original_unit_price)}</span>` : ""} × ${i.quantity}</span>
              <span class="ord-detail-item-total">${money(i.subtotal)}</span>
            </div>
          `).join("")}
        </div>

        <div class="ord-summary-rows">
          <div class="ord-summary-row"><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
          ${Number(order.discount) > 0 ? `<div class="ord-summary-row is-discount"><span>Voucher discount</span><span>−${money(order.discount)}</span></div>` : ""}
          <div class="ord-summary-row is-total"><span>Total (Cash on delivery)</span><span>${money(order.total)}</span></div>
        </div>

        ${history.length ? `
          <div class="ord-log">
            <h4>Status log</h4>
            <div class="ord-log-list">
              ${history.map((h) => `
                <div class="ord-log-entry">
                  <span class="ord-log-dot"></span>
                  <span class="ord-log-time">${formatDateTime(h.created_at)}</span>
                  <div class="ord-log-body">
                    <strong>${escapeHtml((STATUS_LABEL[h.status] || h.status || "").toString())}</strong>
                    ${h.note ? `<span>${escapeHtml(h.note)}</span>` : ""}
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        <div id="ordRateSlot">${order.status === "delivered" ? ratingBoxHtml() : ""}</div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-close>Close</button>
        ${order.seller?.user_id ? `<button type="button" class="btn btn-primary" id="ordMsgSellerBtn">Message seller</button>` : ""}
      </div>
    `;

    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));

    box.querySelector("#ordMsgSellerBtn")?.addEventListener("click", () => {
      messageUser({
        recipientId: order.seller.user_id,
        recipientName: order.seller.business_name || "this seller",
        orderId: order.id,
        contextLabel: `About Order #${String(order.id).padStart(5, "0")}`,
        redirectTo: "/buyer/messages.html",
      });
    });

    if (order.status === "delivered") wireRatingBox(box, order.id);
  }, { wide: true });
}

function stepTracker(status) {
  const idx = STATUS_SEQUENCE.indexOf(status);
  return `
    <div class="ord-tracker">
      ${STATUS_SEQUENCE.map((s, i) => {
        const done = idx > i;
        const current = idx === i;
        return `
          <div class="ord-step${done ? " is-done" : ""}${current ? " is-current" : ""}">
            <span class="ord-step-line"></span>
            <span class="ord-step-dot">${done
              ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
              : i + 1}</span>
            <span class="ord-step-label">${TRACKER_LABEL[s]}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function cancelledSeal() {
  return `
    <div class="ord-cancelled-seal">
      <span class="stamp">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </span>
      <div>
        <strong>Order cancelled</strong>
        <span>This order was cancelled and won't be charged or shipped.</span>
      </div>
    </div>
  `;
}

/* ---------------- rating ---------------- */

function ratingBoxHtml() {
  return `
    <div class="ord-rate-box">
      <h4>Rate this seller</h4>
      <p>Delivered — let other buyers know how it went.</p>
      <div class="ord-stars" id="ordStars">
        ${[1, 2, 3, 4, 5].map((n) => `
          <button type="button" class="ord-star" data-score="${n}" aria-label="${n} star${n === 1 ? "" : "s"}">
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2.5l2.9 6.06 6.6.77-4.9 4.55 1.28 6.62L12 17.3l-5.88 3.2 1.28-6.62-4.9-4.55 6.6-.77L12 2.5z"/></svg>
          </button>
        `).join("")}
      </div>
      <div class="field-group" style="margin-bottom:12px;">
        <textarea id="ordFeedback" rows="2" maxlength="1000" placeholder="Optional feedback for the seller…"></textarea>
      </div>
      <div class="field-error" id="ordRateError" hidden></div>
      <button type="button" class="btn btn-primary" id="ordRateSubmit">
        <span class="btn-label">Submit rating</span>
        <span class="spinner"></span>
      </button>
    </div>
  `;
}

function wireRatingBox(box, orderId) {
  const slot = box.querySelector("#ordRateSlot");
  if (!slot) return;
  let score = 0;

  const stars = () => Array.from(slot.querySelectorAll(".ord-star"));
  const paintStars = () => stars().forEach((s) => s.classList.toggle("is-filled", Number(s.dataset.score) <= score));

  stars().forEach((s) => {
    s.addEventListener("click", () => { score = Number(s.dataset.score); paintStars(); });
    s.addEventListener("mouseenter", () => stars().forEach((x) => x.classList.toggle("is-filled", Number(x.dataset.score) <= Number(s.dataset.score))));
  });
  slot.querySelector("#ordStars")?.addEventListener("mouseleave", paintStars);

  slot.querySelector("#ordRateSubmit").addEventListener("click", async () => {
    const btn = slot.querySelector("#ordRateSubmit");
    const errorBox = slot.querySelector("#ordRateError");
    errorBox.hidden = true;

    if (score < 1) {
      errorBox.textContent = "Tap a star to choose a rating first.";
      errorBox.hidden = false;
      return;
    }

    btn.classList.add("is-loading");
    btn.disabled = true;
    try {
      const feedback = slot.querySelector("#ordFeedback").value.trim();
      await api.post(`/orders/${orderId}/rating`, { score, feedback: feedback || null });
      slot.innerHTML = `
        <div class="ord-rate-box">
          <div class="ord-rate-done">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Thanks — your rating was submitted.
          </div>
        </div>
      `;
      toast("Rating submitted. Thanks for the feedback!", "success");
    } catch (err) {
      // Backend returns 409 with a friendly message if this order was
      // already rated in an earlier session — surface it as a settled
      // state instead of a retryable error.
      if (err.status === 409) {
        slot.innerHTML = `
          <div class="ord-rate-box">
            <div class="ord-rate-done">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              You've already rated this order.
            </div>
          </div>
        `;
        return;
      }
      errorBox.textContent = err.message || "Couldn't submit your rating.";
      errorBox.hidden = false;
      btn.classList.remove("is-loading");
      btn.disabled = false;
    }
  });
}