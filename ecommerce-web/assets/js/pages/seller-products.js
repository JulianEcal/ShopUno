// assets/js/pages/seller-products.js
// Seller's inventory manager: a filterable table of the seller's own
// products (including archived) plus a tabbed "manage" modal for editing
// a product's details, photos, and variations. New products are created
// with just the Details tab (images/variations need a real product id
// first), then the same modal reopens in full manage mode right after.

import { api } from "../api.js";
import { getUser } from "../auth.js";
import { initShell } from "../partials/seller-shell.js";
import {
  escapeHtml, money, toast, debounce, formatDateTime,
  normalizePaginated, openModal, closeModal, forceCloseModal, confirmSimple,
} from "../lib/ui.js";

/* The Combinations grid (see renderComboSection) is the one part of the
   Options tab that doesn't autosave — price/stock edits just sit in the
   inputs until "Save all combinations" is clicked. Unlike the confirm-modal
   bug above, nothing here was crashing; it was quietly *working as coded*
   in a way that loses data: nothing stopped a seller from typing stock
   numbers into every row and then hitting Back/Next/Review (or closing the
   modal, or switching tabs) without ever clicking Save, silently discarding
   everything they just entered. These two helpers close that gap by
   tracking whether the currently-rendered combo grid has unsaved edits
   (see the "input" listener added in renderComboSection) and gating any
   navigation away from it behind a confirmation. Since only one modal is
   ever open at a time (see ui.js's single overlay), it's safe to just look
   up the current combo section straight from the document. */
function comboSectionIsDirty() {
  return document.getElementById("comboSection")?.dataset.dirty === "1";
}

function confirmLeaveDirtyCombos(proceed) {
  if (!comboSectionIsDirty()) { proceed(); return; }
  confirmSimple({
    title: "Leave without saving stock/price?",
    description: "You've edited price or stock for one or more combinations but haven't saved. Leaving now will lose those changes.",
    confirmLabel: "Discard changes",
    tone: "danger",
    onConfirm: async () => proceed(),
  });
}

const content = initShell({ page: "products", title: "Products", eyebrow: "Seller console" });

content.innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Your inventory</h3>
        <p>Everything you've listed — active and archived.</p>
      </div>
      <button type="button" class="btn btn-primary" id="addProductBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add product
      </button>
    </div>
    <div class="filter-bar">
      <div class="msg-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" id="fSearch" placeholder="Search your products…">
      </div>
      <select id="fCategory"><option value="">All categories</option></select>
      <select id="fStock">
        <option value="">Any stock level</option>
        <option value="low">Low stock (≤5)</option>
        <option value="out">Out of stock</option>
      </select>
      <select id="fStatus">
        <option value="live">Live</option>
        <option value="draft">Draft</option>
        <option value="archived">Archived</option>
        <option value="">All</option>
      </select>
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
      <button type="button" class="btn btn-sm btn-outline" id="bulkDiscountBtn">Set discount…</button>
      <button type="button" class="btn btn-sm btn-caution" id="bulkArchiveBtn">Archive selected</button>
      <button type="button" class="btn btn-sm btn-outline" id="bulkRestoreBtn">Restore selected</button>
      <button type="button" class="btn btn-sm btn-danger" id="bulkDeleteBtn">Delete selected</button>
      <span class="filter-spacer"></span>
      <button type="button" class="bulk-bar-clear" id="bulkClearBtn">Clear selection</button>
    </div>
    <div class="table-wrap" id="tableWrap">
      <table class="data-table">
        <thead>
          <tr>
            <th class="rowcheck"><input type="checkbox" id="selectAllCheck"></th>
            <th>Product</th>
            <th><button type="button" class="th-sort" data-sort="price">Price<span class="sort-arrow"></span></button></th>
            <th><button type="button" class="th-sort" data-sort="stock">Stock<span class="sort-arrow"></span></button></th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="tbody">
          <tr><td colspan="6" class="table-loading">Loading…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="product-grid" id="productGrid" hidden></div>
    <div class="pagination" id="pagination" hidden></div>
  </div>
`;

/* ---------------- state, seeded from the query string ---------------- */
const url = new URLSearchParams(location.search);
const filterParam = url.get("filter"); // "low_stock" | "flagged" | "draft" — from dashboard links
const VIEW_KEY = "seller_products_view";
const state = {
  search: "",
  category: "",
  stock: filterParam === "low_stock" ? "low" : "",
  flagged: filterParam === "flagged",
  status: filterParam === "draft" ? "draft" : "live",
  page: 1,
  sort: "",     // "price" | "stock" | ""
  order: "asc", // "asc" | "desc"
  view: localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list",
};

let categoriesFlat = []; // [{id, name, depth}] — top-level + one level of children, indented
let selected = new Set(); // product ids checked in the current page's table
let productLookup = new Map(); // id -> product, for the current page (used by bulk actions)

document.getElementById("fSearch").addEventListener("input", debounce((e) => {
  state.search = e.target.value.trim();
  state.page = 1;
  load();
}, 350));
document.getElementById("fCategory").addEventListener("change", (e) => { state.category = e.target.value; state.page = 1; load(); });
document.getElementById("fStock").addEventListener("change", (e) => { state.stock = e.target.value; state.page = 1; load(); });
document.getElementById("fStatus").addEventListener("change", (e) => { state.status = e.target.value; state.page = 1; load(); });
document.getElementById("addProductBtn").addEventListener("click", () => openAddWizard());

// Sortable Price/Stock headers. Sent to the API as ?sort=&order= (standard
// REST convention) — if the backend doesn't support it yet, the client-side
// sort in renderTable's caller still reorders whatever page comes back, so
// clicking a header is never a no-op from the seller's point of view.
document.querySelectorAll(".th-sort").forEach((btn) => {
  btn.addEventListener("click", () => {
    const col = btn.dataset.sort;
    if (state.sort === col) {
      state.order = state.order === "asc" ? "desc" : "asc";
    } else {
      state.sort = col;
      state.order = "asc";
    }
    updateSortArrows();
    load();
  });
});

function updateSortArrows() {
  document.querySelectorAll(".th-sort").forEach((btn) => {
    const arrow = btn.querySelector(".sort-arrow");
    btn.classList.toggle("is-active", btn.dataset.sort === state.sort);
    arrow.textContent = btn.dataset.sort === state.sort ? (state.order === "asc" ? "↑" : "↓") : "";
  });
}

// View toggle (table vs. photo-forward grid). Remembered per-browser since
// it's a personal display preference, not something worth a backend round
// trip for.
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
  document.getElementById("productGrid").hidden = state.view !== "grid";
}
updateViewToggle();

if (state.stock) document.getElementById("fStock").value = state.stock;
document.getElementById("fStatus").value = state.status;

document.getElementById("selectAllCheck").addEventListener("change", (e) => {
  document.querySelectorAll("[data-row-check]").forEach((cb) => {
    cb.checked = e.target.checked;
    if (e.target.checked) selected.add(cb.dataset.rowCheck); else selected.delete(cb.dataset.rowCheck);
  });
  renderBulkBar();
});
document.getElementById("bulkClearBtn").addEventListener("click", () => { selected.clear(); load(); });
document.getElementById("bulkDiscountBtn").addEventListener("click", () => bulkSetDiscount());
document.getElementById("bulkArchiveBtn").addEventListener("click", () => bulkArchive());
document.getElementById("bulkRestoreBtn").addEventListener("click", () => bulkRestore());
document.getElementById("bulkDeleteBtn").addEventListener("click", () => bulkForceDelete());

loadCategories();
load();

// Quick-actions on the dashboard link here with ?new=1 to jump straight
// into the "add a product" flow.
if (url.get("new") === "1") openAddWizard();

/* ---------------- categories (for the filter + the product form) ---------------- */
async function loadCategories() {
  try {
    const res = await api.get("/categories");
    const top = res?.data || [];
    categoriesFlat = [];
    top.forEach((c) => {
      categoriesFlat.push({ id: c.id, name: c.name, depth: 0 });
      (c.children || []).forEach((child) => categoriesFlat.push({ id: child.id, name: child.name, depth: 1 }));
    });
    const select = document.getElementById("fCategory");
    categoriesFlat.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = (c.depth ? "— " : "") + c.name;
      select.appendChild(opt);
    });
  } catch {
    // Filter is a nice-to-have; the table still works without categories loaded.
  }
}

function categoryOptionsHtml(selectedId) {
  if (!categoriesFlat.length) return `<option value="">Loading categories…</option>`;
  return categoriesFlat
    .map((c) => `<option value="${c.id}" ${String(c.id) === String(selectedId) ? "selected" : ""}>${(c.depth ? "— " : "") + escapeHtml(c.name)}</option>`)
    .join("");
}

/* ---------------- list ---------------- */
let lastItems = [];

async function load() {
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = `<tr><td colspan="6" class="table-loading">Loading…</td></tr>`;
  document.getElementById("productGrid").innerHTML = `<div class="empty-state">Loading…</div>`;
  selected.clear();
  renderBulkBar();
  document.getElementById("selectAllCheck").checked = false;

  const params = new URLSearchParams();
  if (state.search) params.set("search", state.search);
  if (state.category) params.set("category", state.category);
  if (state.stock) params.set("stock", state.stock);
  if (state.status) params.set("status", state.status);
  if (state.flagged) params.set("flagged", "1");
  if (state.sort) { params.set("sort", state.sort); params.set("order", state.order); }
  params.set("page", state.page);

  try {
    const json = await api.get(`/seller/products?${params.toString()}`);
    const { items, meta } = normalizePaginated(json);
    if (state.sort) {
      items.sort((a, b) => {
        const av = state.sort === "price" ? Number(a.base_price) : Number(a.stock ?? 0);
        const bv = state.sort === "price" ? Number(b.base_price) : Number(b.stock ?? 0);
        return state.order === "asc" ? av - bv : bv - av;
      });
    }
    lastItems = items;
    productLookup = new Map(items.map((p) => [String(p.id), p]));
    renderCurrentView();
    renderPagination(meta);
  } catch (err) {
    const msg = escapeHtml(err.message || "Failed to load your products.");
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">${msg}</td></tr>`;
    document.getElementById("productGrid").innerHTML = `<div class="empty-state">${msg}</div>`;
  }
}

function renderCurrentView() {
  if (state.view === "grid") {
    document.getElementById("tbody").innerHTML = "";
    renderGrid(lastItems);
  } else {
    document.getElementById("productGrid").innerHTML = "";
    renderTable(lastItems);
  }
}

/** Shows/hides the contextual bulk-action bar and toggles which buttons
 * make sense for the current selection — Archive only applies to active
 * (or pending-review) products, Restore/Delete only to archived ones. Mixed
 * selections across both simply show every applicable button. */
function renderBulkBar() {
  const bar = document.getElementById("bulkBar");
  const count = selected.size;
  bar.hidden = count === 0;
  if (count === 0) return;
  document.getElementById("bulkCount").textContent = `${count} selected`;
  const anyArchived = [...selected].some((id) => productLookup.get(id)?.is_archived);
  const anyActive = [...selected].some((id) => !productLookup.get(id)?.is_archived);
  document.getElementById("bulkDiscountBtn").hidden = !anyActive;
  document.getElementById("bulkArchiveBtn").hidden = !anyActive;
  document.getElementById("bulkRestoreBtn").hidden = !anyArchived;
  document.getElementById("bulkDeleteBtn").hidden = !anyArchived;
}

