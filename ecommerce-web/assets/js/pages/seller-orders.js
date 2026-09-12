// assets/js/pages/seller-orders.js
// Seller's order queue: a filterable table (GET /seller/orders) plus a
// detail modal (GET /seller/orders/{id}) for the seller's actual job here —
// pack it, print a waybill, hand it off with "confirm ready", or cancel it
// before it's handed off. Everything past "handed off" (logistics review,
// courier accept/pickup/deliver) is driven by other roles; this page only
// ever displays that progress, via order.status and the eager-loaded
// order.delivery sub-status — it never assigns or picks a courier itself.

import { api, fetchAuthedFile } from "../api.js";
import { initShell } from "../partials/seller-shell.js";
import {
  escapeHtml, money, toast, debounce, formatDate, formatDateTime,
  normalizePaginated, openModal, closeModal, confirmWithNote,
} from "../lib/ui.js";
import { messageUser } from "../lib/messaging.js";

const content = initShell({ page: "orders", title: "Orders", eyebrow: "Seller console" });

const STATUS_LABEL = {
  to_ship: "To ship",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

// Sub-status shown only while order.status is still 'to_ship' — the order
// itself doesn't change again until a courier actually starts moving it
// (see Delivery::ORDER_STATUS_MAP on the backend), so this is the only way
// to tell "not packed yet" apart from "packed, waiting on logistics/courier."
const DELIVERY_SUBSTATUS_LABEL = {
  awaiting_logistics_confirmation: "Awaiting logistics confirmation",
  pending: "Confirmed — waiting for a courier",
  accepted: "Courier assigned — awaiting pickup",
};

content.innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Your orders</h3>
        <p>Pack what's ready, print waybills, and hand off for delivery.</p>
      </div>
    </div>
    <div class="filter-bar">
      <div class="msg-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" id="fSearch" placeholder="Search order # or buyer name…">
      </div>
      <select id="fStatus">
        <option value="">All statuses</option>
        <option value="to_ship">To ship</option>
        <option value="in_transit">In transit</option>
        <option value="out_for_delivery">Out for delivery</option>
        <option value="delivered">Delivered</option>
        <option value="cancelled">Cancelled</option>
      </select>
      <input type="date" id="fFrom" title="Placed from">
      <span class="text-muted" style="font-size:12.5px;">to</span>
      <input type="date" id="fTo" title="Placed to">
      <div class="filter-spacer"></div>
      <div class="view-toggle" role="group" aria-label="View">
        <button type="button" class="view-toggle-btn" data-view="list" title="List view">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        </button>
        <button type="button" class="view-toggle-btn" data-view="grid" title="Grid view">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
        </button>
      </div>
    </div>
    <div class="bulk-bar" id="bulkBar" hidden>
      <span class="bulk-bar-count" id="bulkCount"></span>
      <button type="button" class="btn btn-sm btn-primary" id="bulkConfirmBtn">Confirm ready</button>
      <button type="button" class="btn btn-sm btn-outline" id="bulkWaybillBtn">Print waybills</button>
      <span class="filter-spacer"></span>
      <button type="button" class="bulk-bar-clear" id="bulkClearBtn">Clear selection</button>
    </div>
    <div class="table-wrap" id="tableWrap">
      <table class="data-table">
        <thead>
          <tr><th class="rowcheck"><input type="checkbox" id="selectAllCheck"></th><th>Order</th><th>Buyer</th><th>Items</th><th>Total</th><th>Status</th><th class="col-collapse">Placed</th><th></th></tr>
        </thead>
        <tbody id="tbody">
          <tr><td colspan="8" class="table-loading">Loading…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="order-grid" id="orderGrid" hidden></div>
    <div class="pagination" id="pagination" hidden></div>
  </div>
`;

/* ---------------- state, seeded from the query string ---------------- */
const url = new URLSearchParams(location.search);
const VIEW_KEY = "seller_orders_view";
const state = {
  search: "",
  status: url.get("status") || "",
  from: "",
  to: "",
  page: 1,
  view: localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list",
};

let selected = new Set(); // order ids checked in the current page's table — "to ship, not yet handed off" only
let orderLookup = new Map();

document.getElementById("fSearch").addEventListener("input", debounce((e) => {
  state.search = e.target.value.trim();
  state.page = 1;
  load();
}, 350));
document.getElementById("fStatus").addEventListener("change", (e) => {
  state.status = e.target.value;
  state.page = 1;
  load();
});
document.getElementById("fFrom").addEventListener("change", (e) => { state.from = e.target.value; state.page = 1; load(); });
document.getElementById("fTo").addEventListener("change", (e) => { state.to = e.target.value; state.page = 1; load(); });

// View toggle (table vs. card view) — same pattern and per-browser
// localStorage key convention as the Products page's list/grid toggle.
document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.view = btn.dataset.view;
    localStorage.setItem(VIEW_KEY, state.view);
    updateViewToggle();
    renderCurrentView();
  });
});

function updateViewToggle() {
  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === state.view);
  });
  document.getElementById("tableWrap").hidden = state.view !== "list";
  document.getElementById("orderGrid").hidden = state.view !== "grid";
}
updateViewToggle();

document.getElementById("selectAllCheck").addEventListener("change", (e) => {
  document.querySelectorAll("[data-row-check]:not(:disabled)").forEach((cb) => {
    cb.checked = e.target.checked;
    if (e.target.checked) selected.add(cb.dataset.rowCheck); else selected.delete(cb.dataset.rowCheck);
  });
  renderBulkBar();
});
document.getElementById("bulkClearBtn").addEventListener("click", () => { selected.clear(); load(); });
document.getElementById("bulkConfirmBtn").addEventListener("click", () => bulkConfirmReady());
document.getElementById("bulkWaybillBtn").addEventListener("click", () => bulkPrintWaybills());

if (state.status) document.getElementById("fStatus").value = state.status;

load();

// Deep link from elsewhere in the console (e.g. the ratings page linking
// "Order #00023" back to it) — opens straight to that order's detail modal
// on top of the normal table load, same "?param opens a modal" convention
// vouchers.html already uses for "?new=1".
const viewId = url.get("view");
if (viewId) openOrderDetail(viewId);

/* ---------------- list ---------------- */
let lastItems = [];

async function load() {
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = `<tr><td colspan="8" class="table-loading">Loading…</td></tr>`;
  document.getElementById("orderGrid").innerHTML = `<div class="empty-state">Loading…</div>`;
  selected.clear();
  renderBulkBar();
  document.getElementById("selectAllCheck").checked = false;

  const params = new URLSearchParams();
  if (state.search) params.set("search", state.search);
  if (state.status) params.set("status", state.status);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  params.set("page", state.page);

  try {
    const json = await api.get(`/seller/orders?${params.toString()}`);
    const { items, meta } = normalizePaginated(json);
    lastItems = items;
    orderLookup = new Map(items.map((o) => [String(o.id), o]));
    renderCurrentView();
    renderPagination(meta);
  } catch (err) {
    const msg = escapeHtml(err.message || "Failed to load your orders.");
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">${msg}</td></tr>`;
    document.getElementById("orderGrid").innerHTML = `<div class="empty-state">${msg}</div>`;
  }
}

