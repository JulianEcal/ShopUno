// assets/js/pages/admin-complaints.js
import { api } from "../api.js";
import { initShell } from "../partials/admin-shell.js";
import {
  escapeHtml, formatDateTime, toast, debounce,
  statusBadge, normalizePaginated, openModal, closeModal,
} from "../lib/ui.js";

const content = initShell({ page: "complaints", title: "Complaints", eyebrow: "Trust & Safety" });

content.innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Filed complaints</h3>
        <p>Buyer, seller, and courier complaints, filed against another party or an order.</p>
      </div>
    </div>
    <div class="filter-bar">
      <label for="fStatus">Status</label>
      <select id="fStatus">
        <option value="" selected>All statuses</option>
        <option value="open">Open</option>
        <option value="under_review">Under review</option>
        <option value="resolved">Resolved</option>
      </select>
      <div class="filter-spacer"></div>
      <input type="search" id="fSearch" placeholder="Search subject…">
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Subject</th><th>Filed by</th><th>Against</th><th>Status</th><th></th></tr>
        </thead>
        <tbody id="tbody">
          <tr><td colspan="5" class="table-loading">Loading…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="pagination" id="pagination" hidden></div>
  </div>
`;

const state = { status: "", search: "", page: 1 };

document.getElementById("fStatus").addEventListener("change", (e) => { state.status = e.target.value; state.page = 1; load(); });
document.getElementById("fSearch").addEventListener("input", debounce((e) => { state.search = e.target.value.trim(); state.page = 1; load(); }, 350));

load();

async function load() {
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = `<tr><td colspan="5" class="table-loading">Loading…</td></tr>`;

  const params = new URLSearchParams();
  if (state.status) params.set("status", state.status);
  if (state.search) params.set("search", state.search);
  params.set("page", state.page);

  try {
    const json = await api.get(`/admin/complaints?${params.toString()}`);
    const { items, meta } = normalizePaginated(json);
    renderTable(items);
    renderPagination(meta);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${escapeHtml(err.message || "Failed to load complaints.")}</td></tr>`;
  }
}

function renderTable(items) {
  const tbody = document.getElementById("tbody");
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">No complaints match these filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = items
    .map(
      (c) => `
      <tr>
        <td>
          <div class="cell-name">${escapeHtml(c.subject)}</div>
          ${c.order_id ? `<div class="cell-sub">Order #${escapeHtml(c.order_id)}</div>` : ""}
        </td>
        <td>${escapeHtml(c.filed_by?.name || "—")}<div class="cell-sub">${escapeHtml(c.filed_by?.role || "")}</div></td>
        <td>${escapeHtml(c.against?.name || "—")}<div class="cell-sub">${escapeHtml(c.against?.role || "")}</div></td>
        <td>${statusBadge(c.status)}</td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-sm btn-outline" data-view="${c.id}">Review</button>
          </div>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewComplaint(b.dataset.view)));
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

async function viewComplaint(id) {
  openModal((box) => { box.innerHTML = `<div class="modal-body" style="padding-top:24px"><div class="empty-state">Loading complaint…</div></div>`; }, { wide: true });
  try {
    const { complaint } = await api.get(`/admin/complaints/${id}`);
    renderComplaintModal(complaint);
  } catch (err) {
    toast(err.message || "Failed to load complaint.", "error");
    closeModal();
  }
}

function renderComplaintModal(c) {
  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>${escapeHtml(c.subject)}</h3>
          <p>Filed ${formatDateTime(c.created_at)} by ${escapeHtml(c.filed_by?.name || "—")}</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="kv-list">
          <div class="kv-row"><span class="k">Status</span><span class="v">${statusBadge(c.status)}</span></div>
          <div class="kv-row"><span class="k">Filed by</span><span class="v">${escapeHtml(c.filed_by?.name || "—")} (${escapeHtml(c.filed_by?.role || "—")})</span></div>
          <div class="kv-row"><span class="k">Against</span><span class="v">${c.against ? `${escapeHtml(c.against.name)} (${escapeHtml(c.against.role)})` : "—"}</span></div>
          ${c.order_id ? `<div class="kv-row"><span class="k">Related order</span><span class="v">#${escapeHtml(c.order_id)}</span></div>` : ""}
        </div>
        <div class="field-group" style="margin-top:16px;">
          <label>Details</label>
          <p style="font-size:13.5px; line-height:1.5; color:var(--ink-soft); background:var(--paper-dim); border-radius:10px; padding:12px 14px;">${escapeHtml(c.details || "No further details provided.")}</p>
        </div>
        ${c.resolution_notes ? `
          <div class="field-group">
            <label>Resolution notes</label>
            <p style="font-size:13.5px; line-height:1.5; color:var(--teal-deep); background:var(--teal-soft); border-radius:10px; padding:12px 14px;">${escapeHtml(c.resolution_notes)}</p>
          </div>` : ""}
        ${c.status !== "resolved" ? `
        <div class="field-group">
          <label for="resolutionNotes">Resolution notes ${c.status === "open" ? "(required to mark resolved)" : ""}</label>
          <textarea id="resolutionNotes" placeholder="How was this complaint handled?"></textarea>
          <div class="field-error" data-error hidden></div>
        </div>` : ""}
      </div>
      <div class="modal-footer">
        ${c.status === "open" ? `<button type="button" class="btn btn-ochre" data-under-review>Mark under review</button>` : ""}
        ${c.status !== "resolved" ? `<button type="button" class="btn btn-teal" data-resolve>Mark resolved</button>` : `<button type="button" class="btn btn-outline" data-close>Close</button>`}
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    box.querySelector("[data-under-review]")?.addEventListener("click", (e) => updateComplaint(c.id, "under_review", box, e.target));
    box.querySelector("[data-resolve]")?.addEventListener("click", (e) => updateComplaint(c.id, "resolved", box, e.target));
  }, { wide: true });
}

async function updateComplaint(id, status, box, btn) {
  const errorBox = box.querySelector("[data-error]");
  const notes = box.querySelector("#resolutionNotes")?.value.trim() || "";
  if (errorBox) errorBox.hidden = true;

  if (status === "resolved" && !notes) {
    if (errorBox) {
      errorBox.textContent = "Resolution notes are required to mark a complaint resolved.";
      errorBox.hidden = false;
    }
    return;
  }

  const original = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>`;
  try {
    await api.patch(`/admin/complaints/${id}/resolve`, { status, resolution_notes: notes || null });
    toast(status === "resolved" ? "Complaint marked resolved." : "Complaint marked under review.", "success");
    closeModal();
    load();
  } catch (err) {
    toast(err.message || "Failed to update complaint.", "error");
    btn.disabled = false;
    btn.textContent = original;
  }
}