function bulkArchive() {
  const ids = [...selected].filter((id) => !productLookup.get(id)?.is_archived);
  if (!ids.length) return;
  confirmSimple({
    title: `Archive ${ids.length} product${ids.length === 1 ? "" : "s"}?`,
    description: "They'll disappear from your storefront but stay on past orders. You can restore them anytime.",
    confirmLabel: "Archive",
    tone: "danger",
    onConfirm: async () => {
      await Promise.all(ids.map((id) => api.delete(`/seller/products/${id}`)));
      toast(`${ids.length} product${ids.length === 1 ? "" : "s"} archived.`, "success");
      load();
    },
  });
}

function bulkRestore() {
  const ids = [...selected].filter((id) => productLookup.get(id)?.is_archived);
  if (!ids.length) return;
  Promise.all(ids.map((id) => api.post(`/seller/products/${id}/restore`)))
    .then(() => { toast(`${ids.length} product${ids.length === 1 ? "" : "s"} restored.`, "success"); load(); })
    .catch((err) => toast(err.message || "Failed to restore some products.", "error"));
}

function bulkForceDelete() {
  const ids = [...selected].filter((id) => productLookup.get(id)?.is_archived);
  if (!ids.length) return;
  confirmSimple({
    title: `Permanently delete ${ids.length} product${ids.length === 1 ? "" : "s"}?`,
    description: "This can't be undone. (Any with order history stay archived instead of deleting.)",
    confirmLabel: "Delete permanently",
    tone: "danger",
    onConfirm: async () => {
      await Promise.all(ids.map((id) => api.delete(`/seller/products/${id}/force`)));
      toast(`${ids.length} product${ids.length === 1 ? "" : "s"} permanently deleted.`, "success");
      load();
    },
  });
}

/** Entry point for the bulk-bar's "Set discount…" button — the second
 * half of getting discounts out of hiding: instead of opening each
 * product's Manage modal one at a time, a seller can multi-select and
 * run the same sale across all of them in one form. Archived products
 * are excluded the same way Archive/Delete already exclude the wrong
 * half of a mixed selection. */
function bulkSetDiscount() {
  const ids = [...selected].filter((id) => !productLookup.get(id)?.is_archived);
  if (!ids.length) return;
  openBulkDiscountModal(ids);
}

/** A trimmed-down cousin of renderDiscountTab: same type/value/schedule
 * fields, but no per-product summary (the selection can mix products that
 * already have a discount with ones that don't) and no pause/resume/remove,
 * since those only make sense for a single product's existing discount.
 * Submits with Promise.allSettled rather than Promise.all because a fixed-
 * amount discount that's valid for one product can be invalid for another
 * (e.g. bigger than its price) — the seller should see exactly how many
 * went through rather than the whole batch failing over one bad fit. */
function openBulkDiscountModal(ids) {
  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>Set a sale for ${ids.length} product${ids.length === 1 ? "" : "s"}</h3>
          <p>Applies the same discount to every selected product. Any that can't take this exact discount (e.g. a fixed amount bigger than their price) are skipped and reported back to you.</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body" style="padding-top:12px">
        <div class="disc-panel" style="gap:16px;">
          <form id="bulkDiscForm">
            <div class="field-group">
              <label>Discount type</label>
              <div class="disc-type-toggle">
                <button type="button" class="disc-type-btn is-active" data-bulk-disc-type="percentage">Percentage off</button>
                <button type="button" class="disc-type-btn" data-bulk-disc-type="fixed">Fixed amount off</button>
              </div>
              <input type="hidden" id="bulkDiscType" value="percentage">
            </div>
            <div class="field-group">
              <label for="bulkDiscValue">Discount value</label>
              <div class="disc-value-row">
                <span class="disc-value-suffix" id="bulkDiscValuePrefix" hidden>₱</span>
                <input type="number" id="bulkDiscValue" min="0.01" step="0.01" max="99" required placeholder="e.g. 20">
                <span class="disc-value-suffix" id="bulkDiscValueSuffix">%</span>
              </div>
              <span class="disc-hint" id="bulkDiscValueHint">Must be less than 100%.</span>
            </div>
            <div class="field-group">
              <label>Schedule <span class="field-optional">(optional)</span></label>
              <div class="disc-schedule-grid">
                <div>
                  <label for="bulkDiscStart" class="disc-hint">Starts</label>
                  <input type="datetime-local" id="bulkDiscStart">
                </div>
                <div>
                  <label for="bulkDiscEnd" class="disc-hint">Ends</label>
                  <input type="datetime-local" id="bulkDiscEnd">
                </div>
              </div>
              <span class="disc-hint">Leave both blank for an ongoing discount. Set only an end date to run it "until" a certain time.</span>
            </div>
            <div class="field-error" data-error hidden></div>
          </form>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-close>Cancel</button>
        <button type="submit" form="bulkDiscForm" class="btn btn-primary" id="bulkDiscSubmit">Apply to ${ids.length} product${ids.length === 1 ? "" : "s"}</button>
      </div>
    `;

    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));

    const typeInput = box.querySelector("#bulkDiscType");
    const valueInput = box.querySelector("#bulkDiscValue");
    const prefixEl = box.querySelector("#bulkDiscValuePrefix");
    const suffixEl = box.querySelector("#bulkDiscValueSuffix");
    const hintEl = box.querySelector("#bulkDiscValueHint");
    const errorBox = box.querySelector("[data-error]");

    box.querySelectorAll("[data-bulk-disc-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.bulkDiscType;
        typeInput.value = next;
        box.querySelectorAll("[data-bulk-disc-type]").forEach((b) => b.classList.toggle("is-active", b === btn));
        prefixEl.hidden = next !== "fixed";
        suffixEl.hidden = next !== "percentage";
        valueInput.placeholder = next === "percentage" ? "e.g. 20" : "e.g. 100.00";
        hintEl.textContent = next === "percentage"
          ? "Must be less than 100%."
          : "Must be less than each product's own price — anything it doesn't fit is skipped.";
        if (next === "percentage") valueInput.setAttribute("max", "99");
        else valueInput.removeAttribute("max");
      });
    });

    box.querySelector("#bulkDiscForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const submitBtn = box.querySelector("#bulkDiscSubmit");
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="spinner"></span>`;

      const payload = {
        discount_type: typeInput.value,
        discount_value: valueInput.value,
        discount_starts_at: datetimeLocalToIso(box.querySelector("#bulkDiscStart").value),
        discount_ends_at: datetimeLocalToIso(box.querySelector("#bulkDiscEnd").value),
      };

      const results = await Promise.allSettled(ids.map((id) => api.patch(`/seller/products/${id}/discount`, payload)));
      const okCount = results.filter((r) => r.status === "fulfilled").length;
      const failCount = results.length - okCount;

      if (okCount) {
        toast(
          failCount
            ? `Sale applied to ${okCount} of ${results.length} products — ${failCount} skipped (didn't fit this discount).`
            : `Sale is live on ${okCount} product${okCount === 1 ? "" : "s"}.`,
          failCount ? "info" : "success",
        );
        closeModal();
        load();
      } else {
        errorBox.textContent = results[0]?.reason?.message || "Couldn't apply this discount to any of the selected products.";
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = `Apply to ${ids.length} product${ids.length === 1 ? "" : "s"}`;
      }
    });
  }, { wide: true });
}

/**
 * Renders the Price column for the table/grid: plain price normally, or
 * (when the product has a currently-live discount) the sale price with
 * the original struck through underneath and a "-X%" chip — matching
 * discount.is_live from ProductResource, which already accounts for the
 * pause toggle and start/end schedule, so this never needs to re-derive
 * that logic on the frontend.
 */
function priceCellHtml(p) {
  if (!p.discount?.is_live) return money(p.base_price);
  return `
    <span class="price-disc">
      <span class="price-disc-now">${money(p.price)}<span class="price-disc-pct">-${p.discount.percent_off}%</span></span>
      <span class="price-disc-orig">${money(p.base_price)}</span>
    </span>
  `;
}

/* Same tag glyph used inside the Discount tab's empty state (see
   renderDiscountTab) — reused here so the row/card icon and the modal it
   opens visually agree on what "sale" means. */
