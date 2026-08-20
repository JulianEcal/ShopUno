// assets/js/pages/admin-accounts.js
import { api } from "../api.js";
import { initShell } from "../partials/admin-shell.js";
import {
  escapeHtml, formatDateTime, toast, debounce, fullName,
  statusBadge, roleBadge, normalizePaginated,
  openModal, closeModal, confirmSimple, confirmWithNote,
} from "../lib/ui.js";

const content = initShell({ page: "accounts", title: "Accounts", eyebrow: "People" });

content.innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>All accounts</h3>
        <p>Buyers, sellers, and couriers who have already been approved.</p>
      </div>
    </div>
    <div class="filter-bar">
      <label for="fStatus">Status</label>
      <select id="fStatus">
        <option value="" selected>All statuses</option>
        <option value="active">Active</option>
        <option value="suspended">Suspended</option>
        <option value="deactivated">Deactivated</option>
      </select>
      <label for="fRole">Role</label>
      <select id="fRole">
        <option value="">All roles</option>
        <option value="buyer">Buyer</option>
        <option value="seller">Seller</option>
        <option value="courier">Courier</option>
      </select>
      <div class="filter-spacer"></div>
      <input type="search" id="fSearch" placeholder="Search name or email…">
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Account</th><th>Role</th><th>Contact</th><th>Status</th><th></th></tr>
        </thead>
        <tbody id="tbody">
          <tr><td colspan="5" class="table-loading">Loading…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="pagination" id="pagination" hidden></div>
  </div>
`;

const state = { status: "", role: "", search: "", page: 1 };

document.getElementById("fStatus").addEventListener("change", (e) => { state.status = e.target.value; state.page = 1; load(); });
document.getElementById("fRole").addEventListener("change", (e) => { state.role = e.target.value; state.page = 1; load(); });
document.getElementById("fSearch").addEventListener("input", debounce((e) => { state.search = e.target.value.trim(); state.page = 1; load(); }, 350));

load();

async function load() {
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = `<tr><td colspan="5" class="table-loading">Loading…</td></tr>`;

  const params = new URLSearchParams();
  if (state.status) params.set("status", state.status);
  if (state.role) params.set("role", state.role);
  if (state.search) params.set("search", state.search);
  params.set("page", state.page);

  try {
    const json = await api.get(`/admin/accounts?${params.toString()}`);
    const { items, meta } = normalizePaginated(json);
    renderTable(items);
    renderPagination(meta);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${escapeHtml(err.message || "Failed to load accounts.")}</td></tr>`;
  }
}