function renderCurrentView() {
  if (state.view === "grid") {
    document.getElementById("tbody").innerHTML = "";
    renderGrid(lastItems);
  } else {
    document.getElementById("orderGrid").innerHTML = "";
    renderTable(lastItems);
  }
}

function statusCellHtml(order) {
  const badge = `<span class="badge badge-${escapeHtml(order.status)}">${escapeHtml(STATUS_LABEL[order.status] || order.status)}</span>`;
  if (order.status !== "to_ship") return badge;

  const sub = order.delivery
    ? DELIVERY_SUBSTATUS_LABEL[order.delivery.status] || order.delivery.status
    : "Ready to pack";
  return `${badge}<div class="cell-sub" style="margin-top:4px;">${escapeHtml(sub)}</div>`;
}

/** Just the badge, no sub-status line — for the order card's header row,
 * which is a single flex line rather than a table cell that can stack a
 * badge over a caption underneath it. */
function statusBadgeHtml(order) {
  return `<span class="badge badge-${escapeHtml(order.status)}">${escapeHtml(STATUS_LABEL[order.status] || order.status)}</span>`;
}

function orderSubstatusText(order) {
  if (order.status !== "to_ship") return "";
  return order.delivery
    ? DELIVERY_SUBSTATUS_LABEL[order.delivery.status] || order.delivery.status
    : "Ready to pack";
}