const SALE_TAG_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 12V8a2 2 0 0 0-2-2h-4l-6 6 6.5 6.5 6-6a2 2 0 0 0 .5-1Z"/><circle cx="14.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/></svg>`;

/** The whole reason a discount felt "hidden" before this: it only ever
 * showed up once you'd already opened Manage and clicked over to its own
 * tab. This renders a small standalone labeled button next to Manage/Archive
 * on every row/card — a text label rather than a bare icon, so it reads as
 * an action ("Sale") instead of disappearing into the row — that also
 * doubles as a status light via color:
 *   - plain/outline -> no discount at all yet
 *   - gold          -> a discount exists but isn't showing to buyers right
 *                      now (scheduled for later, or paused)
 *   - chili/danger  -> a discount is live this instant
 * Clicking it jumps straight into the manage modal's Discount tab. */
function saleBtnHtml(p) {
  const d = p.discount;
  let cls = "btn btn-sm sale-tag-btn";
  let title = "Start a sale";
  if (d?.is_live) {
    cls += " is-live";
    title = "Sale is live — tap to manage";
  } else if (d) {
    cls += " is-scheduled";
    title = "Sale set up but not showing to buyers right now — tap to manage";
  }
  // Label stays the fixed word "Sale" in every state — only the color
  // changes (plain gold / scheduled gold-filled / live chili-filled).
  // A status-dependent label ("Scheduled", "On sale") used to make the
  // button a different width on every card depending on how long the
  // word was, which read as visually inconsistent across the grid even
  // though the buttons were technically all the same width.
  return `<button type="button" class="${cls}" data-sale="${p.id}" title="${escapeHtml(title)}">${SALE_TAG_ICON}Sale</button>`;
}

function stockBadge(stock) {
  if (stock <= 0) return `<span class="badge badge-out_of_stock">out of stock</span>`;
  if (stock <= 5) return `<span class="badge badge-low_stock">low stock</span>`;
  return `<span class="badge badge-in_stock">in stock</span>`;
}

// No admin approval step — a listing is either archived, a private draft
// (still being put together, or explicitly saved for later), or live.
// Rendered as a plain dot + label (no pill) so it reads visually
// distinct from the Stock column's pill badge right next to it,
// instead of two same-shaped chips blurring together.
function statusBadge(p) {
  if (p.is_archived) return `<span class="status-dot status-dot-archived">archived</span>`;
  if (!p.is_published) return `<span class="status-dot status-dot-pending">draft</span>`;
  return `<span class="status-dot status-dot-active">live</span>`;
}

/** A red "-20% sale" chip shown right alongside the live/draft/archived
 * status dot, reusing the same badge language already used for it (and
 * for the Discount tab's own status chip) — so a discounted product reads
 * as unmistakably on sale while scanning the list, not just from the
 * Sale button in the actions column. Only shown once a discount is
 * actually live (i.e. buyers are seeing the lower price right now). */
function discountBadgeHtml(p) {
  if (!p.discount?.is_live) return "";
  return `<span class="badge badge-on_sale">-${p.discount.percent_off}% sale</span>`;
}

function renderTable(items) {
  const tbody = document.getElementById("tbody");
  productLookup = new Map(items.map((p) => [String(p.id), p]));
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No products match these filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = items
    .map((p) => {
      const thumb = p.images?.[0]?.url;
      return `
      <tr>
        <td class="cell-check"><input type="checkbox" data-row-check="${p.id}" ${selected.has(String(p.id)) ? "checked" : ""}></td>
        <td>
          <div class="cell-product">
            <div class="cell-thumb">
              ${thumb
                ? `<img src="${thumb}" alt="">`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/></svg>`}
            </div>
            <div>
              <div class="cell-name">${escapeHtml(p.name)}</div>
              <div class="cell-sub">${escapeHtml(p.category?.name || "Uncategorized")}</div>
            </div>
          </div>
        </td>
        <td class="mono" data-label="Price">${priceCellHtml(p)}</td>
        <td data-label="Stock">
          <span class="stock-cell" data-stock-cell="${p.id}">
            <button type="button" class="stock-edit-trigger" data-stock-edit="${p.id}" data-stock-value="${p.stock ?? 0}" title="Click to edit stock">
              <b>${p.stock ?? 0}</b>
            </button>
            ${stockBadge(p.stock ?? 0)}
          </span>
        </td>
        <td data-label="Status">
          ${statusBadge(p)}
          ${discountBadgeHtml(p)}
          ${state.flagged ? `<span class="badge badge-flagged">flagged</span>` : ""}
        </td>
        <td class="cell-actions-cell">
          <div class="cell-actions">
            ${p.is_archived ? "" : saleBtnHtml(p)}
            <button class="btn btn-sm btn-outline" data-manage="${p.id}">Manage</button>
            ${p.is_archived
              ? `<button class="btn btn-sm btn-outline" data-restore="${p.id}">Restore</button>
                 <button class="btn btn-sm btn-danger" data-force-delete="${p.id}" title="Permanently delete">Delete</button>`
              : `<button class="btn btn-sm btn-caution" data-archive="${p.id}">Archive</button>`}
          </div>
        </td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-row-check]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(cb.dataset.rowCheck); else selected.delete(cb.dataset.rowCheck);
      document.getElementById("selectAllCheck").checked = selected.size === items.length;
      renderBulkBar();
    });
  });
  tbody.querySelectorAll("[data-sale]").forEach((b) => b.addEventListener("click", () => openManageModal(b.dataset.sale, { tab: "discount" })));
  tbody.querySelectorAll("[data-manage]").forEach((b) => b.addEventListener("click", () => openManageModal(b.dataset.manage)));
  tbody.querySelectorAll("[data-archive]").forEach((b) => b.addEventListener("click", () => archiveProduct(b.dataset.archive)));
  tbody.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", () => restoreProduct(b.dataset.restore)));
  tbody.querySelectorAll("[data-force-delete]").forEach((b) => b.addEventListener("click", () => forceDeleteProduct(b.dataset.forceDelete)));
  tbody.querySelectorAll("[data-stock-edit]").forEach((b) => b.addEventListener("click", () => startStockEdit(b.dataset.stockEdit, b.dataset.stockValue)));
}

/** Photo-forward alternative to the table — same data, same row actions
 * and bulk-select behavior, just laid out as cards. Lives alongside
 * renderTable() rather than replacing it since a dense operational table
 * is still the faster view once a seller has a big catalog memorized. */
function renderGrid(items) {
  const grid = document.getElementById("productGrid");
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state">No products match these filters.</div>`;
    return;
  }
  grid.innerHTML = items
    .map((p) => {
      const thumb = p.images?.[0]?.url;
      return `
      <div class="product-card">
        <div class="product-card-thumb">
          <input type="checkbox" class="product-card-check" data-row-check="${p.id}">
          ${thumb
            ? `<img src="${thumb}" alt="">`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/></svg>`}
        </div>
        <div class="product-card-body">
          <div class="cell-name">${escapeHtml(p.name)}</div>
          <div class="cell-sub">${escapeHtml(p.category?.name || "Uncategorized")}</div>
          <div class="product-card-meta">
            <span class="mono">${priceCellHtml(p)}</span>
            <span class="stock-cell" data-stock-cell="${p.id}">
              <button type="button" class="stock-edit-trigger" data-stock-edit="${p.id}" data-stock-value="${p.stock ?? 0}" title="Click to edit stock">
                <b>${p.stock ?? 0}</b>
              </button>
              ${stockBadge(p.stock ?? 0)}
            </span>
          </div>
          <div class="product-card-status">
            ${statusBadge(p)}
            ${discountBadgeHtml(p)}
            ${state.flagged ? `<span class="badge badge-flagged">flagged</span>` : ""}
          </div>
          <div class="product-card-actions">
            ${p.is_archived ? "" : saleBtnHtml(p)}
            <button class="btn btn-sm btn-outline" data-manage="${p.id}">Manage</button>
            ${p.is_archived
              ? `<button class="btn btn-sm btn-outline" data-restore="${p.id}">Restore</button>
                 <button class="btn btn-sm btn-danger" data-force-delete="${p.id}" title="Permanently delete">Delete</button>`
              : `<button class="btn btn-sm btn-caution" data-archive="${p.id}">Archive</button>`}
          </div>
        </div>
      </div>`;
    })
    .join("");

  grid.querySelectorAll("[data-row-check]").forEach((cb) => {
    cb.checked = selected.has(String(cb.dataset.rowCheck));
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(cb.dataset.rowCheck); else selected.delete(cb.dataset.rowCheck);
      document.getElementById("selectAllCheck").checked = selected.size === items.length;
      renderBulkBar();
    });
  });
  grid.querySelectorAll("[data-sale]").forEach((b) => b.addEventListener("click", () => openManageModal(b.dataset.sale, { tab: "discount" })));
  grid.querySelectorAll("[data-manage]").forEach((b) => b.addEventListener("click", () => openManageModal(b.dataset.manage)));
  grid.querySelectorAll("[data-archive]").forEach((b) => b.addEventListener("click", () => archiveProduct(b.dataset.archive)));
  grid.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", () => restoreProduct(b.dataset.restore)));
  grid.querySelectorAll("[data-force-delete]").forEach((b) => b.addEventListener("click", () => forceDeleteProduct(b.dataset.forceDelete)));
  grid.querySelectorAll("[data-stock-edit]").forEach((b) => b.addEventListener("click", () => startStockEdit(b.dataset.stockEdit, b.dataset.stockValue)));
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

/** Inline stock quick-edit: swaps the stock number for a small number
 * input right in the table row, so bumping stock after a restock doesn't
 * require opening the full Manage modal. Saves on blur or Enter, cancels
 * on Escape, and reverts on any API failure. */
function startStockEdit(id, currentValue) {
  const cell = document.querySelector(`[data-stock-cell="${id}"]`);
  if (!cell || cell.querySelector("input")) return;
  const trigger = cell.querySelector("[data-stock-edit]");
  const badge = cell.querySelector(".badge");
  trigger.hidden = true;
  if (badge) badge.hidden = true;

  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.className = "stock-edit-input";
  input.value = currentValue;
  cell.appendChild(input);
  input.focus();
  input.select();

  let settled = false;
  const revert = () => {
    if (settled) return;
    settled = true;
    input.remove();
    trigger.hidden = false;
    if (badge) badge.hidden = false;
  };
  const save = async () => {
    if (settled) return;
    const next = Math.max(0, Math.round(Number(input.value)));
    if (!Number.isFinite(next) || String(next) === String(currentValue)) { revert(); return; }
    settled = true;
    input.disabled = true;
    try {
      await api.patch(`/seller/products/${id}`, { stock: next });
      toast("Stock updated.", "success");
      load();
    } catch (err) {
      toast(err.message || "Couldn't update stock — try Manage instead.", "error");
      input.remove();
      trigger.hidden = false;
      if (badge) badge.hidden = false;
    }
  };
  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { settled = true; revert(); }
  });
}

function archiveProduct(id) {
  confirmSimple({
    title: "Archive this product?",
    description: "It'll disappear from your storefront but stays on past orders. You can restore it anytime.",
    confirmLabel: "Archive",
    tone: "danger",
    onConfirm: async () => {
      await api.delete(`/seller/products/${id}`);
      toast("Product archived.", "success");
      load();
    },
  });
}

function restoreProduct(id) {
  api.post(`/seller/products/${id}/restore`)
    .then(() => { toast("Product restored.", "success"); load(); })
    .catch((err) => toast(err.message || "Failed to restore product.", "error"));
}

/* Only ever offered for products that are already archived — this is the
   "actually gone" option beyond that, so the confirmation is deliberately
   more serious than the archive one. The backend still has the final say:
   a product that's ever been ordered can't be force-deleted no matter what
   happens here (its order history depends on it), and comes back as a
   plain error message instead. */
function forceDeleteProduct(id) {
  confirmSimple({
    title: "Permanently delete this product?",
    description: "This can't be undone — the listing, its photos, and its options are gone for good. (Products with any order history can't be deleted this way — they stay archived instead.)",
    confirmLabel: "Delete permanently",
    tone: "danger",
    onConfirm: async () => {
      await api.delete(`/seller/products/${id}/force`);
      toast("Product permanently deleted.", "success");
      load();
    },
  });
}

/* ---------------- add product wizard ----------------
   A guided, four-step flow (Details → Photos → Variations → Review) that
   stays in one modal the whole way through, with a live "what buyers will
   see" preview alongside the form at every step. Photos and variations
   still need a real product id from the backend, so Details is submitted
   first to create the product — everything after that just keeps editing
   the same record in place. */
const WIZARD_STEPS = [
  { key: "details", label: "Details" },
  { key: "images", label: "Photos" },
  { key: "variations", label: "Options" },
  { key: "review", label: "Review" },
];

function openAddWizard() {
  const draft = { name: "", category_id: "", base_price: "", description: "" };
  let product = null; // set once Details is saved and the product exists (as a draft — see below)
  let step = "details";
  let observer = null;
  const sellerName = getUser()?.seller?.business_name;

  render();

  // The wizard is opened as a "persistent" modal (see ui.js) so an
  // accidental click on the backdrop, or an Escape tap, can't silently
  // throw away a half-typed listing. Every exit point instead goes through
  // this one function, which only confirms when there's something that
  // would actually be lost: before Details is saved nothing exists on the
  // server yet, so a stray click could otherwise wipe out typed text with
  // no way back.
  function requestClose() {
    confirmLeaveDirtyCombos(() => {
      const hasUnsavedTyping = !product && Object.values(draft).some((v) => (v || "").toString().trim());
      if (!hasUnsavedTyping) { forceCloseModal(); load(); return; }
      confirmSimple({
        title: "Discard this new listing?",
        description: "You haven't saved anything yet — closing now won't keep what you've typed.",
        confirmLabel: "Discard",
        tone: "danger",
        onConfirm: async () => { forceCloseModal(); load(); },
      });
    });
  }

  function render() {
    if (observer) { observer.disconnect(); observer = null; }
    const stepIndex = WIZARD_STEPS.findIndex((s) => s.key === step);

    openModal((box) => {
      box.innerHTML = `
        <div class="modal-header">
          <div>
            <h3>Add a product</h3>
            <p>${wizardHintText(step)}</p>
          </div>
          <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
        </div>
        <div class="wizard-steps">
          ${WIZARD_STEPS.map((s, i) => wizardStepButtonHtml(s, i, stepIndex, !!product)).join("")}
        </div>
        <div class="modal-body wizard-layout">
          <div class="wizard-main" id="wizardMain"></div>
          <aside class="wizard-preview">
            <div class="wizard-preview-head">
              <span class="wizard-preview-eyebrow">Buyer preview</span>
              <span class="wizard-preview-note">Draft</span>
            </div>
            <div id="wizardPreviewMock"></div>
          </aside>
        </div>
        <div class="modal-footer" id="wizardFooter"></div>
      `;
      box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", requestClose));
      box.querySelectorAll("[data-goto-step]").forEach((b) => {
        b.addEventListener("click", () => {
          if (b.disabled) return;
          const target = b.dataset.gotoStep;
          if (step === "variations" && target !== "variations") {
            confirmLeaveDirtyCombos(() => { step = target; render(); });
          } else {
            step = target;
            render();
          }
        });
      });

      const main = box.querySelector("#wizardMain");
      const footer = box.querySelector("#wizardFooter");

      if (step === "details") renderDetailsStep(main, footer, box);
      else if (step === "images") {
        renderImagesTab(main, product);
        wireWizardNav(footer, "images");
        observer = watchForPreviewChanges(main, box, footer, "images");
      } else if (step === "variations") {
        renderOptionsTab(main, product);
        wireWizardNav(footer, "variations");
        observer = watchForPreviewChanges(main, box, footer, "variations");
      } else {
        renderReviewStep(main, footer, box);
      }

      refreshPreview(box);
    }, { xwide: true, persistent: true });
  }

  // Photos/Options get added and removed via their own tab UI (uploads,
  // "+ value" forms, etc.) without going through render() again, so the
  // footer's Back/Next button never used to hear about it — leaving a
  // stale "Skip photos for now" up even after a photo had clearly been
  // added. Watching the tab body for any DOM change and re-deriving the
  // nav label from it keeps the button honest.
  function watchForPreviewChanges(main, box, footer, key) {
    const obs = new MutationObserver(() => {
      refreshPreview(box);
      if (footer) updateWizardNavLabel(footer, key);
    });
    obs.observe(main, { childList: true, subtree: true });
    return obs;
  }

  function refreshPreview(box) {
    const mock = box.querySelector("#wizardPreviewMock");
    if (!mock) return;
    const previewSubject = product || draft;
    mock.innerHTML = buyerMockHtml(previewSubject, sellerName);
    wireBuyerMockInteractivity(mock, previewSubject);
  }

  function renderDetailsStep(main, footer, box) {
    main.innerHTML = `
      <div class="wizard-hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <span>This is saved as a draft as you go — it stays hidden from buyers until you finish the Review step and publish it.</span>
      </div>
      <form id="wizardDetailsForm">
        ${productFieldsHtml(draft)}
        <div class="field-error" data-error hidden></div>
      </form>
    `;
    footer.innerHTML = `
      <button type="button" class="btn btn-outline" data-close>Cancel</button>
      <button type="submit" form="wizardDetailsForm" class="btn btn-primary" id="wizardDetailsSubmit">Continue</button>
    `;

    const form = main.querySelector("#wizardDetailsForm");
    const errorBox = main.querySelector("[data-error]");

    form.addEventListener("input", () => {
      Object.assign(draft, readProductFields(form));
      refreshPreview(box);
    });
    form.addEventListener("change", () => {
      Object.assign(draft, readProductFields(form));
      refreshPreview(box);
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const payload = readProductFields(form);
      const submitBtn = document.getElementById("wizardDetailsSubmit");
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="spinner"></span>`;
      try {
        // Creates the record as a draft — the backend forces is_published
        // to false on every new product regardless of what's sent here, so
        // photos/options have a real id to attach to while it stays out of
        // the buyer-facing catalog. It only goes live once the seller hits
        // "Publish listing" on the Review step; no admin approval involved.
        const { product: created } = await api.post("/seller/products", payload);
        product = created;
        toast("Draft saved — now add some photos.", "success");
        step = "images";
        render();
      } catch (err) {
        errorBox.textContent = err.message || "Couldn't create this product.";
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = "Continue";
      }
    });
  }

  // "Skip" only ever makes sense when the step is genuinely still empty —
  // once there's a photo (or an option value) sitting there, moving on is
  // just "Continue", not "Skip".
  function wizardNavLabel(key) {
    const isImages = key === "images";
    const count = isImages ? (product.images || []).length : (product.variations || []).length;
    return isImages
      ? (count ? "Continue" : "Skip photos for now")
      : (count ? "Review & submit" : "Skip options — review");
  }

  function updateWizardNavLabel(footer, key) {
    const btn = footer.querySelector("#wizardNext");
    if (btn) btn.textContent = wizardNavLabel(key);
  }

  function wireWizardNav(footer, key) {
    const isImages = key === "images";
    footer.innerHTML = `
      <button type="button" class="btn btn-outline" id="wizardBack">Back</button>
      <button type="button" class="btn btn-primary" id="wizardNext">${wizardNavLabel(key)}</button>
    `;
    footer.querySelector("#wizardBack").addEventListener("click", () => {
      const target = isImages ? "details" : "images";
      if (!isImages) { confirmLeaveDirtyCombos(() => { step = target; render(); }); return; }
      step = target;
      render();
    });
    footer.querySelector("#wizardNext").addEventListener("click", () => {
      const target = isImages ? "variations" : "review";
      if (!isImages) { confirmLeaveDirtyCombos(() => { step = target; render(); }); return; }
      step = target;
      render();
    });
  }

  function renderReviewStep(main, footer, box) {
    const photoCount = (product.images || []).length;
    const variationCount = (product.variations || []).length;
    const hasStock = product.options?.length
      ? variationCount > 0 && (product.variations || []).some((v) => (v.stock || 0) > 0)
      : (product.stock || 0) > 0;

    // Minimum bar for going live — catches the most common "published by
    // accident, still basically empty" cases without being so strict it
    // blocks reasonable partial listings (options are optional; a photo
    // and some stock aren't).
    const checks = [
      { done: true, label: `${escapeHtml(product.name)} — name, category, and price are set` },
      { done: photoCount > 0, label: photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? "" : "s"} added` : "Add at least one photo" },
      { done: hasStock, label: hasStock ? "Stock is set" : "Set stock above 0 somewhere before publishing" },
    ];
    const readyToPublish = checks.every((c) => c.done);

    main.innerHTML = `
      <div class="wizard-hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <span>This listing is still a private draft. Publishing makes it visible in your storefront right away — no approval wait.</span>
      </div>
      <h4 style="font-family:'Petrona',serif; font-size:16px; margin-bottom:2px;">${escapeHtml(product.name)}</h4>
      <p class="text-muted" style="font-size:12.5px;">${escapeHtml(product.category?.name || "Uncategorized")} · ${money(product.base_price)}</p>
      <ul class="wizard-review-list">
        ${checks.map((c) => `<li style="${c.done ? "" : "opacity:.7;"}">${escapeHtml(c.label)}</li>`).join("")}
        <li>${variationCount} combination${variationCount === 1 ? "" : "s"} across ${(product.options || []).length} option group${(product.options || []).length === 1 ? "" : "s"}</li>
      </ul>
      ${!readyToPublish ? `<div class="field-error" style="display:block;">Finish the item${checks.filter((c) => !c.done).length === 1 ? "" : "s"} above before publishing.</div>` : ""}
    `;
    footer.innerHTML = `
      <button type="button" class="btn btn-outline" id="wizardBackReview">Back</button>
      <button type="button" class="btn btn-outline" id="wizardSaveExit">Save draft, finish later</button>
      <button type="button" class="btn btn-primary" id="wizardPublish" ${readyToPublish ? "" : "disabled"}>Publish listing</button>
    `;
    footer.querySelector("#wizardBackReview").addEventListener("click", () => { step = "variations"; render(); });
    footer.querySelector("#wizardSaveExit").addEventListener("click", () => {
      forceCloseModal();
      load();
      toast("Saved as a draft — find it under Products whenever you're ready to finish it.", "success");
    });
    footer.querySelector("#wizardPublish").addEventListener("click", async () => {
      const btn = footer.querySelector("#wizardPublish");
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>`;
      try {
        await publishProduct(product.id);
        forceCloseModal();
        load();
        toast("Published — it's live in your storefront now.", "success");
      } catch (err) {
        toast(err.message || "Couldn't publish this listing.", "error");
        btn.disabled = false;
        btn.textContent = "Publish listing";
      }
    });
  }
}

