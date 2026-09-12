// assets/js/pages/admin-registrations.js
//
// The applicant queue used to be one table backed by one endpoint
// (/admin/registrations), which only ever surfaced Logistics applicants —
// Sellers apply through a separate table (SellerApplication) and were
// invisible here. This page now merges both sources into a single queue,
// selectable via a row of role tabs (the "ledger index tab" pattern used
// throughout this admin) instead of a plain <select>. Each source keeps
// its own approve/reject endpoint under the hood; the UI just presents
// them as one list.
import { api, ApiError, fetchAuthedFile } from "../api.js";
import { initShell } from "../partials/admin-shell.js";
import {
  escapeHtml, formatDate, formatDateTime, toast, debounce, fullName,
  statusBadge, roleBadge, normalizePaginated,
  openModal, closeModal, confirmSimple, confirmWithNote,
  openDocumentViewer, skeletonRows, emptyStateRow,
} from "../lib/ui.js";

// Two-letter initials for the avatar chip in the applicant cell — mirrors
// the same treatment the sidebar gives the signed-in admin.
function initialsFor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

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

// Applicants upload their ID (or business permit) as a photo/scan (png/jpg)
// or a PDF. Images get a clickable thumbnail that opens full-screen in the
// lightbox; a PDF falls back to a plain file tile that opens in a new tab
// instead (nothing to enlarge in-page).
// Both variants used to link straight to the raw file URL (an <img src>
// or an <a target="_blank">) — but that URL sits behind the same auth
// middleware as every other admin endpoint, and neither an <img> nor a
// plain link can attach the Authorization header the browser would need,
// so it rendered `{"message":"Unauthenticated."}` instead of the document.
// Both variants now open the shared, authenticated document viewer instead;
// the image case also lazy-loads a real thumbnail through the same
// authenticated fetch once it's on screen.
function renderDocumentPreview(label, url) {
  if (!url) return "";
  const safeUrl = escapeHtml(url);
  const safeLabel = escapeHtml(label);
  const isImage = IMAGE_EXT_PATTERN.test(url);
  return `
    <button type="button" class="doc-preview-item" data-doc-url="${safeUrl}" data-doc-label="${safeLabel}" data-doc-type="${isImage ? "image" : "file"}">
      <span class="doc-thumb-wrap">
        ${isImage
          ? `<span class="doc-thumb doc-thumb-skel" data-doc-thumb></span>`
          : `<span class="doc-file-tile">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
               <span>FILE</span>
             </span>`}
        <span class="doc-thumb-zoom" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
      </span>
      <span class="doc-preview-label">${safeLabel}</span>
    </button>`;
}

function wireDocumentPreviews(box) {
  box.querySelectorAll("[data-doc-url]").forEach((btn) => {
    btn.addEventListener("click", () => openDocumentViewer(btn.dataset.docUrl, btn.dataset.docLabel));
    if (btn.dataset.docType === "image") loadDocThumbnail(btn);
  });
}

async function loadDocThumbnail(btn) {
  const thumb = btn.querySelector("[data-doc-thumb]");
  if (!thumb) return;
  try {
    const { blob } = await fetchAuthedFile(btn.dataset.docUrl);
    thumb.style.backgroundImage = `url("${URL.createObjectURL(blob)}")`;
    thumb.classList.remove("doc-thumb-skel");
  } catch {
    thumb.classList.add("doc-thumb-error");
  }
}

// Registrations uses "active" for an approved account; Seller Applications
// uses "approved" for the same idea. One status control on this page drives
// both endpoints, so every place that talks to the seller-applications API
// needs this translation.
function sellerStatusFor(status) {
  return status === "active" ? "approved" : status;
}

const ROLE_TABS = [
  {
    key: "all", label: "All applications",
    icon: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  },
  {
    key: "buyer", label: "Buyer",
    icon: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7"/>',
  },
  {
    key: "seller", label: "Seller",
    icon: '<path d="M3.5 9 5 4h14l1.5 5"/><path d="M4.5 9v9.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 20v-6h5v6"/>',
  },
  {
    key: "courier", label: "Courier",
    icon: '<circle cx="6" cy="17" r="2.6"/><circle cx="18" cy="17" r="2.6"/><path d="m6 17 3.5-8h4L17 17"/><path d="M9.5 9h4"/>',
  },
  {
    key: "logistics", label: "Logistics",
    icon: '<path d="M3 21V9.5L12 3l9 6.5V21"/><path d="M9 21v-6h6v6"/>',
  },
];

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "active", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const content = initShell({ page: "registrations", title: "Registrations", eyebrow: "People" });