function renderTable(items) {
  const tbody = document.getElementById("tbody");
  orderLookup = new Map(items.map((o) => [String(o.id), o]));
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No orders match these filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = items
    .map((o) => {
      const itemsList = Array.isArray(o.items) ? o.items : [];
      const preview = itemsList.slice(0, 2).map((i) => escapeHtml(i.product_name)).join(", ");
      const extra = itemsList.length - 2;
      const eligible = o.status === "to_ship" && !o.delivery; // only these can be bulk-confirmed
      return `
      <tr>
        <td class="cell-check"><input type="checkbox" data-row-check="${o.id}" ${eligible ? "" : "disabled title=\"Only orders not yet packed can be selected\""}></td>
        <td class="mono">#${String(o.id).padStart(5, "0")}</td>
        <td>${escapeHtml(o.buyer?.name || "—")}</td>
        <td>
          <div class="cell-sub">${preview}${extra > 0 ? ` + ${extra} more` : ""}</div>
        </td>
        <td class="mono">${money(o.total)}</td>
        <td>
          ${statusCellHtml(o)}
          <div class="cell-sub cell-sub-collapse">${formatDate(o.created_at)}</div>
        </td>
        <td class="mono col-collapse">${formatDate(o.created_at)}</td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-sm btn-outline" data-view="${o.id}">View</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-row-check]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(cb.dataset.rowCheck); else selected.delete(cb.dataset.rowCheck);
      renderBulkBar();
    });
  });
  tbody.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => openOrderDetail(b.dataset.view)));
}

/** Card alternative to the table — same data, same row actions and
 * bulk-select behavior, just laid out as a compact order ticket. No
 * product photos to lean on here (unlike the Products grid), so each
 * card leads with the order number and status instead of an image. */
function renderGrid(items) {
  const grid = document.getElementById("orderGrid");
  orderLookup = new Map(items.map((o) => [String(o.id), o]));
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state">No orders match these filters.</div>`;
    return;
  }
  grid.innerHTML = items
    .map((o) => {
      const itemsList = Array.isArray(o.items) ? o.items : [];
      const preview = itemsList.slice(0, 2).map((i) => escapeHtml(i.product_name)).join(", ");
      const extra = itemsList.length - 2;
      const eligible = o.status === "to_ship" && !o.delivery; // only these can be bulk-confirmed
      return `
      <div class="order-card">
        <div class="order-card-head">
          <input type="checkbox" class="order-card-check" data-row-check="${o.id}" ${eligible ? "" : "disabled title=\"Only orders not yet packed can be selected\""}>
          <span class="mono order-card-num">#${String(o.id).padStart(5, "0")}</span>
          ${statusBadgeHtml(o)}
        </div>
        ${orderSubstatusText(o) ? `<div class="cell-sub">${escapeHtml(orderSubstatusText(o))}</div>` : ""}
        <div class="order-card-body">
          <div class="cell-name">${escapeHtml(o.buyer?.name || "—")}</div>
          <div class="cell-sub">${preview}${extra > 0 ? ` + ${extra} more` : ""}</div>
        </div>
        <div class="order-card-meta">
          <span class="mono">${money(o.total)}</span>
          <span class="cell-sub">${formatDate(o.created_at)}</span>
        </div>
        <div class="order-card-actions">
          <button class="btn btn-sm btn-outline" data-view="${o.id}">View</button>
        </div>
      </div>`;
    })
    .join("");

  grid.querySelectorAll("[data-row-check]").forEach((cb) => {
    cb.checked = selected.has(String(cb.dataset.rowCheck));
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(cb.dataset.rowCheck); else selected.delete(cb.dataset.rowCheck);
      renderBulkBar();
    });
  });
  grid.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => openOrderDetail(b.dataset.view)));
}

function renderBulkBar() {
  const bar = document.getElementById("bulkBar");
  bar.hidden = selected.size === 0;
  if (selected.size) document.getElementById("bulkCount").textContent = `${selected.size} selected`;
}