/* Makes a draft listing live immediately — the seller's own call, no
 * admin approval step. Shared by the wizard's final step and the manage
 * modal's "still a draft" banner so there's one place that knows the
 * endpoint name. */
async function publishProduct(id) {
  const { product } = await api.post(`/seller/products/${id}/publish`);
  return product;
}

function wizardHintText(step) {
  switch (step) {
    case "details": return "Start with the basics — the preview on the right updates as you type.";
    case "images": return "Add a few clear photos. The first one becomes your cover image.";
    case "variations": return "Optional — add option groups like Style or Size if this product has them.";
    default: return "Take a last look, then publish — it goes live in your storefront right away.";
  }
}

function wizardStepButtonHtml(s, i, currentIndex, hasProduct) {
  const isActive = i === currentIndex;
  const isDone = i < currentIndex;
  const disabled = i > 0 && !hasProduct; // everything past Details needs a real product id
  const connector = i > 0 ? `<span class="wizard-step-connector"></span>` : "";
  return `${connector}<button type="button" class="wizard-step${isActive ? " is-active" : ""}${isDone ? " is-done" : ""}" data-goto-step="${s.key}" ${disabled ? "disabled" : ""} title="${disabled ? "Save details first" : s.label}">
    <span class="wizard-step-num">${isDone ? "✓" : i + 1}</span>
    <span class="wizard-step-label">${s.label}</span>
  </button>`;
}

/* Compact "what a buyer sees" card, shared by the add-product wizard and
   the manage modal's Preview tab. Works with either a full product record
   or the client-side draft used before the product has been saved.

   The option pills and photo thumbs are real buttons: tapping a pill
   swaps in that combination's own photo (falling back to the cover shot),
   price, and stock — mirroring the real storefront's variation picker
   (see buyer-catalog.js's quick-view) — via wireBuyerMockInteractivity
   below, called right after this HTML is inserted into the page. The
   "Add to cart" button stays permanently disabled; this is a preview,
   not a real cart flow. */
