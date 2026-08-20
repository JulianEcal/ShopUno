// assets/js/pages/admin-compliance.js
import { api } from "../api.js";
import { initShell } from "../partials/admin-shell.js";
import {
  escapeHtml, formatDateTime, money, toast, debounce,
  normalizePaginated, openModal, closeModal, confirmWithNote,
} from "../lib/ui.js";

const content = initShell({ page: "compliance", title: "Compliance", eyebrow: "Trust & Safety" });

content.innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Product listings</h3>
        <p>Review products for policy violations — mismatched category, prohibited items, misleading listings.</p>
      </div>
    </div>
    <div class="filter-bar">
      <label class="checkbox-row" style="font-size:12.5px; font-weight:600; color:var(--ink-soft);">
        <input type="checkbox" id="fFlagged"> Flagged only
      </label>
      <div class="filter-spacer"></div>
      <input type="search" id="fSearch" placeholder="Search product name…">
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Product</th><th>Category</th><th>Seller</th><th>Price</th><th>Stock</th><th></th></tr>
        </thead>
        <tbody id="tbody">
          <tr><td colspan="6" class="table-loading">Loading…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="pagination" id="pagination" hidden></div>
  </div>
`;

const state = { flagged: false, search: "", page: 1 };

document.getElementById("fFlagged").addEventListener("change", (e) => { state.flagged = e.target.checked; state.page = 1; load(); });
document.getElementById("fSearch").addEventListener("input", debounce((e) => { state.search = e.target.value.trim(); state.page = 1; load(); }, 350));

load();

async function load() {
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = `<tr><td colspan="6" class="table-loading">Loading…</td></tr>`;

  const params = new URLSearchParams();
  if (state.flagged) params.set("flagged", "1");
  if (state.search) params.set("search", state.search);
  params.set("page", state.page);

  try {
    const json = await api.get(`/admin/compliance/products?${params.toString()}`);
    const { items, meta } = normalizePaginated(json);
    renderTable(items);
    renderPagination(meta);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">${escapeHtml(err.message || "Failed to load products.")}</td></tr>`;
  }
}