content.innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Applicant queue</h3>
        <p id="queueSubtitle">Review new seller, courier, logistics, and buyer signups before they go live.</p>
      </div>
      <div class="status-pills" id="statusPills"></div>
    </div>
    <div class="role-tabs" id="roleTabs"></div>
    <div class="filter-bar">
      <span class="filter-hint" id="filterHint"></span>
      <input type="search" id="fSearch" placeholder="Search name or email…">
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th class="th-check" id="thCheckCell" hidden><input type="checkbox" id="selectAll" aria-label="Select all pending applicants"></th>
            <th>Applicant</th><th>Role</th><th>Contact</th><th>Applied</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody id="tbody">
          ${skeletonRows(6)}
        </tbody>
      </table>
    </div>
    <div class="pagination" id="pagination" hidden></div>
  </div>
  <div class="bulk-toolbar" id="bulkToolbar" hidden>
    <span class="bulk-count" id="bulkCount">0 selected</span>
    <div class="bulk-actions">
      <button type="button" class="btn btn-sm btn-outline" id="bulkClear">Clear</button>
      <button type="button" class="btn btn-sm btn-chili" id="bulkReject">Reject selected</button>
      <button type="button" class="btn btn-sm btn-teal" id="bulkApprove">Approve selected</button>
    </div>
  </div>