function buyerMockHtml(p, sellerName) {
  const images = Array.isArray(p.images) ? p.images : [];
  const cover = images[0];
  const options = Array.isArray(p.options) ? p.options : [];
  const hasVariations = options.length > 0;
  // Flat stock only applies when there are no option groups — once
  // combinations exist, stock lives per-combination (see
  // wireBuyerMockInteractivity, which overwrites this once it runs).
  const stock = Number(p.stock ?? 0);
  const stockInfo = stock <= 0 ? { cls: "out", label: "Out of stock" } : stock <= 5 ? { cls: "low", label: `Only ${stock} left` } : null;

  if (!p.name && !p.base_price) {
    return `
      <div class="bm-card">
        <div class="bm-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/></svg>
          Fill in the name and price to see how this will look to buyers.
        </div>
      </div>
    `;
  }

  return `
    <div class="bm-card">
      <div class="bm-gallery">
        ${cover ? `<img src="${cover.url}" alt="">` : `<div class="bm-noimg">${escapeHtml((p.name || "?").slice(0, 1).toUpperCase())}</div>`}
      </div>
      ${images.length > 1 ? `
        <div class="bm-thumbs">
          ${images.slice(0, 6).map((img, i) => `<button type="button" class="bm-thumb${i === 0 ? " is-active" : ""}" data-thumb-src="${img.url}"><img src="${img.url}" alt=""></button>`).join("")}
        </div>` : ""}
      <div class="bm-body">
        <div class="bm-seller">${escapeHtml(sellerName || "Your shop")}</div>
        <div class="bm-name">${escapeHtml(p.name || "Untitled product")}</div>
        <div class="bm-price">${p.base_price ? money(p.base_price) : "₱0.00"}</div>
        ${!hasVariations ? (stockInfo ? `<span class="bm-stock is-${stockInfo.cls}">${stockInfo.label}</span>` : `<span class="bm-stock">In stock</span>`) : `<span class="bm-stock"></span>`}
        <p class="bm-desc">${escapeHtml(p.description || "No description yet — buyers will just see a blank space here.")}</p>
        ${hasVariations ? `
          <div class="bm-variations">
            ${options.map((opt) => `
              <div class="bm-vgroup" data-option-id="${opt.id}">
                <div class="bm-vlabel">${escapeHtml(opt.name)}</div>
                <div class="bm-voptions">
                  ${(opt.values || []).map((v) => `<button type="button" class="bm-pill" data-value-id="${v.id}">${escapeHtml(v.value)}</button>`).join("")}
                </div>
              </div>`).join("")}
          </div>` : ""}
        <button type="button" class="bm-cta" disabled>Add to cart</button>
      </div>
    </div>
  `;
}

/* Picks a starting combination the same courtesy the real buyer picker
   gives (see buyer-catalog.js's renderQuickView): first value of every
   group, but walked forward to an in-stock combo if that naive pick
   happens to be sold out, so the preview doesn't open on "out of stock"
   by default when a buyer wouldn't actually land there. */
function defaultBuyerMockSelection(options, variations) {
  const selection = {};
  options.forEach((opt) => { selection[opt.id] = (opt.values || [])[0]?.id ?? null; });
  if (options.length && (buyerMockVariationFor(selection, options, variations)?.stock ?? 0) <= 0) {
    const group2Values = options[1] ? options[1].values || [] : [null];
    outer:
    for (const v1 of options[0].values || []) {
      for (const v2 of group2Values) {
        const trial = { ...selection, [options[0].id]: v1.id };
        if (options[1]) trial[options[1].id] = v2.id;
        const match = buyerMockVariationFor(trial, options, variations);
        if (match && match.stock > 0) { Object.assign(selection, trial); break outer; }
      }
    }
  }
  return selection;
}

function buyerMockVariationFor(sel, options, variations) {
  if (!options.length) return null;
  const v1 = sel[options[0].id];
  const v2 = options[1] ? sel[options[1].id] : null;
  return variations.find((v) => v.option_value_1_id === v1 && (options[1] ? v.option_value_2_id === v2 : v.option_value_2_id == null)) || null;
}

/* Wires up the touch/tap interactivity on an already-inserted buyerMockHtml
   card: tapping an option pill or a photo thumb swaps the preview's photo,
   price, and stock to match — same as tapping a pill on the real storefront
   — entirely client-side against data already loaded for this product.
   Deliberately does NOT touch the "Add to cart" button; it stays disabled,
   this is a look-only preview. Safe to call on every re-render (a fresh
   `container` each time) — no state to leak between calls. */
function wireBuyerMockInteractivity(container, product) {
  const card = container.querySelector(".bm-card");
  if (!card) return;

  const images = Array.isArray(product.images) ? product.images : [];
  const cover = images[0];

  // Photo thumbs: always swappable, even for a product with no options.
  card.querySelectorAll(".bm-thumb").forEach((thumb) => {
    thumb.addEventListener("click", () => {
      const src = thumb.dataset.thumbSrc;
      card.querySelectorAll(".bm-thumb").forEach((t) => t.classList.toggle("is-active", t === thumb));
      const gallery = card.querySelector(".bm-gallery");
      if (gallery) gallery.innerHTML = `<img src="${src}" alt="">`;
    });
  });

  const options = Array.isArray(product.options) ? product.options : [];
  if (!options.length) return; // nothing to swap between beyond photos

  const variations = Array.isArray(product.variations) ? product.variations : [];
  const selection = defaultBuyerMockSelection(options, variations);

  function valueIsAvailable(opt, valueId) {
    const trial = { ...selection, [opt.id]: valueId };
    const match = buyerMockVariationFor(trial, options, variations);
    return !match || match.stock > 0;
  }

  function refresh() {
    const current = buyerMockVariationFor(selection, options, variations);

    card.querySelectorAll(".bm-vgroup").forEach((group) => {
      const optId = Number(group.dataset.optionId);
      const opt = options.find((o) => o.id === optId);
      if (!opt) return;
      group.querySelectorAll(".bm-pill").forEach((pill) => {
        const valueId = Number(pill.dataset.valueId);
        pill.classList.toggle("is-selected", selection[optId] === valueId);
        pill.classList.toggle("is-unavailable", !valueIsAvailable(opt, valueId));
      });
    });

    const imgUrl = current?.image?.url || cover?.url;
    const gallery = card.querySelector(".bm-gallery");
    if (gallery) {
      gallery.innerHTML = imgUrl
        ? `<img src="${imgUrl}" alt="">`
        : `<div class="bm-noimg">${escapeHtml((product.name || "?").slice(0, 1).toUpperCase())}</div>`;
    }
    card.querySelectorAll(".bm-thumb").forEach((t) => t.classList.toggle("is-active", t.dataset.thumbSrc === imgUrl));

    const priceEl = card.querySelector(".bm-price");
    if (priceEl) {
      const price = current ? Number(product.base_price || 0) + Number(current.price_adjustment || 0) : Number(product.base_price || 0);
      priceEl.textContent = money(price);
    }

    const stockEl = card.querySelector(".bm-stock");
    if (stockEl) {
      const stockNum = current ? Number(current.stock || 0) : 0;
      if (stockNum <= 0) { stockEl.textContent = "Out of stock"; stockEl.className = "bm-stock is-out"; }
      else if (stockNum <= 5) { stockEl.textContent = `Only ${stockNum} left`; stockEl.className = "bm-stock is-low"; }
      else { stockEl.textContent = "In stock"; stockEl.className = "bm-stock"; }
    }
  }

  card.querySelectorAll(".bm-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      if (pill.classList.contains("is-unavailable")) return;
      const optId = Number(pill.closest(".bm-vgroup")?.dataset.optionId);
      selection[optId] = Number(pill.dataset.valueId);
      refresh();
    });
  });

  refresh();
}

function productFieldsHtml(p = {}) {
  return `
    <div class="field-group">
      <label for="pf-name">Product name</label>
      <input type="text" id="pf-name" name="name" maxlength="150" required
        placeholder="e.g. Nike Air Max 270 – White/Black"
        value="${escapeHtml(p.name || "")}">
      <span class="hint">The title buyers see first — include the brand and model so it's easy to find.</span>
    </div>
    <div class="field-group">
      <label for="pf-category">Category</label>
      <select id="pf-category" name="category_id" required>${categoryOptionsHtml(p.category?.id)}</select>
      <span class="hint">Pick the closest match — this decides where buyers find it while browsing.</span>
    </div>
    <div class="field-group">
      <label for="pf-price">Price (₱)</label>
      <input type="number" id="pf-price" name="base_price" min="0" step="0.01" required
        placeholder="e.g. 1000.00" value="${p.base_price ?? ""}">
      <span class="hint">What buyers pay for the base version, before any option adjusts it. Stock isn't set here — you'll add that next, per option, once the product exists.</span>
    </div>
    <div class="field-group">
      <label for="pf-desc">Description <span class="field-optional">(optional)</span></label>
      <textarea id="pf-desc" name="description" maxlength="2000"
        placeholder="e.g. 100% cotton, true to size. Ships within 2 business days.">${escapeHtml(p.description || "")}</textarea>
      <span class="hint">Mention material, sizing, or care tips — buyers see this on the product page.</span>
    </div>
  `;
}

function readProductFields(form) {
  const data = new FormData(form);
  return {
    name: data.get("name")?.trim(),
    category_id: data.get("category_id"),
    base_price: data.get("base_price"),
    description: data.get("description")?.trim() || null,
  };
}

/* ---------------- manage modal (existing product): Details / Images / Variations ---------------- */
async function openManageModal(id, { tab = "details" } = {}) {
  openModal((box) => {
    box.innerHTML = `<div class="modal-body" style="padding-top:24px"><div class="empty-state">Loading product…</div></div>`;
  }, { wide: true });

  try {
    const { product } = await api.get(`/seller/products/${id}`);
    renderManageModal(product, tab);
  } catch (err) {
    toast(err.message || "Failed to load product.", "error");
    closeModal();
  }
}

/* ---- Draft banner shown across every tab of an existing product's
   manage modal. There's no admin-approval step — publishing is entirely
   the seller's own call — so this only ever needs to nudge a still-draft
   listing toward going live. Archived and already-published products get
   no banner at all. ---- */
function reviewLockBanner(product) {
  if (product.is_published || product.is_archived) return "";
  return `
    <div class="review-banner">
      ${svgIconInline('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>')}
      <div>
        <strong>Still a draft</strong>
        Not visible to buyers yet. Finish it up, then publish it from the Photos or Options tab's "Publish listing" step — or use the button below.
        <div class="review-banner-actions">
          <button type="button" class="btn btn-sm btn-primary" id="publishDraftBtn">Publish</button>
        </div>
      </div>
    </div>`;
}

