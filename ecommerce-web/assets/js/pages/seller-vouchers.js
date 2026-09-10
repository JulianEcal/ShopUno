// assets/js/pages/seller-vouchers.js
// Seller's discount codes: a small table (GET /seller/vouchers — no
// pagination, sellers don't run hundreds of these at once) plus a create
// modal and an edit modal. 'code' and 'type' are set once at creation and
// aren't editable afterward (UpdateVoucherRequest doesn't accept them), so
// the edit modal shows them read-only and only lets the seller adjust the
// terms (value, minimum order, use cap, expiry). Activating/deactivating is
// a one-click row action, same pattern as Products' archive/restore.

import { api } from "../api.js";
import { initShell } from "../partials/seller-shell.js";
import { escapeHtml, money, formatDateTime, toast, openModal, closeModal, debounce } from "../lib/ui.js";

const content = initShell({ page: "vouchers", title: "Vouchers", eyebrow: "Seller console" });

content.innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Your vouchers</h3>
        <p>Discount codes buyers can apply to orders from your shop.</p>
      </div>
      <button type="button" class="btn btn-primary" id="addVoucherBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Create voucher
      </button>
    </div>
    <div class="voucher-stats" id="voucherStats" style="display:flex;flex-wrap:wrap;gap:8px;padding:16px 22px 0;margin-bottom:16px;"></div>
    <div class="filter-bar">
      <div class="msg-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search" id="fSearch" placeholder="Search by code…">
      </div>
      <select id="fStatus">
        <option value="">All vouchers</option>
        <option value="active">Active</option>
        <option value="scheduled">Scheduled</option>
        <option value="inactive">Inactive</option>
        <option value="expired">Expired</option>
        <option value="used_up">Used up</option>
      </select>
      <div class="filter-spacer"></div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Code</th><th>Discount</th><th>Min. order</th><th>Uses</th><th>Valid</th><th>Status</th><th></th></tr>
        </thead>
        <tbody id="tbody">
          <tr><td colspan="7" class="table-loading">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  </div>
`;

let vouchers = [];
const state = { status: "", search: "" };

document.getElementById("fStatus").addEventListener("change", (e) => {
  state.status = e.target.value;
  renderTable();
});
document.getElementById("fSearch").addEventListener("input", debounce((e) => {
  state.search = e.target.value.trim().toLowerCase();
  renderTable();
}, 200));
document.getElementById("addVoucherBtn").addEventListener("click", () => openAddModal());

load();

const url = new URLSearchParams(location.search);
if (url.get("new") === "1") openAddModal();

/* ---------------- list ---------------- */
async function load() {
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = `<tr><td colspan="7" class="table-loading">Loading…</td></tr>`;
  try {
    const json = await api.get("/seller/vouchers");
    vouchers = json?.data || [];
    renderTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${escapeHtml(err.message || "Failed to load your vouchers.")}</td></tr>`;
  }
}

/** Compared against the exact current moment (not just today's midnight) —
 * valid_from/valid_until can carry a specific time of day now, so a voucher
 * scheduled for 6 PM today is still "scheduled" at 9 AM, and one expiring
 * at 9 AM today is already "expired" by 6 PM. Matches the backend's own
 * now()-based comparisons in Voucher::isValidFor(). */
function voucherStatus(v) {
  const now = new Date();
  if (!v.is_active) return { key: "inactive", label: "Inactive", badgeClass: "archived" };
  if (v.valid_until && new Date(v.valid_until) < now) {
    return { key: "expired", label: "Expired", badgeClass: "cancelled" };
  }
  if (v.max_uses !== null && v.used_count >= v.max_uses) {
    // Its own neutral gray, not the same red as Expired — running out of
    // redemptions and running out of time are different situations, and
    // sharing a color with Expired made them read as the same status.
    return { key: "used_up", label: "Used up", badgeClass: "archived" };
  }
  if (v.valid_from && new Date(v.valid_from) > now) {
    return { key: "scheduled", label: "Scheduled", badgeClass: "scheduled" };
  }
  return { key: "active", label: "Active", badgeClass: "active" };
}

/** "3h", "2d" — the magnitude of time between now and a target datetime,
 * for the small "in 3h" / "ends in 2d" notes under the Valid column and in
 * the schedule preview under the create/edit form's date fields. */
function relativeMagnitude(target) {
  const diffMs = Math.abs(new Date(target).getTime() - Date.now());
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}