`;

const state = { status: "pending", role: "all", search: "", page: 1 };
let selected = new Set();
// Deep-link support: the Dashboard's "pending seller applications" card
// links here with ?role=seller so an admin lands straight on that tab
// instead of having to click it again.
const initialRole = new URLSearchParams(location.search).get("role");
if (ROLE_TABS.some((t) => t.key === initialRole)) state.role = initialRole;

let counts = { buyer: 0, seller: 0, courier: 0, logistics: 0, all: 0 };
// Rows currently on screen, keyed by "<kind>:<id>", so table buttons and the
// modal can look up the full normalized item (and dispatch to the right
// endpoint) from a single dataset attribute.
let rowIndex = new Map();

renderStatusPills();
renderRoleTabs();

document.getElementById("fSearch").addEventListener("input", debounce((e) => {
  state.search = e.target.value.trim();
  state.page = 1;
  load();
}, 350));

load();
loadCounts();

function renderStatusPills() {
  const el = document.getElementById("statusPills");
  el.innerHTML = STATUS_OPTIONS.map((opt) => `
    <button type="button" class="status-pill${state.status === opt.value ? " is-active" : ""}" data-status="${opt.value}">${opt.label}</button>
  `).join("");
  el.querySelectorAll("[data-status]").forEach((btn) => btn.addEventListener("click", () => {
    if (state.status === btn.dataset.status) return;
    state.status = btn.dataset.status;
    state.page = 1;
    renderStatusPills();
    load();
    loadCounts();
  }));
}

function roleIcon(svg) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
}

function renderRoleTabs() {
  const el = document.getElementById("roleTabs");
  el.innerHTML = ROLE_TABS.map((tab) => `
    <button type="button" class="role-tab${tab.key === "all" ? " is-all" : ""}${state.role === tab.key ? " is-active" : ""}" data-role="${tab.key}">
      <span class="role-tab-icon">${roleIcon(tab.icon)}</span>
      <span class="role-tab-body">
        <span class="role-tab-label">${tab.label}</span>
        <span class="role-tab-count" data-count="${tab.key}">${counts[tab.key] ?? 0}</span>
      </span>
    </button>
  `).join("");
  el.querySelectorAll("[data-role]").forEach((btn) => btn.addEventListener("click", () => {
    if (state.role === btn.dataset.role) return;
    state.role = btn.dataset.role;
    state.page = 1;
    renderRoleTabs();
    updateSubtitle();
    load();
  }));
  updateSubtitle();
}

function updateSubtitle() {
  const subtitle = document.getElementById("queueSubtitle");
  const map = {
    all: "Review new seller, courier, logistics, and buyer signups before they go live.",
    buyer: "Buyer accounts awaiting review.",
    seller: "Buyers who've applied to start selling — approving turns their account into a Seller.",
    courier: "Courier accounts awaiting review.",
    logistics: "Logistics company accounts awaiting review.",
  };
  subtitle.textContent = map[state.role] || map.all;
}

async function loadCounts() {
  try {
    const { counts: c } = await api.get(`/admin/registrations/counts?status=${encodeURIComponent(state.status)}`);
    counts = c;
    ROLE_TABS.forEach((tab) => {
      const el = document.querySelector(`[data-count="${tab.key}"]`);
      if (el) el.textContent = counts[tab.key] ?? 0;
    });
  } catch {
    // Tile counts are a nice-to-have badge, not core functionality — a
    // failed fetch shouldn't block the actual queue from loading.
  }
}

/* ---------------- Normalizing the two data sources into one shape ---------------- */

function normalizeRegistration(u) {
  return {
    kind: "registration",
    id: u.id,
    role: u.role,
    name: fullName(u),
    email: u.email,
    contact: u.contact_no || "—",
    status: u.status,
    created_at: u.created_at,
    raw: u,
  };
}

function normalizeSellerApplication(a) {
  return {
    kind: "seller_application",
    id: a.id,
    role: "seller",
    name: fullName(a.user),
    email: a.user?.email || "—",
    contact: a.user?.contact_no || "—",
    status: a.status,
    created_at: a.created_at,
    raw: a,
  };
}

async function load() {
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = skeletonRows(6);
  document.getElementById("filterHint").textContent = "";
  clearSelection();

  try {
    if (state.role === "seller") {
      const json = await api.get(`/admin/seller-applications?${sellerParams().toString()}`);
      const { items, meta } = normalizePaginated(json);
      renderTable(items.map(normalizeSellerApplication), meta?.total);
      renderPagination(meta);
    } else if (state.role === "all") {
      const [regJson, sellerJson] = await Promise.all([
        api.get(`/admin/registrations?${registrationParams().toString()}`),
        api.get(`/admin/seller-applications?${sellerParams().toString()}`),
      ]);
      const reg = normalizePaginated(regJson);
      const seller = normalizePaginated(sellerJson);
      const merged = [
        ...reg.items.map(normalizeRegistration),
        ...seller.items.map(normalizeSellerApplication),
      ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      const combinedTotal = (reg.meta?.total ?? reg.items.length) + (seller.meta?.total ?? seller.items.length);
      renderTable(merged, combinedTotal);
      // Two independently-paginated sources can't produce one exact page
      // count, so "All" shows a simple Previous/Next based on whichever
      // source still has more pages left, rather than a precise total.
      renderPagination(mergedMeta(reg.meta, seller.meta));
    } else {
      const json = await api.get(`/admin/registrations?${registrationParams().toString()}`);
      const { items, meta } = normalizePaginated(json);
      renderTable(items.map(normalizeRegistration), meta?.total);
      renderPagination(meta);
    }
  } catch (err) {
    tbody.innerHTML = emptyStateRow(6, { title: "Couldn't load applicants", subtitle: err.message || "Something went wrong. Try again." });
  }
}

function registrationParams() {
  const params = new URLSearchParams();
  if (state.status) params.set("status", state.status);
  if (state.role && state.role !== "all") params.set("role", state.role);
  if (state.search) params.set("search", state.search);
  params.set("page", state.page);
  return params;
}

function sellerParams() {
  const params = new URLSearchParams();
  params.set("status", sellerStatusFor(state.status));
  if (state.search) params.set("search", state.search);
  params.set("page", state.page);
  return params;
}

function mergedMeta(regMeta, sellerMeta) {
  const hasNext = (regMeta?.current_page ?? 1) < (regMeta?.last_page ?? 1)
    || (sellerMeta?.current_page ?? 1) < (sellerMeta?.last_page ?? 1);
  return {
    current_page: state.page,
    last_page: hasNext ? state.page + 1 : state.page,
    total: (regMeta?.total ?? 0) + (sellerMeta?.total ?? 0),
  };
}

// Bulk select only makes sense while every visible row shares the same
// pending status (the Pending pill) — Approved/Rejected tabs are a read
// history, not a queue to act on, so the checkbox column only appears there.
// Fills the space next to the search box (previously an empty flex spacer)
// with a live "N applicants" readout instead of leaving it blank.
function updateFilterHint(shownCount, total) {
  const el = document.getElementById("filterHint");
  if (!el) return;
  if (!shownCount) { el.textContent = ""; return; }
  const count = total != null ? total : shownCount;
  el.textContent = `${count} applicant${count === 1 ? "" : "s"}${total != null && total !== shownCount ? ` · ${shownCount} shown` : ""}`;
}

function bulkEligible() {
  return state.status === "pending";
}

function renderTable(items, total) {
  const tbody = document.getElementById("tbody");
  rowIndex = new Map(items.map((item) => [`${item.kind}:${item.id}`, item]));
  document.getElementById("thCheckCell").hidden = !bulkEligible();
  updateFilterHint(items.length, total);

  if (!items.length) {
    tbody.innerHTML = emptyStateRow(bulkEligible() ? 7 : 6, {
      title: "No applicants match these filters",
      subtitle: "Try a different role, status, or search term.",
    });
    updateBulkToolbar();
    return;
  }
  tbody.innerHTML = items
    .map((item) => {
      const key = `${item.kind}:${item.id}`;
      const checkCell = bulkEligible()
        ? `<td class="th-check"><input type="checkbox" class="row-check" data-key="${key}" ${selected.has(key) ? "checked" : ""} aria-label="Select ${escapeHtml(item.name)}"></td>`
        : "";
      return `
      <tr>
        ${checkCell}
        <td>
          <div class="cell-applicant">
            <span class="avatar-chip">${escapeHtml(initialsFor(item.name))}</span>
            <div>
              <div class="cell-name">${escapeHtml(item.name)}</div>
              <div class="cell-sub">${escapeHtml(item.email)}</div>
            </div>
          </div>
        </td>
        <td>${roleBadge(item.role)}</td>
        <td>${escapeHtml(item.contact)}</td>
        <td class="cell-sub">${formatDate(item.created_at)}</td>
        <td>${statusBadge(item.status)}</td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-sm btn-outline" data-view="${key}">View</button>
            ${item.status === "pending" ? `
              <button class="btn btn-sm btn-teal" data-approve="${key}">Approve</button>
              <button class="btn btn-sm btn-chili" data-reject="${key}">Reject</button>
            ` : ""}
          </div>
        </td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewApplicant(rowIndex.get(b.dataset.view))));
  tbody.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => approveApplicant(rowIndex.get(b.dataset.approve))));
  tbody.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => rejectApplicant(rowIndex.get(b.dataset.reject))));
  tbody.querySelectorAll(".row-check").forEach((cb) => cb.addEventListener("change", () => {
    cb.checked ? selected.add(cb.dataset.key) : selected.delete(cb.dataset.key);
    updateBulkToolbar();
  }));

  const selectAll = document.getElementById("selectAll");
  if (selectAll) {
    selectAll.checked = items.length > 0 && items.every((i) => selected.has(`${i.kind}:${i.id}`));
    selectAll.onchange = () => {
      items.forEach((i) => {
        const key = `${i.kind}:${i.id}`;
        selectAll.checked ? selected.add(key) : selected.delete(key);
      });
      renderTable(items, total);
    };
  }
  updateBulkToolbar();
}