function svgIconInline(path) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function renderManageModal(product, activeTab) {
  const TABS = [
    { key: "details", label: "Details" },
    { key: "discount", label: "Discount" },
    { key: "images", label: "Photos" },
    { key: "variations", label: "Options" },
    { key: "preview", label: "Preview" },
  ];
  const isLocked = false; // no admin-review step, so nothing about editing is ever locked

  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>${escapeHtml(product.name)}</h3>
          <p>${escapeHtml(product.category?.name || "Uncategorized")} · ${
            product.discount?.is_live
              ? `<span style="text-decoration:line-through; color:var(--ink-faint);">${money(product.base_price)}</span> ${money(product.price)} <span style="color:var(--danger); font-weight:700;">(-${product.discount.percent_off}%)</span>`
              : money(product.base_price)
          }${product.is_archived ? ` · <span style="color:var(--danger)">Archived</span>` : ""}</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-tabs">
        ${TABS.map((t) => `<button type="button" class="modal-tab${t.key === activeTab ? " is-active" : ""}" data-tab="${t.key}">${t.label}</button>`).join("")}
      </div>
      <div class="modal-body" style="padding-top:18px">
        ${reviewLockBanner(product)}
        <div id="tabBody"></div>
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => confirmLeaveDirtyCombos(closeModal)));
    box.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.tab === activeTab) return;
      confirmLeaveDirtyCombos(() => renderManageModal(product, b.dataset.tab));
    }));

    box.querySelector("#publishDraftBtn")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>`;
      try {
        const updated = await publishProduct(product.id);
        toast("Published — it's live in your storefront now.", "success");
        load();
        renderManageModal({ ...product, ...updated }, activeTab);
      } catch (err) {
        toast(err.message || "Couldn't publish this listing.", "error");
        btn.disabled = false;
        btn.textContent = "Publish";
      }
    });

    const tabBody = box.querySelector("#tabBody");
    if (activeTab === "details") renderDetailsTab(tabBody, product);
    else if (activeTab === "discount") renderDiscountTab(tabBody, product);
    else if (activeTab === "images") renderImagesTab(tabBody, product);
    else if (activeTab === "variations") renderOptionsTab(tabBody, product);
    else renderPreviewTab(tabBody, product);

    // No status currently locks editing (see isLocked above), but the
    // plumbing is left in place in case a future moderation state needs it.
    if (isLocked && activeTab !== "preview") {
      tabBody.querySelectorAll("input, select, textarea, button").forEach((el) => { el.disabled = true; });
      tabBody.style.opacity = "0.55";
      tabBody.style.pointerEvents = "none";
    }
  }, { wide: true });
}

/* ---- Details tab: same fields as create, saved via PUT ---- */
function renderDetailsTab(tabBody, product) {
  tabBody.innerHTML = `
    <form id="detailsForm">
      ${productFieldsHtml(product)}
      <div class="field-error" data-error hidden></div>
    </form>
    <div style="display:flex; justify-content:flex-end; margin-top:6px;">
      <button type="submit" form="detailsForm" class="btn btn-primary" id="detailsSubmit">Save changes</button>
    </div>
  `;
  const form = tabBody.querySelector("#detailsForm");
  const errorBox = tabBody.querySelector("[data-error]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const payload = readProductFields(form);
    const submitBtn = document.getElementById("detailsSubmit");
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner"></span>`;
    try {
      const { product: updated } = await api.put(`/seller/products/${product.id}`, payload);
      toast("Product updated.", "success");
      load();
      renderManageModal({ ...product, ...updated }, "details");
    } catch (err) {
      errorBox.textContent = err.message || "Couldn't save these changes.";
      errorBox.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Save changes";
    }
  });
}

/* ---- Discount tab: set/pause/resume/remove a product-level discount ----
   Modeled on Shopee's own "Product Discount" tool: a % or fixed-amount
   markdown on the price, optionally windowed to a start/end schedule for
   a flash-deal-style run. discount_type/value/starts_at/ends_at/is_active
   live on the product itself (see the products migration) and are read
   fresh everywhere a price is shown — nothing here "bakes in" a sale
   price, so removing or pausing a discount reverts prices instantly. */
const DISCOUNT_STATUS_META = {
  active: { cls: "on_sale", label: "On sale now" },
  scheduled: { cls: "scheduled", label: "Scheduled" },
  paused: { cls: "paused", label: "Paused" },
  expired: { cls: "expired", label: "Expired" },
};

/** datetime-local's value is naive local time — parsed as local by `new Date()`,
    then re-serialized to a real UTC instant so the backend's schedule check
    is correct regardless of what timezone the server itself runs in. */
function datetimeLocalToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The reverse, for pre-filling the form from an ISO string already on the product. */
function isoToDatetimeLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function discountSummaryHtml(product) {
  const d = product.discount;
  const meta = DISCOUNT_STATUS_META[d.status] || { cls: "paused", label: d.status };
  const schedule = [
    d.starts_at ? `from ${formatDateTime(d.starts_at)}` : null,
    d.ends_at ? `until ${formatDateTime(d.ends_at)}` : null,
  ].filter(Boolean).join(" ");
  const amount = d.type === "percentage" ? `${Number(d.value)}% off` : `${money(d.value)} off`;

  return `
    <div class="disc-summary">
      <div class="disc-summary-figs">
        <span class="badge badge-${meta.cls}">${meta.label}</span>
        <span class="disc-summary-price">${money(product.price)} <span class="disc-summary-orig">${money(product.base_price)}</span></span>
        <span class="disc-summary-meta">${amount}${schedule ? " · " + escapeHtml(schedule) : " · Ongoing — no end date"}</span>
      </div>
      <div class="disc-summary-actions">
        ${d.is_active
          ? `<button type="button" class="btn btn-sm btn-outline" id="discPauseBtn">Pause</button>`
          : `<button type="button" class="btn btn-sm btn-outline" id="discResumeBtn">Resume</button>`}
        <button type="button" class="btn btn-sm btn-caution" id="discRemoveBtn">Remove</button>
      </div>
    </div>
  `;
}