function renderTable(items) {
  const tbody = document.getElementById("tbody");
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">No accounts match these filters.</td></tr>`;
    return;
  }
  tbody.innerHTML = items
    .map(
      (u) => `
      <tr>
        <td>
          <div class="cell-name">${escapeHtml(fullName(u))}</div>
          <div class="cell-sub">${escapeHtml(u.email)}</div>
        </td>
        <td>${roleBadge(u.role)}</td>
        <td>${escapeHtml(u.contact_no || "—")}</td>
        <td>${statusBadge(u.status)}</td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-sm btn-outline" data-view="${u.id}">Manage</button>
          </div>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewAccount(b.dataset.view)));
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

async function viewAccount(id) {
  openModal((box) => { box.innerHTML = `<div class="modal-body" style="padding-top:24px"><div class="empty-state">Loading account…</div></div>`; }, { wide: true });
  try {
    const { user, moderation_log } = await api.get(`/admin/accounts/${id}`);
    renderAccountModal(user, moderation_log || []);
  } catch (err) {
    toast(err.message || "Failed to load account.", "error");
    closeModal();
  }
}

function renderAccountModal(u, log) {
  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>${escapeHtml(fullName(u))}</h3>
          <p>${escapeHtml(u.email)} · ${escapeHtml(u.role)}</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="detail-grid">
          <div>
            <div class="kv-list">
              <div class="kv-row"><span class="k">Status</span><span class="v">${statusBadge(u.status)}</span></div>
              <div class="kv-row"><span class="k">Contact number</span><span class="v">${escapeHtml(u.contact_no || "—")}</span></div>
              ${u.seller ? `<div class="kv-row"><span class="k">Business</span><span class="v">${escapeHtml(u.seller.business_name)}</span></div>` : ""}
              ${u.courier ? `<div class="kv-row"><span class="k">Vehicle</span><span class="v">${escapeHtml(u.courier.vehicle_type)} · ${escapeHtml(u.courier.plate_number)}</span></div>` : ""}
            </div>
            <div style="margin-top:16px; display:flex; flex-wrap:wrap; gap:8px;">
              <button class="btn btn-sm btn-ochre" data-warn>Warn</button>
              ${u.status !== "active" ? `<button class="btn btn-sm btn-teal" data-activate>Activate</button>` : ""}
              ${u.status !== "suspended" ? `<button class="btn btn-sm btn-chili" data-suspend>Suspend</button>` : ""}
              ${u.status !== "deactivated" ? `<button class="btn btn-sm btn-outline" data-deactivate>Deactivate</button>` : ""}
            </div>
          </div>
          <div>
            <div class="nav-group-label" style="margin-bottom:8px;">Moderation history</div>
            <div class="activity-list" style="max-height:280px; overflow-y:auto;">
              ${
                log.length
                  ? log.map((l) => `
                    <div class="activity-row">
                      <div class="activity-body">
                        <div class="activity-summary"><strong>${escapeHtml(l.type)}</strong> by ${escapeHtml(l.admin ? `${l.admin.first_name} ${l.admin.last_name}` : "—")}</div>
                        ${l.note ? `<div class="activity-note">“${escapeHtml(l.note)}”</div>` : ""}
                        <div class="activity-time">${formatDateTime(l.created_at)}</div>
                      </div>
                    </div>`).join("")
                  : `<div class="empty-state">No moderation actions on record.</div>`
              }
            </div>
          </div>
        </div>
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));

    box.querySelector("[data-warn]")?.addEventListener("click", () => warnAccount(u.id));
    box.querySelector("[data-activate]")?.addEventListener("click", () => activateAccount(u.id));
    box.querySelector("[data-suspend]")?.addEventListener("click", () => suspendAccount(u.id));
    box.querySelector("[data-deactivate]")?.addEventListener("click", () => deactivateAccount(u.id));
  }, { wide: true });
}

function warnAccount(id) {
  confirmWithNote({
    title: "Issue a warning",
    description: "This logs a warning on the account and emails the user. It does not change their account status.",
    fieldLabel: "Warning note",
    confirmLabel: "Issue warning",
    tone: "ochre",
    onConfirm: async (note) => {
      await api.post(`/admin/accounts/${id}/warn`, { note });
      toast("Warning issued.", "success");
      closeModal();
      load();
    },
  });
}

function activateAccount(id) {
  confirmSimple({
    title: "Activate this account?",
    description: "The user will regain full access and be notified by email.",
    confirmLabel: "Activate",
    tone: "teal",
    stampText: "Activated",
    onConfirm: async () => {
      await api.post(`/admin/accounts/${id}/activate`);
      toast("Account activated.", "success");
      load();
    },
  });
}

function suspendAccount(id) {
  confirmWithNote({
    title: "Suspend this account?",
    description: "The user will be temporarily locked out and notified by email.",
    fieldLabel: "Reason",
    confirmLabel: "Suspend account",
    tone: "chili",
    stampText: "Suspended",
    onConfirm: async (note) => {
      await api.post(`/admin/accounts/${id}/suspend`, { note });
      toast("Account suspended.", "success");
      load();
    },
  });
}

function deactivateAccount(id) {
  confirmWithNote({
    title: "Deactivate this account?",
    description: "This is a longer-term shutdown of the account. The user will be notified by email.",
    fieldLabel: "Reason",
    confirmLabel: "Deactivate account",
    tone: "chili",
    stampText: "Deactivated",
    onConfirm: async (note) => {
      await api.post(`/admin/accounts/${id}/deactivate`, { note });
      toast("Account deactivated.", "success");
      load();
    },
  });
}