/* ---------------- Bulk selection ---------------- */

function clearSelection() {
  selected.clear();
  updateBulkToolbar();
}

function updateBulkToolbar() {
  const bar = document.getElementById("bulkToolbar");
  const count = selected.size;
  bar.hidden = count === 0;
  document.getElementById("bulkCount").textContent = `${count} selected`;
}

document.getElementById("bulkClear").addEventListener("click", () => {
  clearSelection();
  document.querySelectorAll(".row-check").forEach((cb) => (cb.checked = false));
  const selectAll = document.getElementById("selectAll");
  if (selectAll) selectAll.checked = false;
});

document.getElementById("bulkApprove").addEventListener("click", () => {
  const items = [...selected].map((key) => rowIndex.get(key)).filter(Boolean);
  if (!items.length) return;
  confirmSimple({
    title: `Approve ${items.length} applicant${items.length > 1 ? "s" : ""}?`,
    description: "Each will be notified by email and can sign in (or start selling) immediately.",
    confirmLabel: "Approve all",
    tone: "teal",
    stampText: "Approved",
    onConfirm: async () => {
      const results = await Promise.allSettled(items.map((item) =>
        api.post(item.kind === "seller_application" ? `/admin/seller-applications/${item.id}/approve` : `/admin/registrations/${item.id}/approve`)
      ));
      const failed = results.filter((r) => r.status === "rejected").length;
      toast(failed ? `Approved ${items.length - failed} of ${items.length}. ${failed} failed.` : `Approved ${items.length} applicants.`, failed ? "error" : "success");
      load();
      loadCounts();
    },
  });
});