function renderTable(items) {
  const tbody = document.getElementById("tbody");
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No products match these filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = items
    .map(
      (p) => `
      <tr>
        <td>
          <div class="cell-name">${escapeHtml(p.name)}</div>
          ${state.flagged ? `<span class="badge badge-flagged">flagged</span>` : (p.is_archived ? `<span class="badge badge-archived">archived</span>` : "")}
        </td>
        <td>${escapeHtml(p.category?.name || "—")}</td>
        <td>
          <div class="cell-name" style="font-weight:500">${escapeHtml(p.seller?.business_name || "—")}</div>
          <div class="cell-sub">${escapeHtml(p.seller?.line_of_business || "")}</div>
        </td>
        <td class="mono">${money(p.base_price)}</td>
        <td>${p.stock ?? "—"}</td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-sm btn-outline" data-view="${p.id}">Review</button>
          </div>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewProduct(b.dataset.view)));
}

function renderPagination(meta) {
  const el = document.getElementById("pagination");
  if (!meta || !meta.last_page || meta.last_page <= 1) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `
    <span>Page ${meta.current_page} of ${meta.last_page} · ${meta.total ?? ""} total</span>
    <div class="page-controls">
      <button class="btn btn-sm btn-outline" id="prevPage" ${meta.current_page <= 1 ? "disabled" : ""}>Previous</button>
      <button class="btn btn-sm btn-outline" id="nextPage" ${meta.current_page >= meta.last_page ? "disabled" : ""}>Next</button>
    </div>
  `;
  document.getElementById("prevPage")?.addEventListener("click", () => { state.page = Math.max(1, state.page - 1); load(); });
  document.getElementById("nextPage")?.addEventListener("click", () => { state.page += 1; load(); });
}

async function viewProduct(id) {
  openModal((box) => { box.innerHTML = `<div class="modal-body" style="padding-top:24px"><div class="empty-state">Loading product…</div></div>`; }, { wide: true });
  try {
    const { product, flag_history } = await api.get(`/admin/compliance/products/${id}`);
    renderProductModal(product, flag_history || []);
  } catch (err) {
    toast(err.message || "Failed to load product.", "error");
    closeModal();
  }
}

function renderProductModal(p, history) {
  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>${escapeHtml(p.name)}</h3>
          <p>${escapeHtml(p.category?.name || "Uncategorized")} · Sold by ${escapeHtml(p.seller?.business_name || "—")}${p.is_archived ? ` · <span style="color:var(--chili)">Archived</span>` : ""}</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="detail-grid">
          <div>
            <div class="kv-list">
              <div class="kv-row"><span class="k">Price</span><span class="v mono">${money(p.base_price)}</span></div>
              <div class="kv-row"><span class="k">Stock</span><span class="v">${p.stock ?? "—"}</span></div>
              <div class="kv-row"><span class="k">Seller line of business</span><span class="v">${escapeHtml(p.seller?.line_of_business || "—")}</span></div>
              <div class="kv-row"><span class="k">Description</span><span class="v" style="text-align:left; max-width:260px;">${escapeHtml(p.description || "—")}</span></div>
            </div>
            <div style="margin-top:16px; display:flex; flex-wrap:wrap; gap:8px;">
              <button class="btn btn-sm btn-ochre" data-flag>Flag</button>
              <button class="btn btn-sm btn-teal" data-resolve>Resolve flag</button>
              ${!p.is_archived ? `<button class="btn btn-sm btn-chili" data-archive>Archive listing</button>` : ""}
            </div>
          </div>
          <div>
            <div class="nav-group-label" style="margin-bottom:8px;">Flag history</div>
            <div class="activity-list" style="max-height:280px; overflow-y:auto;">
              ${
                history.length
                  ? history.map((f) => `
                    <div class="activity-row">
                      <div class="activity-body">
                        <div class="activity-summary"><strong>${escapeHtml(f.type)}</strong> by ${escapeHtml(f.admin ? `${f.admin.first_name} ${f.admin.last_name}` : "—")}</div>
                        ${f.note ? `<div class="activity-note">“${escapeHtml(f.note)}”</div>` : ""}
                        <div class="activity-time">${formatDateTime(f.created_at)}</div>
                      </div>
                    </div>`).join("")
                  : `<div class="empty-state">No compliance actions on record.</div>`
              }
            </div>
          </div>
        </div>
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    box.querySelector("[data-flag]")?.addEventListener("click", () => flagProduct(p.id));
    box.querySelector("[data-resolve]")?.addEventListener("click", () => resolveProduct(p.id));
    box.querySelector("[data-archive]")?.addEventListener("click", () => archiveProduct(p.id));
  }, { wide: true });
}

function flagProduct(id) {
  confirmWithNote({
    title: "Flag this product",
    description: "Marks the listing for review and emails the seller.",
    fieldLabel: "Reason for flagging",
    confirmLabel: "Flag product",
    tone: "ochre",
    onConfirm: async (note) => {
      await api.post(`/admin/compliance/products/${id}/flag`, { note });
      toast("Product flagged for review.", "success");
      closeModal();
      load();
    },
  });
}

function resolveProduct(id) {
  confirmWithNote({
    title: "Resolve this flag",
    description: "Marks any open flag as resolved and notifies the seller.",
    fieldLabel: "Resolution note",
    confirmLabel: "Resolve",
    tone: "teal",
    stampText: "Resolved",
    onConfirm: async (note) => {
      await api.post(`/admin/compliance/products/${id}/resolve`, { note });
      toast("Flag resolved.", "success");
      load();
    },
  });
}

function archiveProduct(id) {
  confirmWithNote({
    title: "Archive this listing?",
    description: "The product will be force-removed from the store. Use this for confirmed violations.",
    fieldLabel: "Reason for archiving",
    confirmLabel: "Archive product",
    tone: "chili",
    stampText: "Archived",
    onConfirm: async (note) => {
      await api.post(`/admin/compliance/products/${id}/archive`, { note });
      toast("Product archived.", "success");
      load();
    },
  });
}