function bulkConfirmReady() {
  const ids = [...selected];
  if (!ids.length) return;
  const btn = document.getElementById("bulkConfirmBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>`;
  Promise.allSettled(ids.map((id) => api.post(`/seller/orders/${id}/confirm-ready`)))
    .then((results) => {
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed) toast(`Handed off ${ids.length - failed} of ${ids.length} — ${failed} couldn't be confirmed.`, failed === ids.length ? "error" : "success");
      else toast(`${ids.length} order${ids.length === 1 ? "" : "s"} handed off for delivery.`, "success");
      load();
    })
    .finally(() => { btn.disabled = false; btn.textContent = "Confirm ready"; });
}

async function bulkPrintWaybills() {
  const ids = [...selected];
  if (!ids.length) return;
  const btn = document.getElementById("bulkWaybillBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>`;
  try {
    // Opens each waybill in its own tab, one after another — there's no
    // bulk-PDF endpoint on the backend today, so this is the closest a
    // seller can get to "print everything I just selected" without it.
    for (const id of ids) {
      await printWaybill(id);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Print waybills";
  }
}

function renderPagination(meta) {
  const el = document.getElementById("pagination");
  if (!meta || !meta.last_page || meta.last_page <= 1) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `
    <span>Page ${meta.current_page} of ${meta.last_page} · ${meta.total ?? ""} total</span>
    <div class="page-controls">
      <button class="btn btn-sm btn-outline" id="prevPage" ${meta.current_page <= 1 ? "disabled" : ""}>Previous</button>
      ${meta.last_page > 2 ? `
        <span class="page-jump">
          <span>Go to</span>
          <input type="number" id="pageJumpInput" min="1" max="${meta.last_page}" value="${meta.current_page}">
        </span>` : ""}
      <button class="btn btn-sm btn-outline" id="nextPage" ${meta.current_page >= meta.last_page ? "disabled" : ""}>Next</button>
    </div>
  `;
  document.getElementById("prevPage")?.addEventListener("click", () => { state.page = Math.max(1, state.page - 1); load(); });
  document.getElementById("nextPage")?.addEventListener("click", () => { state.page += 1; load(); });
  document.getElementById("pageJumpInput")?.addEventListener("change", (e) => {
    const val = Math.min(Math.max(1, Number(e.target.value) || 1), meta.last_page);
    state.page = val;
    load();
  });
}

/* ---------------- detail modal ---------------- */
async function openOrderDetail(id) {
  openModal((box) => {
    box.innerHTML = `<div class="modal-body" style="padding-top:24px"><div class="empty-state">Loading order…</div></div>`;
  }, { wide: true });

  try {
    const { order } = await api.get(`/seller/orders/${id}`);
    renderOrderDetail(order);
  } catch (err) {
    toast(err.message || "Failed to load that order.", "error");
    closeModal();
  }
}

function formatAddress(addr) {
  if (!addr) return "No address on file.";
  return [addr.house_number, addr.street, addr.barangay, addr.municipality, addr.province]
    .filter(Boolean).join(", ");
}

function renderOrderDetail(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const history = Array.isArray(order.status_history) ? order.status_history : [];

  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>Order #${String(order.id).padStart(5, "0")}</h3>
          <p>Placed ${formatDateTime(order.created_at)} · ${escapeHtml(order.payment_method || "COD")}</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        ${handoffBannerHtml(order)}

        <div class="ord-detail-items">
          ${items.map((i) => `
            <div class="ord-detail-item">
              <span class="ord-detail-item-name">${escapeHtml(i.product_name)}</span>
              <span class="ord-detail-item-qty">${money(i.unit_price)}${i.original_unit_price ? ` <span class="price-tag-orig">${money(i.original_unit_price)}</span>` : ""} × ${i.quantity}</span>
              <span class="ord-detail-item-total">${money(i.subtotal)}</span>
            </div>
          `).join("")}
        </div>

        <div class="ord-summary-rows">
          <div class="ord-summary-row"><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
          ${Number(order.discount) > 0 ? `<div class="ord-summary-row is-discount"><span>Voucher discount</span><span>−${money(order.discount)}</span></div>` : ""}
          <div class="ord-summary-row is-total"><span>Total</span><span>${money(order.total)}</span></div>
        </div>

        <div class="ord-ship-block">
          <h4>Ship to</h4>
          <p><strong>${escapeHtml(order.buyer?.name || "—")}</strong> · ${escapeHtml(order.buyer?.contact_no || "No contact on file")}</p>
          <p>${escapeHtml(formatAddress(order.buyer?.address))}</p>
          <p class="text-muted" style="margin-top:4px;">Courier: ${escapeHtml(order.logistics_company?.company_name || "Not yet chosen by buyer")}</p>
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
                    <strong>${escapeHtml(STATUS_LABEL[h.status] || h.status || "")}</strong>
                    ${h.note ? `<span>${escapeHtml(h.note)}</span>` : ""}
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-close>Close</button>
        ${order.buyer?.id ? `<button type="button" class="btn btn-outline" id="msgBuyerBtn">Message buyer</button>` : ""}
        ${order.status !== "cancelled" ? `<button type="button" class="btn btn-outline" id="waybillBtn">Print waybill</button>` : ""}
        ${order.status === "to_ship" && !order.delivery ? `
          <button type="button" class="btn btn-caution" id="cancelBtn">Cancel order</button>
          <button type="button" class="btn btn-primary" id="confirmReadyBtn">Confirm ready</button>
        ` : ""}
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));

    box.querySelector("#msgBuyerBtn")?.addEventListener("click", () => {
      messageUser({
        recipientId: order.buyer.id,
        recipientName: order.buyer.name || "this buyer",
        orderId: order.id,
        contextLabel: `About Order #${String(order.id).padStart(5, "0")}`,
        redirectTo: "/seller/messages.html",
      });
    });
    box.querySelector("#waybillBtn")?.addEventListener("click", () => printWaybill(order.id));
    box.querySelector("#confirmReadyBtn")?.addEventListener("click", () => confirmReady(order));
    box.querySelector("#cancelBtn")?.addEventListener("click", () => cancelOrder(order));
  }, { wide: true });
}