document.getElementById("bulkReject").addEventListener("click", () => {
  const items = [...selected].map((key) => rowIndex.get(key)).filter(Boolean);
  if (!items.length) return;
  confirmWithNote({
    title: `Reject ${items.length} applicant${items.length > 1 ? "s" : ""}?`,
    description: "The same reason is sent to everyone selected.",
    fieldLabel: "Reason",
    fieldPlaceholder: "Why are these applications being rejected?",
    confirmLabel: "Reject all",
    tone: "chili",
    stampText: "Rejected",
    onConfirm: async (reason) => {
      const results = await Promise.allSettled(items.map((item) =>
        api.post(item.kind === "seller_application" ? `/admin/seller-applications/${item.id}/reject` : `/admin/registrations/${item.id}/reject`, { reason })
      ));
      const failed = results.filter((r) => r.status === "rejected").length;
      toast(failed ? `Rejected ${items.length - failed} of ${items.length}. ${failed} failed.` : `Rejected ${items.length} applicants.`, failed ? "error" : "success");
      load();
      loadCounts();
    },
  });
});

function renderPagination(meta) {
  const el = document.getElementById("pagination");
  if (!meta || !meta.last_page || meta.last_page <= 1) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `
    <span>Page ${meta.current_page} of ${meta.last_page}${meta.total != null ? ` · ${meta.total} total` : ""}</span>
    <div class="page-controls">
      <button class="btn btn-sm btn-outline" id="prevPage" ${meta.current_page <= 1 ? "disabled" : ""}>Previous</button>
      <button class="btn btn-sm btn-outline" id="nextPage" ${meta.current_page >= meta.last_page ? "disabled" : ""}>Next</button>
    </div>
  `;
  document.getElementById("prevPage")?.addEventListener("click", () => { state.page = Math.max(1, state.page - 1); load(); });
  document.getElementById("nextPage")?.addEventListener("click", () => { state.page += 1; load(); });
}

/* ---------------- View modal ---------------- */

async function viewApplicant(item) {
  if (!item) return;
  openModal((box) => { box.innerHTML = `<div class="modal-body" style="padding-top:24px"><div class="empty-state">Loading applicant…</div></div>`; }, { wide: true });
  try {
    if (item.kind === "seller_application") {
      const { application } = await api.get(`/admin/seller-applications/${item.id}`);
      renderSellerApplicationModal(application);
    } else {
      const { user } = await api.get(`/admin/registrations/${item.id}`);
      renderRegistrationModal(user);
    }
  } catch (err) {
    toast(err.message || "Failed to load applicant.", "error");
    closeModal();
  }
}

function renderRegistrationModal(u) {
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
          ${u.documents ? `<div class="kv-row"><span class="k">Documents</span><span class="v"><div class="doc-preview-list">${Object.entries(u.documents).map(([k, v]) => renderDocumentPreview(ID_TYPE_LABELS[k] || k, v)).filter(Boolean).join("") || "—"}</div></span></div>` : ""}
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
    wireDocumentPreviews(box);
    const item = { kind: "registration", id: u.id };
    box.querySelector("[data-modal-approve]")?.addEventListener("click", () => approveApplicant(item));
    box.querySelector("[data-modal-reject]")?.addEventListener("click", () => rejectApplicant(item));
  }, { wide: true });
}