function renderDiscountTab(tabBody, product) {
  const d = product.discount;
  const type = d?.type || "percentage";

  tabBody.innerHTML = `
    <div class="disc-panel">
      <p class="disc-intro">Knock the price down by a percentage or a flat amount. Leave the dates blank to keep it running indefinitely, or set a window to run it like a timed flash deal — it switches on and off on its own, right on schedule.</p>

      ${d ? discountSummaryHtml(product) : `
        <div class="disc-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 12V8a2 2 0 0 0-2-2h-4l-6 6 6.5 6.5 6-6a2 2 0 0 0 .5-1Z"/><circle cx="14.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/></svg>
          <div><strong>No discount set up yet</strong></div>
          <span>Buyers will see this product at its regular price of ${money(product.base_price)} until you set one below.</span>
        </div>
      `}

      <form id="discForm">
        <div class="field-group">
          <label>Discount type</label>
          <div class="disc-type-toggle">
            <button type="button" class="disc-type-btn${type === "percentage" ? " is-active" : ""}" data-disc-type="percentage">Percentage off</button>
            <button type="button" class="disc-type-btn${type === "fixed" ? " is-active" : ""}" data-disc-type="fixed">Fixed amount off</button>
          </div>
          <input type="hidden" id="discType" value="${type}">
        </div>

        <div class="field-group">
          <label for="discValue">Discount value</label>
          <div class="disc-value-row">
            <span class="disc-value-suffix" id="discValuePrefix" ${type === "fixed" ? "" : "hidden"}>₱</span>
            <input type="number" id="discValue" min="0.01" step="0.01" required
              placeholder="${type === "percentage" ? "e.g. 20" : "e.g. 100.00"}"
              value="${d ? Number(d.value) : ""}">
            <span class="disc-value-suffix" id="discValueSuffix" ${type === "percentage" ? "" : "hidden"}>%</span>
          </div>
          <span class="disc-hint" id="discValueHint">${type === "percentage" ? "Must be less than 100%." : `Must be less than this product's lowest price (${money(product.base_price)}).`}</span>
        </div>

        <div class="field-group">
          <label>Schedule <span class="field-optional">(optional)</span></label>
          <div class="disc-schedule-grid">
            <div>
              <label for="discStart" class="disc-hint">Starts</label>
              <input type="datetime-local" id="discStart" value="${isoToDatetimeLocal(d?.starts_at)}">
            </div>
            <div>
              <label for="discEnd" class="disc-hint">Ends</label>
              <input type="datetime-local" id="discEnd" value="${isoToDatetimeLocal(d?.ends_at)}">
            </div>
          </div>
          <span class="disc-hint">Leave both blank for an ongoing discount. Set only an end date to run it "until" a certain time.</span>
        </div>

        <div class="field-error" data-error hidden></div>
        <div style="display:flex; justify-content:flex-end; margin-top:6px;">
          <button type="submit" class="btn btn-primary" id="discSubmit">${d ? "Save changes" : "Set discount"}</button>
        </div>
      </form>
    </div>
  `;

  const form = tabBody.querySelector("#discForm");
  const typeInput = tabBody.querySelector("#discType");
  const valueInput = tabBody.querySelector("#discValue");
  const prefixEl = tabBody.querySelector("#discValuePrefix");
  const suffixEl = tabBody.querySelector("#discValueSuffix");
  const hintEl = tabBody.querySelector("#discValueHint");
  const errorBox = tabBody.querySelector("[data-error]");

  tabBody.querySelectorAll("[data-disc-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.discType;
      typeInput.value = next;
      tabBody.querySelectorAll("[data-disc-type]").forEach((b) => b.classList.toggle("is-active", b === btn));
      prefixEl.hidden = next !== "fixed";
      suffixEl.hidden = next !== "percentage";
      valueInput.placeholder = next === "percentage" ? "e.g. 20" : "e.g. 100.00";
      hintEl.textContent = next === "percentage"
        ? "Must be less than 100%."
        : `Must be less than this product's lowest price (${money(product.base_price)}).`;
      if (next === "percentage") valueInput.setAttribute("max", "99");
      else valueInput.removeAttribute("max");
    });
  });

  if (type === "percentage") valueInput.setAttribute("max", "99");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const submitBtn = tabBody.querySelector("#discSubmit");
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="spinner"></span>`;
    try {
      const { product: updated } = await api.patch(`/seller/products/${product.id}/discount`, {
        discount_type: typeInput.value,
        discount_value: valueInput.value,
        discount_starts_at: datetimeLocalToIso(tabBody.querySelector("#discStart").value),
        discount_ends_at: datetimeLocalToIso(tabBody.querySelector("#discEnd").value),
      });
      toast(d ? "Discount updated." : "Discount is live.", "success");
      load();
      renderManageModal({ ...product, ...updated }, "discount");
    } catch (err) {
      errorBox.textContent = err.message || "Couldn't save this discount.";
      errorBox.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = d ? "Save changes" : "Set discount";
    }
  });

  tabBody.querySelector("#discPauseBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { product: updated } = await api.patch(`/seller/products/${product.id}/discount/pause`);
      toast("Discount paused — the product is back to its regular price.", "success");
      load();
      renderManageModal({ ...product, ...updated }, "discount");
    } catch (err) {
      toast(err.message || "Couldn't pause this discount.", "error");
      btn.disabled = false;
    }
  });

  tabBody.querySelector("#discResumeBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { product: updated } = await api.patch(`/seller/products/${product.id}/discount/resume`);
      toast("Discount resumed.", "success");
      load();
      renderManageModal({ ...product, ...updated }, "discount");
    } catch (err) {
      toast(err.message || "Couldn't resume this discount.", "error");
      btn.disabled = false;
    }
  });

  tabBody.querySelector("#discRemoveBtn")?.addEventListener("click", () => {
    confirmSimple({
      title: "Remove this discount?",
      description: "The product goes back to its regular price right away. You'll need to re-enter the numbers if you want to run a discount again later.",
      confirmLabel: "Remove discount",
      tone: "danger",
      onConfirm: async () => {
        const { product: updated } = await api.delete(`/seller/products/${product.id}/discount`);
        toast("Discount removed.", "success");
        load();
        renderManageModal({ ...product, ...updated }, "discount");
      },
    });
  });
}

/* ---- Preview tab: a read-only render of how the listing looks to a buyer,
   reusing the same buyer-mock renderer the add-product wizard shows live —
   kept here too so a seller checking back on an older listing can still see
   it without re-running the wizard. ---- */
function renderPreviewTab(tabBody, product) {
  const sellerName = getUser()?.seller?.business_name;
  tabBody.innerHTML = `
    <p class="text-muted" style="font-size:12.5px; margin-bottom:14px;">This is a preview only — tap a photo or option to see how it looks, but nothing here actually adds to a cart, and it doesn't reflect ratings or messages from real buyers.</p>
    <div style="max-width:320px; margin:0 auto;">${buyerMockHtml(product, sellerName)}</div>
  `;
  wireBuyerMockInteractivity(tabBody, product);
}

/* ---- Images tab: grid of existing photos + an upload tile ----
   The first photo (sort_order 0) is the "cover" — it's what shows as the
   catalog thumbnail and the fallback photo for any variant that doesn't
   have its own. Sellers can reorder photos with the ‹ › arrows to change
   which one is the cover.

   Each photo can also be tagged as one of the product's option values
   right here (e.g. link the black photo to "Color: Black") via the
   "+ Tag" chip under it — no need to switch to the Options tab and hunt
   for the right value. Freshly-uploaded photos prompt for this immediately,
   but only once at least one option value exists to tag it with. */
function renderImagesTab(tabBody, product) {
  const images = product.images || [];
  const values = flatOptionValues(product);
  const taggedByImage = values.reduce((acc, v) => {
    if (v.imageId) (acc[v.imageId] ||= []).push(v);
    return acc;
  }, {});

  tabBody.innerHTML = `
    <p class="text-muted" style="font-size:12.5px; margin-bottom:12px;">Photos are public — buyers see these on the storefront. The first photo is your cover image. JPG, PNG, or WEBP, up to 5MB each.</p>
    <div class="image-grid" id="imageGrid">
      ${images.map((img, i) => `
        <div class="image-cell">
          <div class="image-tile${i === 0 ? " is-cover" : ""}" data-image-tile="${img.id}">
            <img src="${img.url}" alt="">
            ${i === 0 ? `<span class="image-cover-badge">Cover</span>` : ""}
            ${i > 0 ? `<button type="button" class="image-move" data-move-image="${img.id}" data-dir="-1" title="Move earlier" aria-label="Move earlier">‹</button>` : ""}
            ${i < images.length - 1 ? `<button type="button" class="image-move" data-move-image="${img.id}" data-dir="1" title="Move later" aria-label="Move later">›</button>` : ""}
            <button type="button" class="image-remove" data-remove-image="${img.id}" aria-label="Remove photo">✕</button>
          </div>
          <div class="image-variant-tags">
            ${(taggedByImage[img.id] || []).map((v) => `<span class="image-variant-tag" title="${escapeHtml(v.optionName)}">${escapeHtml(v.value)}</span>`).join("")}
            ${values.length ? `<button type="button" class="image-add-variant" data-tag-variant="${img.id}">+ Tag</button>` : ""}
          </div>
        </div>`).join("")}
      <div class="image-cell">
        <label class="image-upload-tile">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add photo
          <input type="file" id="imageUploadInput" accept="image/png,image/jpeg,image/webp">
        </label>
      </div>
    </div>
    <div class="quick-variant-panel" id="quickVariantPanel" hidden></div>
  `;

  tabBody.querySelectorAll("[data-remove-image]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const imageId = btn.dataset.removeImage;
      btn.disabled = true;
      try {
        await api.delete(`/seller/products/${product.id}/images/${imageId}`);
        product.images = product.images.filter((i) => String(i.id) !== String(imageId));
        renderImagesTab(tabBody, product);
        load();
      } catch (err) {
        toast(err.message || "Failed to remove photo.", "error");
        btn.disabled = false;
      }
    });
  });

  tabBody.querySelectorAll("[data-move-image]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.moveImage;
      const dir = Number(btn.dataset.dir);
      const ids = product.images.map((i) => i.id);
      const idx = ids.findIndex((i) => String(i) === String(id));
      const swapWith = idx + dir;
      if (swapWith < 0 || swapWith >= ids.length) return;
      [ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]];

      tabBody.querySelectorAll("[data-move-image]").forEach((b) => (b.disabled = true));
      try {
        const { images: reordered } = await api.patch(`/seller/products/${product.id}/images/reorder`, { order: ids });
        product.images = reordered;
        renderImagesTab(tabBody, product);
      } catch (err) {
        toast(err.message || "Couldn't reorder photos.", "error");
        tabBody.querySelectorAll("[data-move-image]").forEach((b) => (b.disabled = false));
      }
    });
  });

  tabBody.querySelectorAll("[data-tag-variant]").forEach((btn) => {
    btn.addEventListener("click", () => openQuickTagPanel(tabBody, product, btn.dataset.tagVariant));
  });

  const uploadInput = tabBody.querySelector("#imageUploadInput");
  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);
    const tile = uploadInput.closest(".image-upload-tile");
    tile.style.opacity = "0.5";
    try {
      const { image } = await api.post(`/seller/products/${product.id}/images`, formData);
      product.images = [...(product.images || []), image];
      renderImagesTab(tabBody, product);
      load();
      // Straight into "tag this photo?" if there's already at least one
      // option value to tag it with — the whole point of adding a second,
      // third, etc. photo is usually to show a different option.
      if (values.length) openQuickTagPanel(tabBody, product, image.id, { freshUpload: true });
    } catch (err) {
      toast(err.message || "Failed to upload photo.", "error");
      tile.style.opacity = "1";
    }
  });
}

/* Flat list of every option value across every option group, prefixed with
   its group name (e.g. "Style: Only jersey") — used both for the Images
   tab's photo-tagging panel and anywhere else that needs "every choice a
   buyer could pick" without caring which group it came from. */
function flatOptionValues(product) {
  return (product.options || []).flatMap((opt) =>
    (opt.values || []).map((v) => ({
      id: v.id,
      optionId: opt.id,
      optionName: opt.name,
      value: v.value,
      label: `${opt.name}: ${v.value}`,
      imageId: v.image?.id ?? null,
      imageUrl: v.image?.url ?? null,
    }))
  );
}

/* Small panel that appears under the photo grid to link a photo to one of
   the product's existing option values (e.g. tap "+ Tag" under the black
   photo, pick "Color: Black") — sets that value's photo via the Options
   tab's own endpoint, no separate "variation" concept involved. */
function openQuickTagPanel(tabBody, product, imageId, { freshUpload = false } = {}) {
  const panel = tabBody.querySelector("#quickVariantPanel");
  const img = (product.images || []).find((i) => String(i.id) === String(imageId));
  const values = flatOptionValues(product);
  if (!panel || !img) return;

  panel.hidden = false;
  panel.innerHTML = `
    <div class="qvp-header">
      <img src="${img.url}" alt="" class="qvp-thumb">
      <p>${freshUpload ? "Tag this photo to an option value? (optional)" : "Which option value is this photo for?"}</p>
      <button type="button" class="btn btn-icon btn-sm" id="qvpDismiss" title="Dismiss" aria-label="Dismiss">✕</button>
    </div>
    <div class="photo-picker-row">
      ${values.map((v) => `<button type="button" class="photo-pick-chip" data-tag-value="${v.optionId}:${v.id}">${escapeHtml(v.label)}</button>`).join("")}
    </div>
    <div class="field-error" data-quick-variant-error hidden></div>
  `;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });

  const dismiss = () => { panel.hidden = true; panel.innerHTML = ""; };
  panel.querySelector("#qvpDismiss").addEventListener("click", dismiss);

  const errorBox = panel.querySelector("[data-quick-variant-error]");
  panel.querySelectorAll("[data-tag-value]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const [optionId, valueId] = btn.dataset.tagValue.split(":");
      btn.disabled = true;
      try {
        const { product: updated } = await api.put(
          `/seller/products/${product.id}/options/${optionId}/values/${valueId}`,
          { image_id: img.id }
        );
        Object.assign(product, updated);
        toast("Photo linked.", "success");
        renderImagesTab(tabBody, product);
      } catch (err) {
        errorBox.textContent = err.message || "Couldn't link this photo.";
        errorBox.hidden = false;
        btn.disabled = false;
      }
    });
  });
}

/* Small camera glyph used on each option-value chip's photo button — an
   icon reads as "tap to add a photo" far more clearly than a bare "+",
   which people skim right past sitting next to the delete "✕". */
const CAMERA_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="11" height="11"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/></svg>`;

/* ---- Options tab: Shopee-style option groups (e.g. "Style", "Size") ----
   Sellers manage the option groups and their values here; the actual
   buyable combinations (with their own price + stock) are generated and
   kept in sync automatically on the backend every time an option or value
   changes — nothing here creates a "variation" directly. A product with no
   option groups instead gets one flat stock number, editable at the bottom. */