/** e.g. "20% off" plus, when set, the Shopee-style cap and per-buyer note
 * underneath — "up to ₱1,000 · 1 per buyer". Cap only ever applies to
 * percent vouchers (see Voucher::discountFor on the backend). */
function discountLabel(v) {
  const headline = v.type === "percent" ? `${Number(v.value)}% off` : `${money(v.value)} off`;
  const notes = [];
  if (v.type === "percent" && v.max_discount_amount) notes.push(`up to ${money(v.max_discount_amount)}`);
  if (v.per_user_limit) notes.push(`${v.per_user_limit} per buyer`);
  if (!notes.length) return headline;
  return `${headline}<div class="text-muted" style="font-size:.85em;">${escapeHtml(notes.join(" · "))}</div>`;
}

/** "From Sep 20, 9:00 AM" / "Until Oct 1, 11:59 PM" / a from–until range /
 * "No expiry" — plus, when it's relevant, a small muted note underneath:
 * "starts in 3h" while scheduled, or "ends in 2h" once a voucher is within
 * a day of its expiry, so a seller doesn't have to do the date math. */
function validityLabel(v, status) {
  let headline;
  if (v.valid_from && v.valid_until) headline = `${formatDateTime(v.valid_from)} – ${formatDateTime(v.valid_until)}`;
  else if (v.valid_from) headline = `From ${formatDateTime(v.valid_from)}`;
  else if (v.valid_until) headline = `Until ${formatDateTime(v.valid_until)}`;
  else return `<span class="text-muted">No expiry</span>`;

  let note = "";
  if (status.key === "scheduled") {
    note = `starts in ${relativeMagnitude(v.valid_from)}`;
  } else if (status.key === "active" && v.valid_until) {
    const msLeft = new Date(v.valid_until).getTime() - Date.now();
    if (msLeft > 0 && msLeft < 24 * 60 * 60 * 1000) note = `ends in ${relativeMagnitude(v.valid_until)}`;
  }
  if (!note) return headline;
  return `${headline}<div class="text-muted" style="font-size:.85em;">${note}</div>`;
}

