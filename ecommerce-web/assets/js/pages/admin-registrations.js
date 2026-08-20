// assets/js/pages/admin-registrations.js
import { api, ApiError } from "../api.js";
import { initShell } from "../partials/admin-shell.js";
import {
  escapeHtml, formatDate, formatDateTime, toast, debounce, fullName,
  statusBadge, roleBadge, normalizePaginated,
  openModal, closeModal, confirmSimple, confirmWithNote,
  openImageLightbox,
} from "../lib/ui.js";

// Mirrors the labels used in the sign-up wizard so the ID type an applicant
// picked (and any document keyed by that type) reads the same way here.
const ID_TYPE_LABELS = {
  national_id: "Philippine National ID",
  drivers_license: "Driver's License",
  passport: "Passport",
  umid: "UMID",
  voters_id: "Voter's ID",
  postal_id: "Postal ID",
};

// The queue table only needs "First Last", but the modal should show the
// applicant's full legal name exactly as they submitted it, middle initial
// included.
function fullNameWithMiddle(u) {
  return [u.first_name, u.middle_initial ? `${u.middle_initial}.` : "", u.last_name]
    .filter(Boolean)
    .join(" ") || "—";
}

const IMAGE_EXT_PATTERN = /\.(png|jpe?g|gif|webp|heic|heif)(\?.*)?$/i;

// Applicants upload their ID as a photo/scan (png/jpg) or a PDF (see
// login.html's `accept` on #idUpload). Images get a clickable thumbnail that
// opens full-screen in the lightbox; a PDF falls back to a plain file tile
// that opens in a new tab instead (nothing to enlarge in-page).
function renderDocumentPreview(label, url) {
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  if (IMAGE_EXT_PATTERN.test(url)) {
    return `
      <button type="button" class="doc-preview-item" data-lightbox-src="${safeUrl}" data-lightbox-caption="${safeLabel}">
        <img class="doc-thumb" src="${safeUrl}" alt="${safeLabel}" loading="lazy">
        <span class="doc-preview-label">${safeLabel}</span>
      </button>`;
  }
  return `
    <a class="doc-preview-item" href="${safeUrl}" target="_blank" rel="noopener">
      <div class="doc-file-tile">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        <span>FILE</span>
      </div>
      <span class="doc-preview-label">${safeLabel}</span>
    </a>`;
}

const content = initShell({ page: "registrations", title: "Registrations", eyebrow: "People" });

content.innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Applicant queue</h3>
        <p>Review new seller, courier, and buyer signups before they go live.</p>
      </div>
    </div>
    <div class="filter-bar">
      <label for="fStatus">Status</label>
      <select id="fStatus">
        <option value="pending" selected>Pending</option>
        <option value="active">Approved</option>
        <option value="rejected">Rejected</option>
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
          <tr><th>Applicant</th><th>Role</th><th>Contact</th><th>Status</th><th></th></tr>
        </thead>
        <tbody id="tbody">
          <tr><td colspan="5" class="table-loading">Loading…</td></tr>
        </tbody>
      </table>
    </div>
    <div class="pagination" id="pagination" hidden></div>
  </div>
`;

const state = { status: "pending", role: "", search: "", page: 1 };

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
    const json = await api.get(`/admin/registrations?${params.toString()}`);
    const { items, meta } = normalizePaginated(json);
    renderTable(items);
    renderPagination(meta);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">${escapeHtml(err.message || "Failed to load registrations.")}</td></tr>`;
  }
}