function handoffBannerHtml(order) {
  if (order.status === "cancelled") {
    return `<div class="ord-cancelled-seal"><div><strong>Order cancelled</strong><span>This order won't be packed or shipped.</span></div></div>`;
  }
  if (order.status !== "to_ship") {
    return `<div class="ord-handoff-note is-good"><strong>${escapeHtml(STATUS_LABEL[order.status])}</strong><span>Handed off — the courier now owns this order's status.</span></div>`;
  }
  if (order.delivery) {
    const label = DELIVERY_SUBSTATUS_LABEL[order.delivery.status] || order.delivery.status;
    return `<div class="ord-handoff-note"><strong>Handed off for delivery</strong><span>${escapeHtml(label)} — nothing left for you to do here until it ships.</span></div>`;
  }
  return `<div class="ord-handoff-note is-warm"><strong>Not packed yet</strong><span>Print the waybill while you pack, then confirm ready to hand it off.</span></div>`;
}

async function printWaybill(id) {
  try {
    const { blob } = await fetchAuthedFile(`/seller/orders/${id}/waybill/print`);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  } catch (err) {
    toast(err.message || "Couldn't generate the waybill.", "error");
  }
}

function confirmReady(order) {
  const btn = document.getElementById("confirmReadyBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>`;
  api.post(`/seller/orders/${order.id}/confirm-ready`)
    .then(() => {
      toast("Order handed off — awaiting logistics confirmation.", "success");
      closeModal();
      load();
    })
    .catch((err) => {
      toast(err.message || "Couldn't hand this order off.", "error");
      btn.disabled = false;
      btn.textContent = "Confirm ready";
    });
}

function cancelOrder(order) {
  confirmWithNote({
    title: "Cancel this order?",
    description: "The buyer will see this order as cancelled. This can't be undone once confirmed.",
    fieldLabel: "Reason for cancellation",
    fieldPlaceholder: "e.g. Out of stock, buyer requested cancellation…",
    confirmLabel: "Cancel order",
    tone: "danger",
    onConfirm: async (note) => {
      await api.patch(`/seller/orders/${order.id}/status`, { status: "cancelled", note });
      toast("Order cancelled.", "success");
      load();
    },
  });
}