function renderTable() {
  renderStats();

  const tbody = document.getElementById("tbody");
  let filtered = state.status
    ? vouchers.filter((v) => voucherStatus(v).key === state.status)
    : vouchers;
  if (state.search) {
    filtered = filtered.filter((v) => v.code.toLowerCase().includes(state.search));
  }

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${vouchers.length ? "No vouchers match this filter." : "No vouchers yet — create one to run your first promotion."}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((v) => {
      const status = voucherStatus(v);
      return `
      <tr>
        <td class="mono">${escapeHtml(v.code)}</td>
        <td>${discountLabel(v)}</td>
        <td>${v.min_order_amount ? money(v.min_order_amount) : `<span class="text-muted">No minimum</span>`}</td>
        <td class="mono">${v.used_count}${v.max_uses !== null ? ` / ${v.max_uses}` : ""}</td>
        <td class="mono">${validityLabel(v, status)}</td>
        <td><span class="badge badge-${status.badgeClass}">${status.label}</span></td>
        <td>
          <div class="cell-actions">
            <button class="btn btn-sm btn-outline" data-edit="${v.id}">Edit</button>
            ${v.is_active
              ? `<button class="btn btn-sm btn-caution" data-deactivate="${v.id}">Deactivate</button>`
              : `<button class="btn btn-sm btn-outline" data-activate="${v.id}">Activate</button>`}
          </div>
        </td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openEditModal(b.dataset.edit)));
  tbody.querySelectorAll("[data-deactivate]").forEach((b) => b.addEventListener("click", () => setActive(b.dataset.deactivate, false)));
  tbody.querySelectorAll("[data-activate]").forEach((b) => b.addEventListener("click", () => setActive(b.dataset.activate, true)));
}

/** Small at-a-glance counts above the table — how many vouchers are live
 * right now, queued up to start, or already expired — clicking one jumps
 * straight to that filter instead of hunting through the dropdown. Hidden
 * entirely once there are no vouchers to summarize.
 *
 * "Ending soon" is a property of an active voucher, not a separate bucket
 * — SEPTSALE being both active AND ending in the next 24h is one voucher,
 * not two. Showing it as its own pill made the chip counts add up to more
 * than the number of rows in the table (looked like a voucher was
 * missing). It's folded into the Active chip's label instead, so the
 * numbers always match what's actually listed below. */
function renderStats() {
  const box = document.getElementById("voucherStats");
  if (!vouchers.length) {
    box.innerHTML = "";
    return;
  }
  const counts = { active: 0, scheduled: 0, expired: 0, used_up: 0, inactive: 0 };
  let endingSoon = 0;
  vouchers.forEach((v) => {
    const s = voucherStatus(v);
    counts[s.key] = (counts[s.key] || 0) + 1;
    if (s.key === "active" && v.valid_until) {
      const msLeft = new Date(v.valid_until).getTime() - Date.now();
      if (msLeft > 0 && msLeft < 24 * 60 * 60 * 1000) endingSoon++;
    }
  });
  const chips = [
    // Ending-soon is folded into this chip's *label*, not its color — it's
    // still an active voucher (green), not a lapsed one. Swapping it to
    // out_of_stock's red made it indistinguishable from the Expired chip
    // right next to it, which read as a bug more than a warning.
    counts.active && {
      key: "active",
      label: endingSoon ? `${counts.active} active (${endingSoon} ending soon)` : `${counts.active} active`,
      cls: "active",
    },
    counts.scheduled && { key: "scheduled", label: `${counts.scheduled} scheduled`, cls: "scheduled" },
    counts.expired && { key: "expired", label: `${counts.expired} expired`, cls: "cancelled" },
    counts.used_up && { key: "used_up", label: `${counts.used_up} used up`, cls: "archived" },
    counts.inactive && { key: "inactive", label: `${counts.inactive} inactive`, cls: "archived" },
  ].filter(Boolean);

  box.innerHTML = chips
    .map((c) => `<button type="button" class="badge badge-${c.cls}" data-stat="${c.key}" style="border:none;cursor:pointer;">${c.label}</button>`)
    .join("");
  box.querySelectorAll("[data-stat]").forEach((b) => b.addEventListener("click", () => {
    document.getElementById("fStatus").value = b.dataset.stat;
    state.status = b.dataset.stat;
    renderTable();
  }));
}

async function setActive(id, isActive) {
  try {
    const { voucher } = await api.patch(`/seller/vouchers/${id}`, { is_active: isActive });
    vouchers = vouchers.map((v) => (String(v.id) === String(id) ? voucher : v));
    toast(isActive ? "Voucher activated." : "Voucher deactivated.", "success");
    renderTable();
  } catch (err) {
    toast(err.message || "Couldn't update this voucher.", "error");
  }
}

/* ---------------- create ---------------- */
function openAddModal() {
  openModal((box) => {
    // Wide: with the code/type/value/cap fields plus a from–until row, the
    // default 440px modal either clips the datetime-local inputs (see
    // openEditModal, which stacks them) or forces the whole form to scroll.
    // The create form has more fields than edit, so give it the extra room
    // instead — 680px comfortably fits the schedule row side by side and
    // the rest of the form without a scrollbar on typical screens.
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>Create a voucher</h3>
          <p>Buyers enter the code at checkout to apply the discount.</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <form id="addVoucherForm">
          <div class="field-group">
            <label for="vf-code">Code</label>
            <input type="text" id="vf-code" name="code" maxlength="30" required placeholder="e.g. WELCOME10" style="text-transform:uppercase;">
            <span class="hint">Letters, numbers, dashes and underscores only.</span>
          </div>
          <div class="field-group">
            <label for="vf-type">Discount type</label>
            <select id="vf-type" name="type" required>
              <option value="percent">Percent off</option>
              <option value="fixed">Fixed amount off</option>
            </select>
          </div>
          <div class="field-group">
            <label for="vf-value" id="vf-value-label">Value (%)</label>
            <input type="number" id="vf-value" name="value" min="0.01" max="100" step="0.01" required>
          </div>
          <div class="field-group" id="vf-cap-group">
            <label for="vf-cap">Max discount (₱)</label>
            <input type="number" id="vf-cap" name="max_discount_amount" min="0.01" step="0.01" placeholder="No cap">
            <span class="hint">Caps the peso amount a % voucher can ever take off — e.g. "20% off, up to ₱1,000".</span>
          </div>
          <div class="field-group">
            <label for="vf-min">Minimum order amount (₱)</label>
            <input type="number" id="vf-min" name="min_order_amount" min="0" step="0.01" placeholder="No minimum">
          </div>
          <div class="field-row">
            <div class="field-group">
              <label for="vf-max">Max uses (total)</label>
              <input type="number" id="vf-max" name="max_uses" min="1" step="1" placeholder="Unlimited">
            </div>
            <div class="field-group">
              <label for="vf-per-user">Uses per buyer</label>
              <input type="number" id="vf-per-user" name="per_user_limit" min="1" step="1" placeholder="Unlimited">
            </div>
          </div>
          <div class="field-row">
            <div class="field-group">
              <label for="vf-from">Starts at</label>
              <input type="datetime-local" id="vf-from" name="valid_from" min="${localDateTimeValue()}">
              <span class="hint">Leave blank to start immediately. Times are your local time.</span>
            </div>
            <div class="field-group">
              <label for="vf-until">Ends at</label>
              <input type="datetime-local" id="vf-until" name="valid_until" min="${localDateTimeValue(5)}">
              <span class="hint">Leave blank for no expiry.</span>
            </div>
          </div>
          <p class="hint" id="vf-schedule-summary" style="margin:-8px 0 16px;"></p>
          <div class="field-error" data-error hidden></div>
        </form>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-close>Cancel</button>
        <button type="submit" form="addVoucherForm" class="btn btn-primary" id="addVoucherSubmit">Create voucher</button>
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));

    const form = box.querySelector("#addVoucherForm");
    wireTypeValueLabel(form);
    wireScheduleSummary(form, box.querySelector("#vf-schedule-summary"));

    const errorBox = box.querySelector("[data-error]");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const payload = readCreateFields(form);
      const submitBtn = document.getElementById("addVoucherSubmit");
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="spinner"></span>`;
      try {
        const { voucher } = await api.post("/seller/vouchers", payload);
        vouchers = [voucher, ...vouchers];
        toast("Voucher created.", "success");
        renderTable();
        closeModal();
      } catch (err) {
        errorBox.textContent = err.message || "Couldn't create this voucher.";
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = "Create voucher";
      }
    });
  }, { wide: true });
}