function renderOptionsTab(tabBody, product) {
  const options = product.options || [];
  const variations = product.variations || [];
  const canAddOption = options.length < 2;

  tabBody.innerHTML = `
    <p class="text-muted" style="font-size:12.5px; margin-bottom:14px;">
      Add up to two option groups — like "Style" and "Size" — so buyers pick one value from each, the same way they would on Shopee. Every combination gets its own stock and price automatically below.
    </p>
    ${options.length ? `
      <p class="option-photo-hint">${CAMERA_ICON} Tap the little circle on a value (like "Jersey Only") to give it its own photo — buyers will see it swap in when they pick that value.</p>
    ` : ""}
    <div class="option-groups" id="optionGroups">
      ${options.map((o) => optionGroupHtml(o)).join("")}
    </div>
    ${canAddOption ? `
      <form id="addOptionForm" class="option-add-row">
        <input type="text" name="name" placeholder="${options.length ? "e.g. Size" : "e.g. Style"}" maxlength="50" required>
        <button type="submit" class="btn btn-sm btn-outline">+ Add option group</button>
      </form>
    ` : `<p class="variation-hint">You've reached the 2-option-group limit (matches how Shopee works too).</p>`}
    <div class="field-error" data-option-error hidden></div>

    <div id="comboSection"></div>
  `;

  wireOptionGroupActions(tabBody, product);

  const addOptionForm = tabBody.querySelector("#addOptionForm");
  const optionError = tabBody.querySelector("[data-option-error]");
  addOptionForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    optionError.hidden = true;
    const name = new FormData(addOptionForm).get("name")?.trim();
    const btn = addOptionForm.querySelector("button");
    btn.disabled = true;
    try {
      const { product: updated } = await api.post(`/seller/products/${product.id}/options`, { name });
      Object.assign(product, updated);
      renderOptionsTab(tabBody, product);
    } catch (err) {
      optionError.textContent = err.message || "Couldn't add that option group.";
      optionError.hidden = false;
      btn.disabled = false;
    }
  });

  renderComboSection(tabBody, product);
}

function optionGroupHtml(option) {
  return `
    <div class="option-group" data-option-group="${option.id}">
      <div class="option-group-head">
        <input type="text" class="option-name-input" data-rename-option="${option.id}" value="${escapeHtml(option.name)}" maxlength="50">
        <button type="button" class="btn btn-icon btn-sm" data-delete-option="${option.id}" title="Remove this whole option group" aria-label="Remove option group">✕</button>
      </div>
      <div class="option-value-chips">
        ${(option.values || []).map((v) => `
          <span class="option-value-chip" data-value-chip="${v.id}">
            <button type="button" class="ovc-photo-toggle" data-photo-toggle="${option.id}:${v.id}" title="${v.image ? "Change photo" : "Add a photo for this value"}">
              ${v.image ? `<img src="${v.image.url}" alt="" class="ovc-thumb">` : `<span class="ovc-thumb-placeholder">${CAMERA_ICON}</span>`}
            </button>
            ${escapeHtml(v.value)}
            <button type="button" class="ovc-remove" data-delete-value="${option.id}:${v.id}" aria-label="Remove value">✕</button>
          </span>
          <div class="ovc-photo-popover" data-photo-popover="${option.id}:${v.id}" hidden></div>`).join("")}
        <form class="option-value-add" data-add-value="${option.id}">
          <input type="text" name="value" placeholder="+ Add value" maxlength="100" required>
        </form>
      </div>
    </div>
  `;
}

function wireOptionGroupActions(tabBody, product) {
  // Rename an option group on blur/Enter (not every keystroke).
  tabBody.querySelectorAll("[data-rename-option]").forEach((input) => {
    const commit = async () => {
      const id = input.dataset.renameOption;
      const option = product.options.find((o) => String(o.id) === String(id));
      const name = input.value.trim();
      if (!name || name === option.name) { input.value = option.name; return; }
      try {
        const { product: updated } = await api.put(`/seller/products/${product.id}/options/${id}`, { name });
        Object.assign(product, updated);
        toast("Option group renamed.", "success");
      } catch (err) {
        toast(err.message || "Couldn't rename that option group.", "error");
        input.value = option.name;
      }
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  });

  tabBody.querySelectorAll("[data-delete-option]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.deleteOption;
      const option = product.options.find((o) => String(o.id) === String(id));
      confirmSimple({
        title: `Remove "${option?.name}"?`,
        description: "This removes the whole option group, all its values, and every combination that used it — including their stock numbers.",
        confirmLabel: "Remove",
        tone: "danger",
        onConfirm: async () => {
          const { product: updated } = await api.delete(`/seller/products/${product.id}/options/${id}`);
          Object.assign(product, updated);
          renderOptionsTab(tabBody, product);
        },
      });
    });
  });

  tabBody.querySelectorAll("[data-add-value]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const optionId = form.dataset.addValue;
      const input = form.querySelector('input[name="value"]');
      const value = input.value.trim();
      if (!value) return;
      input.disabled = true;
      try {
        const { product: updated } = await api.post(`/seller/products/${product.id}/options/${optionId}/values`, { value });
        Object.assign(product, updated);
        renderOptionsTab(tabBody, product);
      } catch (err) {
        toast(err.message || "Couldn't add that value.", "error");
        input.disabled = false;
      }
    });
  });

  tabBody.querySelectorAll("[data-delete-value]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [optionId, valueId] = btn.dataset.deleteValue.split(":");
      confirmSimple({
        title: "Remove this value?",
        description: "Any combination that used it (and its stock) goes with it.",
        confirmLabel: "Remove",
        tone: "danger",
        onConfirm: async () => {
          const { product: updated } = await api.delete(`/seller/products/${product.id}/options/${optionId}/values/${valueId}`);
          Object.assign(product, updated);
          renderOptionsTab(tabBody, product);
        },
      });
    });
  });

  wireValuePhotoPopovers(tabBody, product);
}

/* Lets a seller attach a photo to an option value right where they typed
   it — no switching to the Photos tab and hunting for the right value
   there. Clicking the little circle on a chip opens a small popover with
   the product's existing photos to pick from, plus a straight upload if
   none of them are right (covers the common case of adding the very first
   photo for a brand-new Style value with nothing uploaded yet). */
function wireValuePhotoPopovers(tabBody, product) {
  tabBody.querySelectorAll("[data-photo-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const key = btn.dataset.photoToggle;
      const popover = tabBody.querySelector(`[data-photo-popover="${key}"]`);
      const isOpen = !popover.hidden;
      tabBody.querySelectorAll("[data-photo-popover]").forEach((p) => (p.hidden = true));
      if (isOpen) return; // was already open — just close it
      const [optionId, valueId] = key.split(":");
      renderValuePhotoPopover(tabBody, product, popover, optionId, valueId);
      popover.hidden = false;
    });
  });
}

function renderValuePhotoPopover(tabBody, product, popover, optionId, valueId) {
  const option = product.options.find((o) => String(o.id) === String(optionId));
  const value = option?.values.find((v) => String(v.id) === String(valueId));
  const images = product.images || [];

  popover.innerHTML = `
    <div class="ovc-popover-body">
      ${images.length ? `
        <div class="photo-picker-row">
          ${images.map((img) => `<button type="button" class="photo-pick-thumb" data-assign-photo="${img.id}" title="Use this photo"><img src="${img.url}" alt=""></button>`).join("")}
        </div>` : `<p class="photo-pick-empty">No photos uploaded yet — add one below.</p>`}
      <label class="ovc-upload">
        ${images.length ? "or upload a new photo" : "Upload a photo"}
        <input type="file" accept="image/png,image/jpeg,image/webp" data-upload-photo>
      </label>
      ${value?.image ? `<button type="button" class="ovc-popover-remove" data-remove-photo>Remove current photo</button>` : ""}
    </div>
  `;

  const assign = async (imageId) => {
    popover.style.opacity = "0.6";
    try {
      const { product: updated } = await api.put(
        `/seller/products/${product.id}/options/${optionId}/values/${valueId}`,
        { image_id: imageId }
      );
      Object.assign(product, updated);
      renderOptionsTab(tabBody, product);
    } catch (err) {
      toast(err.message || "Couldn't set that photo.", "error");
      popover.style.opacity = "1";
    }
  };

  popover.querySelectorAll("[data-assign-photo]").forEach((btn) => {
    btn.addEventListener("click", () => assign(Number(btn.dataset.assignPhoto)));
  });

  popover.querySelector("[data-remove-photo]")?.addEventListener("click", () => assign(null));

  popover.querySelector("[data-upload-photo]").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);
    popover.style.opacity = "0.6";
    try {
      const { image } = await api.post(`/seller/products/${product.id}/images`, formData);
      product.images = [...(product.images || []), image];
      await assign(image.id);
      load();
    } catch (err) {
      toast(err.message || "Failed to upload photo.", "error");
      popover.style.opacity = "1";
    }
  });
}

/* Below the option groups: either the generated combination grid (one row
   per buyable combo, each with its own price/stock), or — for a product
   with no option groups at all — a single flat stock field, since there's
   nothing to combine. */
function renderComboSection(tabBody, product) {
  const section = tabBody.querySelector("#comboSection");
  if (!section) return;
  section.dataset.dirty = "0"; // fresh render (from server data) always starts clean
  const variations = product.variations || [];

  if (!product.options?.length) {
    section.innerHTML = `
      <div class="combo-flat-stock">
        <label for="flatStockInput">Stock <span class="text-muted">(no option groups — this sells as a single item)</span></label>
        <div class="combo-flat-stock-row">
          <input type="number" id="flatStockInput" min="0" step="1" value="${product.stock ?? 0}">
          <button type="button" class="btn btn-sm btn-primary" id="flatStockSave">Save</button>
        </div>
      </div>
    `;
    section.querySelector("#flatStockSave").addEventListener("click", async () => {
      const val = section.querySelector("#flatStockInput").value;
      try {
        const { product: updated } = await api.put(`/seller/products/${product.id}`, { stock: val });
        Object.assign(product, updated);
        toast("Stock updated.", "success");
        load();
      } catch (err) {
        toast(err.message || "Couldn't update stock.", "error");
      }
    });
    return;
  }

  if (!variations.length) {
    section.innerHTML = `<div class="empty-state">Add at least one value above to generate buyable combinations.</div>`;
    return;
  }

  const totalStock = variations.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);

  section.innerHTML = `
    <div class="combo-grid-head">
      <h4>Combinations</h4>
      <span class="text-muted" style="font-size:12px;">${variations.length} combination${variations.length === 1 ? "" : "s"} · ${totalStock} total stock</span>
    </div>
    <div class="table-wrap">
      <table class="data-table combo-table">
        <thead><tr><th>Combination</th><th>Price +/- (₱)</th><th>Stock</th></tr></thead>
        <tbody>
          ${variations.map((v) => `
            <tr data-combo-row="${v.id}">
              <td>
                <div class="combo-label">
                  ${v.image ? `<img src="${v.image.url}" alt="" class="combo-thumb">` : ""}
                  ${escapeHtml(v.label)}
                </div>
              </td>
              <td><input type="number" class="combo-price" step="0.01" value="${v.price_adjustment}"></td>
              <td><input type="number" class="combo-stock" min="0" step="1" value="${v.stock}"></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div class="combo-actions">
      <button type="button" class="btn btn-sm btn-outline" id="comboApplyStock">Apply first row's stock to all</button>
      <button type="button" class="btn btn-sm btn-primary" id="comboSaveAll">Save all combinations</button>
    </div>
    <div class="field-error" data-combo-error hidden></div>
  `;

  section.querySelectorAll(".combo-price, .combo-stock").forEach((input) => {
    input.addEventListener("input", () => { section.dataset.dirty = "1"; });
  });

  section.querySelector("#comboApplyStock").addEventListener("click", () => {
    const rows = section.querySelectorAll("[data-combo-row]");
    const firstStock = rows[0]?.querySelector(".combo-stock")?.value;
    if (firstStock === undefined) return;
    rows.forEach((row) => { row.querySelector(".combo-stock").value = firstStock; });
    section.dataset.dirty = "1";
  });

  section.querySelector("#comboSaveAll").addEventListener("click", async () => {
    const errorBox = section.querySelector("[data-combo-error]");
    errorBox.hidden = true;
    const rows = [...section.querySelectorAll("[data-combo-row]")];
    const payload = rows.map((row) => ({
      id: Number(row.dataset.comboRow),
      price_adjustment: row.querySelector(".combo-price").value || 0,
      stock: row.querySelector(".combo-stock").value || 0,
    }));
    const btn = section.querySelector("#comboSaveAll");
    btn.disabled = true;
    try {
      const { product: updated } = await api.patch(`/seller/products/${product.id}/variations/bulk`, { variations: payload });
      Object.assign(product, updated);
      toast("Stock and pricing saved.", "success");
      renderComboSection(tabBody, product);
      load();
    } catch (err) {
      errorBox.textContent = err.message || "Couldn't save these combinations.";
      errorBox.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}