function renderSellerApplicationModal(a) {
  const u = a.user || {};
  const addr = u.address;
  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>${escapeHtml(fullNameWithMiddle(u))}</h3>
          <p>${escapeHtml(u.email || "—")} · Applied to become a Seller</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="kv-list">
          <div class="kv-row"><span class="k">Status</span><span class="v">${statusBadge(a.status)}</span></div>
          <div class="kv-row"><span class="k">Applied on</span><span class="v">${formatDateTime(a.created_at)}</span></div>
          <div class="kv-row"><span class="k">Contact number</span><span class="v">${escapeHtml(u.contact_no || "—")}</span></div>
          ${addr ? `<div class="kv-row"><span class="k">Address</span><span class="v">${escapeHtml([addr.house_number, addr.street, addr.barangay, addr.municipality, addr.province, addr.region].filter(Boolean).join(", "))}</span></div>` : ""}
          <div class="kv-row"><span class="k">Business name</span><span class="v">${escapeHtml(a.business_name)}</span></div>
          <div class="kv-row"><span class="k">Line of business</span><span class="v">${escapeHtml(a.line_of_business)}</span></div>
          <div class="kv-row"><span class="k">Documents</span><span class="v"><div class="doc-preview-list">${renderDocumentPreview("Business Permit", a.permit_url) || "—"}</div></span></div>
          ${a.status === "rejected" && a.rejection_reason ? `<div class="kv-row"><span class="k">Rejection reason</span><span class="v">${escapeHtml(a.rejection_reason)}</span></div>` : ""}
        </div>
      </div>
      <div class="modal-footer">
        ${a.status === "pending" ? `
          <button type="button" class="btn btn-chili" data-modal-reject>Reject</button>
          <button type="button" class="btn btn-teal" data-modal-approve>Approve</button>
        ` : `<button type="button" class="btn btn-outline" data-close>Close</button>`}
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    wireDocumentPreviews(box);
    const item = { kind: "seller_application", id: a.id };
    box.querySelector("[data-modal-approve]")?.addEventListener("click", () => approveApplicant(item));
    box.querySelector("[data-modal-reject]")?.addEventListener("click", () => rejectApplicant(item));
  }, { wide: true });
}

/* ---------------- Actions ---------------- */

function approveApplicant(item) {
  if (!item) return;
  const isSeller = item.kind === "seller_application";
  confirmSimple({
    title: "Approve this applicant?",
    description: isSeller
      ? "Their account becomes a Seller and they can start listing products immediately."
      : "They'll be notified by email and can sign in immediately.",
    confirmLabel: "Approve",
    tone: "teal",
    stampText: "Approved",
    onConfirm: async () => {
      try {
        const endpoint = isSeller ? `/admin/seller-applications/${item.id}/approve` : `/admin/registrations/${item.id}/approve`;
        await api.post(endpoint);
        toast(isSeller ? "Seller application approved." : "Applicant approved.", "success");
        load();
        loadCounts();
      } catch (err) {
        throw new Error(err instanceof ApiError ? err.message : "Failed to approve applicant.");
      }
    },
  });
}

function rejectApplicant(item) {
  if (!item) return;
  const isSeller = item.kind === "seller_application";
  confirmWithNote({
    title: "Reject this applicant?",
    description: "They'll be notified by email with your reason.",
    fieldLabel: "Reason",
    fieldPlaceholder: "Why is this application being rejected?",
    confirmLabel: "Reject applicant",
    tone: "chili",
    stampText: "Rejected",
    onConfirm: async (reason) => {
      const endpoint = isSeller ? `/admin/seller-applications/${item.id}/reject` : `/admin/registrations/${item.id}/reject`;
      await api.post(endpoint, { reason });
      toast(isSeller ? "Seller application rejected." : "Applicant rejected.", "success");
      load();
      loadCounts();
    },
  });
}