/** "YYYY-MM-DDTHH:MM" in the browser's local time (what a <input
 * type="datetime-local"> element expects/produces) — offsetMinutes shifts
 * from right now, e.g. +5 for a "must be a few minutes out" min bound. */
function localDateTimeValue(offsetMinutes = 0) {
  const d = new Date(Date.now() + offsetMinutes * 60000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converts an ISO datetime from the API into the local "YYYY-MM-DDTHH:MM"
 * shape a datetime-local input needs to show it pre-filled, e.g. when
 * opening the edit modal on a voucher that already has a schedule. */
function toLocalDateTimeValue(iso) {
  if (!iso) return "";
  return localDateTimeValue(Math.round((new Date(iso).getTime() - Date.now()) / 60000));
}

/** Live one-line summary of the schedule as the seller edits the two
 * datetime fields — "Starts immediately · never expires" down to
 * "Starts Sep 20, 9:00 AM · ends Oct 1, 11:59 PM" — so the effect of what
 * they just typed is legible without doing the reading themselves. */
function wireScheduleSummary(form, summaryEl) {
  const fromInput = form.querySelector('[name="valid_from"]');
  const untilInput = form.querySelector('[name="valid_until"]');
  const sync = () => {
    // Keep "ends at" from being set earlier than "starts at" in the first
    // place, rather than only catching it after submit.
    if (fromInput.value) untilInput.min = fromInput.value;
    const from = fromInput.value ? formatDateTime(fromInput.value) : "immediately";
    const until = untilInput.value ? formatDateTime(untilInput.value) : "never expires";
    summaryEl.textContent = fromInput.value
      ? `Starts ${from} · ${untilInput.value ? `ends ${until}` : until}`
      : `Starts immediately · ${untilInput.value ? `ends ${until}` : until}`;
  };
  fromInput.addEventListener("input", sync);
  untilInput.addEventListener("input", sync);
  sync();
}

/** Syncs the value field's label/max to the discount type, and hides the
 * "Max discount" cap field entirely for fixed-amount vouchers — it only
 * ever does anything for percent ones (see Voucher::discountFor). */
function wireTypeValueLabel(form, capGroupSelector = "#vf-cap-group") {
  const typeSelect = form.querySelector('[name="type"]');
  const valueInput = form.querySelector('[name="value"]');
  const valueLabel = form.querySelector("#vf-value-label");
  const capGroup = form.querySelector(capGroupSelector);
  const capInput = capGroup?.querySelector('[name="max_discount_amount"]');
  const sync = () => {
    const isPercent = typeSelect.value === "percent";
    valueLabel.textContent = isPercent ? "Value (%)" : "Value (₱)";
    if (isPercent) valueInput.max = "100";
    else valueInput.removeAttribute("max");
    if (capGroup) {
      capGroup.hidden = !isPercent;
      if (!isPercent && capInput) capInput.value = "";
    }
  };
  typeSelect.addEventListener("change", sync);
  sync();
}

function readCreateFields(form) {
  const data = new FormData(form);
  return {
    code: data.get("code")?.trim().toUpperCase(),
    type: data.get("type"),
    value: data.get("value"),
    max_discount_amount: data.get("type") === "percent" ? data.get("max_discount_amount") || null : null,
    min_order_amount: data.get("min_order_amount") || null,
    valid_from: data.get("valid_from") || null,
    max_uses: data.get("max_uses") || null,
    per_user_limit: data.get("per_user_limit") || null,
    valid_until: data.get("valid_until") || null,
  };
}

/* ---------------- edit ---------------- */
function openEditModal(id) {
  const v = vouchers.find((x) => String(x.id) === String(id));
  if (!v) return;

  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>Edit ${escapeHtml(v.code)}</h3>
          <p>${v.type === "percent" ? "Percent off" : "Fixed amount off"} · code and type can't be changed after creation.</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <form id="editVoucherForm">
          <div class="field-group">
            <label for="vef-value">Value ${v.type === "percent" ? "(%)" : "(₱)"}</label>
            <input type="number" id="vef-value" name="value" min="0.01" ${v.type === "percent" ? 'max="100"' : ""} step="0.01" required value="${v.value}">
          </div>
          ${v.type === "percent" ? `
          <div class="field-group">
            <label for="vef-cap">Max discount (₱)</label>
            <input type="number" id="vef-cap" name="max_discount_amount" min="0.01" step="0.01" placeholder="No cap" value="${v.max_discount_amount ?? ""}">
            <span class="hint">Caps the peso amount this % voucher can ever take off.</span>
          </div>` : ""}
          <div class="field-group">
            <label for="vef-min">Minimum order amount (₱)</label>
            <input type="number" id="vef-min" name="min_order_amount" min="0" step="0.01" placeholder="No minimum" value="${v.min_order_amount ?? ""}">
          </div>
          <div class="field-row">
            <div class="field-group">
              <label for="vef-max">Max uses (total)</label>
              <input type="number" id="vef-max" name="max_uses" min="1" step="1" placeholder="Unlimited" value="${v.max_uses ?? ""}">
              <span class="hint">${v.used_count} used so far.</span>
            </div>
            <div class="field-group">
              <label for="vef-per-user">Uses per buyer</label>
              <input type="number" id="vef-per-user" name="per_user_limit" min="1" step="1" placeholder="Unlimited" value="${v.per_user_limit ?? ""}">
            </div>
          </div>
          <div class="field-group">
            <label for="vef-from">Starts at</label>
            <input type="datetime-local" id="vef-from" name="valid_from" value="${toLocalDateTimeValue(v.valid_from)}">
            <span class="hint">Leave blank to start immediately. Times are your local time.</span>
          </div>
          <div class="field-group">
            <label for="vef-until">Ends at</label>
            <input type="datetime-local" id="vef-until" name="valid_until" value="${toLocalDateTimeValue(v.valid_until)}">
            <span class="hint">Leave blank for no expiry.</span>
          </div>
          <p class="hint" id="vef-schedule-summary" style="margin:-8px 0 16px;"></p>
          <div class="field-error" data-error hidden></div>
        </form>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-close>Cancel</button>
        <button type="submit" form="editVoucherForm" class="btn btn-primary" id="editVoucherSubmit">Save changes</button>
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));

    const form = box.querySelector("#editVoucherForm");
    wireScheduleSummary(form, box.querySelector("#vef-schedule-summary"));

    const errorBox = box.querySelector("[data-error]");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const data = new FormData(form);
      const payload = {
        value: data.get("value"),
        max_discount_amount: v.type === "percent" ? data.get("max_discount_amount") || null : null,
        min_order_amount: data.get("min_order_amount") || null,
        valid_from: data.get("valid_from") || null,
        max_uses: data.get("max_uses") || null,
        per_user_limit: data.get("per_user_limit") || null,
        valid_until: data.get("valid_until") || null,
      };
      const submitBtn = document.getElementById("editVoucherSubmit");
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="spinner"></span>`;
      try {
        const { voucher } = await api.patch(`/seller/vouchers/${v.id}`, payload);
        vouchers = vouchers.map((x) => (String(x.id) === String(v.id) ? voucher : x));
        toast("Voucher updated.", "success");
        renderTable();
        closeModal();
      } catch (err) {
        errorBox.textContent = err.message || "Couldn't save these changes.";
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = "Save changes";
      }
    });
  });
}