function renderTable(items) {
  const tbody = document.getElementById("tbody");
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-empty">No applicants match these filters.</td></tr>`;
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
            <button class="btn btn-sm btn-outline" data-view="${u.id}">View</button>
            ${u.status === "pending" ? `
              <button class="btn btn-sm btn-teal" data-approve="${u.id}">Approve</button>
              <button class="btn btn-sm btn-chili" data-reject="${u.id}">Reject</button>
            ` : ""}
          </div>
        </td>
      </tr>`
    )
    .join("");

  tbody.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewApplicant(b.dataset.view)));
  tbody.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => approveApplicant(b.dataset.approve)));
  tbody.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => rejectApplicant(b.dataset.reject)));
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

async function viewApplicant(id) {
  openModal((box) => { box.innerHTML = `<div class="modal-body" style="padding-top:24px"><div class="empty-state">Loading applicant…</div></div>`; }, { wide: true });
  try {
    const { user } = await api.get(`/admin/registrations/${id}`);
    renderApplicantModal(user);
  } catch (err) {
    toast(err.message || "Failed to load applicant.", "error");
    closeModal();
  }
}

function renderApplicantModal(u) {
  const addr = u.address;
  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>${escapeHtml(fullNameWithMiddle(u))}</h3>
          <p>${escapeHtml(u.email)} · Applied as ${escapeHtml(u.role)}</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="kv-list">
          <div class="kv-row"><span class="k">Status</span><span class="v">${statusBadge(u.status)}</span></div>
          <div class="kv-row"><span class="k">Applied on</span><span class="v">${formatDateTime(u.created_at)}</span></div>
          <div class="kv-row"><span class="k">Contact number</span><span class="v">${escapeHtml(u.contact_no || "—")}</span></div>
          <div class="kv-row"><span class="k">Birthday</span><span class="v">${formatDate(u.birthday)}${u.age ? ` (${u.age} yrs)` : ""}</span></div>
          <div class="kv-row"><span class="k">Sex</span><span class="v">${escapeHtml(u.sex || "—")}</span></div>
          ${addr ? `<div class="kv-row"><span class="k">Address</span><span class="v">${escapeHtml([addr.house_number, addr.street, addr.barangay, addr.municipality, addr.province, addr.region].filter(Boolean).join(", "))}</span></div>` : ""}
          ${u.seller ? `
            <div class="kv-row"><span class="k">Business name</span><span class="v">${escapeHtml(u.seller.business_name)}</span></div>
            <div class="kv-row"><span class="k">Line of business</span><span class="v">${escapeHtml(u.seller.line_of_business)}</span></div>
          ` : ""}
          ${u.courier ? `
            <div class="kv-row"><span class="k">Vehicle type</span><span class="v">${escapeHtml(u.courier.vehicle_type)}</span></div>
            <div class="kv-row"><span class="k">Plate number</span><span class="v">${escapeHtml(u.courier.plate_number)}</span></div>
          ` : ""}
          ${u.id_type ? `<div class="kv-row"><span class="k">ID type</span><span class="v">${escapeHtml(ID_TYPE_LABELS[u.id_type] || u.id_type)}</span></div>` : ""}
          ${u.documents ? `<div class="kv-row"><span class="k">Documents</span><span class="v"><div class="doc-preview-list">${Object.entries(u.documents).map(([k, v]) => v ? renderDocumentPreview(ID_TYPE_LABELS[k] || k, v) : "").filter(Boolean).join("") || "—"}</div></span></div>` : ""}
          ${u.status === "rejected" && u.rejection_reason ? `<div class="kv-row"><span class="k">Rejection reason</span><span class="v">${escapeHtml(u.rejection_reason)}</span></div>` : ""}
        </div>
      </div>
      <div class="modal-footer">
        ${u.status === "pending" ? `
          <button type="button" class="btn btn-chili" data-modal-reject>Reject</button>
          <button type="button" class="btn btn-teal" data-modal-approve>Approve</button>
        ` : `<button type="button" class="btn btn-outline" data-close>Close</button>`}
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    box.querySelectorAll("[data-lightbox-src]").forEach((b) =>
      b.addEventListener("click", () => openImageLightbox(b.dataset.lightboxSrc, b.dataset.lightboxCaption))
    );
    box.querySelector("[data-modal-approve]")?.addEventListener("click", () => approveApplicant(u.id));
    box.querySelector("[data-modal-reject]")?.addEventListener("click", () => rejectApplicant(u.id));
  }, { wide: true });
}

function approveApplicant(id) {
  confirmSimple({
    title: "Approve this applicant?",
    description: "They'll be notified by email and can sign in immediately.",
    confirmLabel: "Approve",
    tone: "teal",
    stampText: "Approved",
    onConfirm: async () => {
      try {
        await api.post(`/admin/registrations/${id}/approve`);
        toast("Applicant approved.", "success");
        load();
      } catch (err) {
        throw new Error(err instanceof ApiError ? err.message : "Failed to approve applicant.");
      }
    },
  });
}

function rejectApplicant(id) {
  confirmWithNote({
    title: "Reject this applicant?",
    description: "They'll be notified by email with your reason.",
    fieldLabel: "Reason",
    fieldPlaceholder: "Why is this application being rejected?",
    confirmLabel: "Reject applicant",
    tone: "chili",
    stampText: "Rejected",
    onConfirm: async (reason) => {
      await api.post(`/admin/registrations/${id}/reject`, { reason });
      toast("Applicant rejected.", "success");
      load();
    },
  });
}