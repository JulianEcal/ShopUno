// assets/js/pages/buyer-account.js
// Buyer account settings (buyer/account.html). Four things live here:
//   1. A read-only summary card (name, badges, quick facts, signed link to
//      the buyer's uploaded verification ID via GET /me's `documents.id`).
//   2. Profile tab: name, middle initial, username, sex, birthday, email,
//      contact number, all saved together through PATCH /me. Note:
//      name/email/sex/birthday editing here intentionally overrides an
//      earlier "identity fields are locked" design decision (see
//      UpdateProfileRequest on the backend) — changing email resets
//      email_verified_at server-side since a new address is, by
//      definition, unverified again, and changing birthday recomputes
//      `age` server-side rather than trusting a client-sent value.
//      Username is a new nullable/unique column (see migration
//      2024_01_01_000032_add_username_to_users_table).
//   3. Address tab: a full Shopee-style address book — add, edit, delete,
//      and set-default, backed by /addresses (see Buyer\AddressController).
//      This is also exactly what the "Change address" picker at checkout
//      (buyer-cart.js) draws from — the Region -> Province -> City ->
//      Barangay cascade and form markup are shared via lib/address-form.js
//      so this page and the checkout modal never drift apart.
//   4. Password change via PATCH /me/password.

import { api, setStoredUser } from "../api.js";
import { initShell, refreshAccountSummary } from "../partials/buyer-shell.js";
import { escapeHtml, toast, formatDate, confirmSimple, openModal, closeModal } from "../lib/ui.js";
import { addressFormFieldsHtml, bindAddressForm } from "../lib/address-form.js";

const STATUS_LABEL = { active: "Active", pending: "Pending", suspended: "Suspended", deactivated: "Deactivated", rejected: "Rejected" };
const SEX_LABEL = { male: "Male", female: "Female" };

const content = initShell({});

content.innerHTML = `
  <section class="acct-head">
    <h1>Account <em style="color:var(--chili); font-style:italic;">settings</em></h1>
    <p class="welcome-sub" style="margin-top:6px;">Manage your profile, address, and security.</p>
  </section>

  <div class="acct-layout">
    <aside class="acct-rail">
      <div class="id-badge" id="acctSummary">
        <div class="id-badge-clip"></div>

        <div class="acct-avatar-wrap" id="acctAvatarWrap">
          <div class="acct-avatar-aura"></div>
          <div class="acct-avatar-ring"></div>
          <div class="acct-avatar" id="acctAvatar">··</div>
          <button type="button" class="acct-avatar-edit-btn" id="acctAvatarEditBtn" aria-label="Change profile picture">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/></svg>
            <span class="spinner is-dark"></span>
          </button>
          <input type="file" id="acctAvatarInput" accept="image/png,image/jpeg,image/webp" hidden>
        </div>
        <button type="button" class="acct-avatar-remove" id="acctAvatarRemoveBtn" hidden>Remove photo</button>

        <h2 id="acctName">Loading…</h2>
        <div class="acct-email" id="acctEmail"></div>
        <div class="acct-badges" id="acctBadges"></div>
      </div>

      <nav class="acct-nav" id="acctNav">
        <button type="button" class="acct-nav-btn is-active" data-tab="profile">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Profile
        </button>
        <button type="button" class="acct-nav-btn" data-tab="address">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          Address
        </button>
        <button type="button" class="acct-nav-btn" data-tab="security">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Security
        </button>
        <button type="button" class="acct-nav-btn" data-tab="seller" id="acctSellerTabBtn" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 9l1.5-5h15L21 9"/><path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/></svg>
          Sell on ShopUno
          <span class="acct-nav-dot" id="acctSellerDot" hidden></span>
        </button>
      </nav>
    </aside>

    <div class="acct-panels">
      <section class="acct-panel" data-panel="profile">
        <div class="acct-panel-head"><span class="bar"></span><h3>Profile</h3></div>
        <p class="acct-panel-sub">Your basic info, and how sellers reach you about orders.</p>

        <div class="acct-info-list" id="acctInfoList"></div>
        <a href="#" id="acctDocLink" class="acct-doc-link" target="_blank" rel="noopener" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          View my uploaded ID
        </a>

        <form id="contactForm">
          <div class="acct-field-row">
            <div class="field-group">
              <label for="acctFirstName">First name</label>
              <input type="text" id="acctFirstName" placeholder="Juan">
            </div>
            <div class="field-group">
              <label for="acctLastName">Last name</label>
              <input type="text" id="acctLastName" placeholder="Dela Cruz">
            </div>
          </div>
          <div class="acct-field-row">
            <div class="field-group">
              <label for="acctMiddleInitial">Middle initial</label>
              <input type="text" id="acctMiddleInitial" placeholder="e.g. S" maxlength="5">
            </div>
            <div class="field-group">
              <label for="acctUsername">Username</label>
              <input type="text" id="acctUsername" placeholder="e.g. juan_delacruz">
            </div>
          </div>
          <div class="acct-field-row">
            <div class="field-group">
              <label for="acctSex">Sex</label>
              <select id="acctSex">
                <option value="">Select…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div class="field-group">
              <label for="acctBirthday">Birthday</label>
              <input type="date" id="acctBirthday">
            </div>
          </div>
          <div class="field-group">
            <label for="acctEmailInput">Email</label>
            <input type="email" id="acctEmailInput" placeholder="you@example.com">
          </div>
          <div class="field-group">
            <label for="acctContactNo">Mobile number</label>
            <input type="text" id="acctContactNo" placeholder="09171234567">
          </div>
          <div class="field-error" id="contactError" hidden></div>
          <div class="acct-form-foot">
            <button type="submit" class="btn btn-primary" id="contactSaveBtn">
              <span class="btn-label">Save changes</span>
              <span class="spinner"></span>
            </button>
            <span class="acct-save-msg" id="contactSaveMsg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Saved.
            </span>
          </div>
        </form>
      </section>

      <section class="acct-panel" data-panel="address" hidden>
        <div class="acct-panel-head"><span class="bar" style="background:var(--teal);"></span><h3>Address</h3></div>
        <p class="acct-panel-sub">Your saved delivery addresses — add as many as you need and pick one at checkout.</p>

        <div class="addr-list" id="acctAddressList">
          <p class="is-empty">Loading addresses…</p>
        </div>

        <button type="button" class="btn btn-outline addr-add-btn" id="acctAddAddressBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Add new address
        </button>
      </section>

      <section class="acct-panel" data-panel="security" hidden>
        <div class="acct-panel-head"><span class="bar" style="background:var(--gold-deep);"></span><h3>Security</h3></div>
        <p class="acct-panel-sub">You'll need your current password to set a new one.</p>

        <form id="passwordForm">
          <div class="field-group">
            <label for="acctCurrentPassword">Current password</label>
            <div class="pw-field">
              <input type="password" id="acctCurrentPassword" autocomplete="current-password">
              <button type="button" class="pw-toggle" data-toggle-for="acctCurrentPassword" aria-label="Show password">${eyeIcon()}</button>
            </div>
          </div>
          <div class="acct-field-row">
            <div class="field-group">
              <label for="acctNewPassword">New password</label>
              <div class="pw-field">
                <input type="password" id="acctNewPassword" autocomplete="new-password">
                <button type="button" class="pw-toggle" data-toggle-for="acctNewPassword" aria-label="Show password">${eyeIcon()}</button>
              </div>
            </div>
            <div class="field-group">
              <label for="acctConfirmPassword">Confirm new password</label>
              <div class="pw-field">
                <input type="password" id="acctConfirmPassword" autocomplete="new-password">
                <button type="button" class="pw-toggle" data-toggle-for="acctConfirmPassword" aria-label="Show password">${eyeIcon()}</button>
              </div>
            </div>
          </div>

          <div class="pw-strength" id="pwStrength" hidden>
            <div class="pw-strength-track"><div class="pw-strength-fill" id="pwStrengthFill"></div></div>
            <span class="pw-strength-label" id="pwStrengthLabel"></span>
          </div>

          <div class="field-error" id="passwordError" hidden></div>
          <div class="acct-form-foot">
            <button type="submit" class="btn btn-primary" id="passwordSaveBtn">
              <span class="btn-label">Update password</span>
              <span class="spinner"></span>
            </button>
            <span class="acct-save-msg" id="passwordSaveMsg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Updated.
            </span>
          </div>
        </form>
      </section>

      <section class="acct-panel" data-panel="seller" hidden>
        <div class="acct-panel-head"><span class="bar" style="background:var(--gold-deep);"></span><h3>Sell on ShopUno</h3></div>
        <p class="acct-panel-sub">Open your own store on the platform — list products, take orders, and reach every buyer browsing ShopUno.</p>
        <div id="sellerApplicationBody"><p class="is-empty">Loading…</p></div>
      </section>
    </div>
  </div>
`;

function eyeIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function eyeOffIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a20.3 20.3 0 0 1 4.22-5.44M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a20.3 20.3 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
}

let user = null; // current /me payload, refreshed after every successful save
let addresses = []; // this buyer's saved address book — from user.addresses, kept in sync via /addresses calls
let sellerApplication = null; // current GET /me/seller-application payload's `application` (null if never applied)

init();

async function init() {
  try {
    const res = await api.get("/me");
    user = res?.user || null;
    addresses = user?.addresses || [];
    renderSummary();
    renderAddressList();
    document.getElementById("acctFirstName").value = user?.first_name || "";
    document.getElementById("acctLastName").value = user?.last_name || "";
    document.getElementById("acctMiddleInitial").value = user?.middle_initial || "";
    document.getElementById("acctUsername").value = user?.username || "";
    document.getElementById("acctSex").value = user?.sex || "";
    document.getElementById("acctBirthday").value = user?.birthday || "";
    document.getElementById("acctEmailInput").value = user?.email || "";
    document.getElementById("acctContactNo").value = user?.contact_no || "";
  } catch (err) {
    toast(err.message || "Couldn't load your account.", "error");
  }

  // Seller application status lives outside /me, and only a buyer can ever
  // have one — a courier/admin/seller account viewing this page (unlikely,
  // but the tab exists in the shared template) just never sees the tab.
  document.getElementById("acctSellerTabBtn").hidden = user?.role !== "buyer";
  if (user?.role === "buyer") {
    try {
      const res = await api.get("/me/seller-application");
      sellerApplication = res?.application || null;
    } catch (err) {
      sellerApplication = null; // tab still renders an "apply" form on failure — never blocks the rest of the page
    }
    renderSellerTab();
    if (location.hash === "#seller") {
      document.getElementById("acctSellerTabBtn").click();
    }
  }
}

/* ---------------- tab switching ---------------- */

document.getElementById("acctNav").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  const tab = btn.dataset.tab;

  document.querySelectorAll(".acct-nav-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
  document.querySelectorAll(".acct-panel").forEach((p) => { p.hidden = p.dataset.panel !== tab; });
});

/* ---------------- avatar (photo + holographic-badge aura) ---------------- */

const avatarWrap = document.getElementById("acctAvatarWrap");
const avatarInput = document.getElementById("acctAvatarInput");

document.getElementById("acctAvatarEditBtn").addEventListener("click", () => avatarInput.click());

avatarInput.addEventListener("change", async () => {
  const file = avatarInput.files[0];
  if (!file) return;

  if (file.size > 3 * 1024 * 1024) {
    toast("That image is too large — please keep it under 3MB.", "error");
    avatarInput.value = "";
    return;
  }

  const fd = new FormData();
  fd.append("avatar", file);

  avatarWrap.classList.add("is-uploading");
  try {
    const res = await api.post("/me/avatar", fd);
    user = res?.user || user;
    setStoredUser(user);
    renderSummary();
    refreshAccountSummary();
    toast("Profile picture updated.", "success");
  } catch (err) {
    toast(err.message || "Couldn't upload your photo.", "error");
  } finally {
    avatarWrap.classList.remove("is-uploading");
    avatarInput.value = "";
  }
});

document.getElementById("acctAvatarRemoveBtn").addEventListener("click", () => {
  confirmSimple({
    title: "Remove profile picture?",
    description: "You'll go back to your initials until you upload a new one.",
    confirmLabel: "Remove photo",
    tone: "chili",
    onConfirm: async () => {
      const res = await api.delete("/me/avatar");
      user = res?.user || user;
      setStoredUser(user);
      renderSummary();
      refreshAccountSummary();
      toast("Profile picture removed.", "success");
    },
  });
});

/* ---------------- password: show/hide + strength meter ---------------- */

document.querySelectorAll(".pw-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.toggleFor);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.innerHTML = showing ? eyeIcon() : eyeOffIcon();
    btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });
});

function passwordScore(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}
const STRENGTH = [
  { width: "12%", color: "var(--chili-deep)", label: "Very weak" },
  { width: "32%", color: "var(--chili)", label: "Weak" },
  { width: "58%", color: "var(--gold-deep)", label: "Fair" },
  { width: "80%", color: "var(--teal)", label: "Good" },
  { width: "100%", color: "var(--teal-deep)", label: "Strong" },
];

const newPasswordInput = document.getElementById("acctNewPassword");
const pwStrength = document.getElementById("pwStrength");
const pwStrengthFill = document.getElementById("pwStrengthFill");
const pwStrengthLabel = document.getElementById("pwStrengthLabel");

newPasswordInput.addEventListener("input", () => {
  const pw = newPasswordInput.value;
  pwStrength.hidden = pw.length === 0;
  if (!pw) return;
  const s = STRENGTH[passwordScore(pw)];
  pwStrengthFill.style.width = s.width;
  pwStrengthFill.style.background = s.color;
  pwStrengthLabel.textContent = s.label;
});

/* ---------------- left summary card ---------------- */

function renderSummary() {
  if (!user) return;
  const initials = ((user.first_name || "?")[0] || "?") + ((user.last_name || "")[0] || "");
  const avatarEl = document.getElementById("acctAvatar");
  avatarEl.innerHTML = user.avatar_url
    ? `<img src="${escapeHtml(user.avatar_url)}" alt="">`
    : escapeHtml(initials.toUpperCase());
  document.getElementById("acctAvatarRemoveBtn").hidden = !user.avatar_url;
  document.getElementById("acctName").textContent = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Buyer";
  document.getElementById("acctEmail").textContent = user.username ? `@${user.username} · ${user.email || ""}` : user.email || "";

  document.getElementById("acctBadges").innerHTML = `
    <span class="badge badge-buyer">Buyer</span>
    <span class="badge badge-${escapeHtml(String(user.status || "").toLowerCase())}">${escapeHtml(STATUS_LABEL[user.status] || user.status || "—")}</span>
    ${user.email_verified === false ? '<span class="badge badge-pending">Email unverified</span>' : ""}
  `;

  const rows = [
    ["Sex", SEX_LABEL[user.sex] || user.sex || "—"],
    ["Birthday", user.birthday ? `${formatDate(user.birthday)}${user.age ? ` (${user.age} yrs)` : ""}` : "—"],
    ["Mobile", user.contact_no || "—"],
  ];
  document.getElementById("acctInfoList").innerHTML = rows
    .map(([k, v]) => `<div class="acct-info-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`)
    .join("");

  const docLink = document.getElementById("acctDocLink");
  if (user.documents?.id) {
    docLink.href = user.documents.id;
    docLink.hidden = false;
  } else {
    docLink.hidden = true;
  }
}

/* ---------------- address book (Address tab) ---------------- */

function addressCardHtml(a) {
  return `
    <div class="addr-card${a.is_default ? " is-default" : ""}" data-address-id="${a.id}">
      ${a.is_default ? `<span class="addr-default-badge">Default</span>` : ""}
      <div class="addr-card-label">${escapeHtml(a.label || "Address")}</div>
      <div class="addr-card-recipient">${escapeHtml(a.recipient_name || "")} · ${escapeHtml(a.recipient_phone || "")}</div>
      <p class="addr-card-line">${escapeHtml(a.full_line || "")}</p>
      <div class="addr-card-actions">
        <button type="button" class="addr-card-link" data-edit-address="${a.id}">Edit</button>
        ${a.is_default ? "" : `<button type="button" class="addr-card-link" data-set-default="${a.id}">Set as default</button>`}
        <button type="button" class="addr-card-link is-danger" data-delete-address="${a.id}">Delete</button>
      </div>
    </div>
  `;
}

function renderAddressList() {
  const box = document.getElementById("acctAddressList");
  if (!addresses.length) {
    box.innerHTML = `<p class="is-empty">No saved addresses yet — add one below.</p>`;
    return;
  }
  box.innerHTML = addresses.map(addressCardHtml).join("");
}

async function reloadAddresses() {
  try {
    const res = await api.get("/addresses");
    addresses = res?.addresses || [];
  } catch {
    // Keep whatever was already on screen rather than blanking it out on
    // a transient failure.
  }
  renderAddressList();
}

document.getElementById("acctAddAddressBtn").addEventListener("click", () => openAddressModal(null));

document.getElementById("acctAddressList").addEventListener("click", (e) => {
  const editId = e.target.closest("[data-edit-address]")?.dataset.editAddress;
  const defaultId = e.target.closest("[data-set-default]")?.dataset.setDefault;
  const deleteId = e.target.closest("[data-delete-address]")?.dataset.deleteAddress;

  if (editId) {
    const address = addresses.find((a) => String(a.id) === editId);
    if (address) openAddressModal(address);
  } else if (defaultId) {
    setDefaultAddress(defaultId);
  } else if (deleteId) {
    const address = addresses.find((a) => String(a.id) === deleteId);
    confirmSimple({
      title: "Delete this address?",
      description: address ? `"${address.label || "This address"}" will be removed from your address book.` : undefined,
      confirmLabel: "Delete",
      tone: "chili",
      onConfirm: async () => {
        await api.delete(`/addresses/${deleteId}`);
        await reloadAddresses();
        toast("Address removed.", "success");
      },
    });
  }
});

async function setDefaultAddress(id) {
  try {
    await api.post(`/addresses/${id}/default`);
    await reloadAddresses();
    toast("Default address updated.", "success");
  } catch (err) {
    toast(err.message || "Couldn't update your default address.", "error");
  }
}

/**
 * Add/Edit address modal — shared markup + cascade with the checkout
 * "Change address" picker (see lib/address-form.js). `existing` is null
 * when adding, or an address object (from the `addresses` array) when
 * editing.
 */
function openAddressModal(existing) {
  const isEdit = !!existing;

  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div><h3>${isEdit ? "Edit address" : "Add new address"}</h3></div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <form id="addrModalForm">
          ${addressFormFieldsHtml("addrModal", { showDefaultToggle: true })}
        </form>
        <div class="field-error" id="addrModalError" hidden></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" id="addrModalSaveBtn">
          <span class="btn-label">${isEdit ? "Save changes" : "Save address"}</span>
          <span class="spinner"></span>
        </button>
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));

    const saveBtn = document.getElementById("addrModalSaveBtn");
    const errorBox = document.getElementById("addrModalError");

    const form = bindAddressForm("addrModal");
    // Save starts disabled and stays that way until every required field
    // is actually filled in — catches the problem before a click, rather
    // than making the buyer submit first and read an error banner.
    saveBtn.disabled = true;
    form.watch(() => { saveBtn.disabled = !form.isComplete(); });

    if (isEdit) {
      // prefill() sets values directly rather than through user input, so
      // it doesn't trigger the watch() above — check completeness once it
      // finishes instead.
      form.prefill(existing).then(() => { saveBtn.disabled = !form.isComplete(); });
    } else if (!addresses.length) {
      // A buyer's very first address is always made the default
      // server-side regardless of this flag — reflect that instead of
      // offering a toggle that has no real effect yet.
      const toggle = document.getElementById("addrModalIsDefault");
      if (toggle) {
        toggle.checked = true;
        toggle.disabled = true;
      }
    }

    saveBtn.addEventListener("click", async () => {
      errorBox.hidden = true;

      if (!form.isComplete()) {
        errorBox.textContent = "Please complete every field.";
        errorBox.hidden = false;
        return;
      }

      saveBtn.classList.add("is-loading");
      saveBtn.disabled = true;
      try {
        const payload = form.read();
        if (isEdit) {
          await api.put(`/addresses/${existing.id}`, payload);
        } else {
          await api.post("/addresses", payload);
        }
        await reloadAddresses();
        closeModal();
        toast(isEdit ? "Address updated." : "Address saved.", "success");
      } catch (err) {
        errorBox.textContent = err.message || "Couldn't save this address.";
        errorBox.hidden = false;
        saveBtn.disabled = false;
      } finally {
        saveBtn.classList.remove("is-loading");
      }
    });

    // A quicker start than reaching for the mouse — recipient name is
    // almost always the first thing filled in for a brand-new address.
    if (!isEdit) document.getElementById("addrModalRecipientName")?.focus();
  });
}

/* ---------------- seller application (Sell on ShopUno tab) ---------------- */

const SELLER_PERMIT_MAX_BYTES = 5 * 1024 * 1024; // matches config('documents.max_size_kb') = 5120

function sellerPitchHtml() {
  return `
    <div class="seller-pitch">
      <div class="seller-pitch-point">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7Z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z"/></svg>
        <div><strong>List unlimited products</strong><span>Variations, images, and stock tracking included.</span></div>
      </div>
      <div class="seller-pitch-point">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        <div><strong>Keep 90% of every sale</strong><span>Flat 10% platform commission — no hidden fees.</span></div>
      </div>
      <div class="seller-pitch-point">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M3 16v5h5"/><path d="M16 21h5v-5"/></svg>
        <div><strong>Built-in fulfillment</strong><span>Hand off to any logistics partner on the platform.</span></div>
      </div>
    </div>
  `;
}

function sellerFormHtml({ reapply = false } = {}) {
  return `
    <form id="sellerApplyForm">
      <div class="field-group">
        <label for="sellerBusinessName">Business name</label>
        <input type="text" id="sellerBusinessName" placeholder="e.g. Dela Cruz Home Goods">
      </div>
      <div class="field-group">
        <label for="sellerLineOfBusiness">Line of business</label>
        <input type="text" id="sellerLineOfBusiness" placeholder="e.g. Home & living, apparel, electronics">
      </div>
      <div class="field-group">
        <label for="sellerPermitInput">Business permit</label>
        <div class="file-drop" id="sellerPermitDrop">
          <input type="file" id="sellerPermitInput" accept="image/png,image/jpeg,application/pdf">
          <div class="file-drop-inner" id="sellerPermitDropInner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
            <span>Tap to upload a clear photo or scan</span>
            <span class="file-drop-hint">Mayor's/Business Permit or DTI reg. · JPG, PNG, or PDF · max 5MB</span>
          </div>
        </div>
      </div>
      <div class="field-error" id="sellerApplyError" hidden></div>
      <div class="acct-form-foot">
        <button type="submit" class="btn btn-primary" id="sellerApplySubmitBtn">
          <span class="btn-label">${reapply ? "Apply again" : "Submit application"}</span>
          <span class="spinner"></span>
        </button>
      </div>
    </form>
  `;
}

function sellerStatusCardHtml(tone, iconSvg, title, description) {
  return `
    <div class="seller-status-card is-${tone}">
      <span class="seller-status-icon">${iconSvg}</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${description}</p>
      </div>
    </div>
  `;
}

const ICON_CLOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const ICON_X = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>`;

function renderSellerTab() {
  const body = document.getElementById("sellerApplicationBody");
  const dot = document.getElementById("acctSellerDot");

  // Defensive only — the backend flips role to 'seller' the moment an
  // application is approved, so a buyer with an 'approved' record here
  // shouldn't really be reachable. Still handled rather than assumed.
  if (user?.role !== "buyer") {
    dot.hidden = true;
    body.innerHTML = sellerStatusCardHtml("approved", ICON_CHECK, "You're a seller!",
      `Your application was approved. <a href="/seller/dashboard.html">Go to your seller dashboard →</a>`);
    return;
  }

  if (!sellerApplication) {
    dot.hidden = true;
    body.innerHTML = sellerPitchHtml() + sellerFormHtml();
    wireSellerForm();
    return;
  }

  if (sellerApplication.status === "pending") {
    dot.hidden = true; // nothing needs the buyer's action right now
    body.innerHTML = sellerStatusCardHtml("pending", ICON_CLOCK, "Application submitted",
      `Reviewing <strong>${escapeHtml(sellerApplication.business_name)}</strong> (${escapeHtml(sellerApplication.line_of_business)}), submitted ${formatDate(sellerApplication.submitted_at)}. We'll email you the decision — no need to reapply while this is pending.`);
    return;
  }

  if (sellerApplication.status === "rejected") {
    dot.hidden = false; // something the buyer can act on
    body.innerHTML =
      sellerStatusCardHtml("rejected", ICON_X, "Application not approved",
        sellerApplication.rejection_reason
          ? `Reason given: "${escapeHtml(sellerApplication.rejection_reason)}"`
          : "No specific reason was given. You're welcome to apply again.") +
      sellerFormHtml({ reapply: true });
    wireSellerForm();
    return;
  }

  // status === 'approved' but role hasn't flipped in this session's stored
  // user yet — same message as the role-check branch above.
  dot.hidden = true;
  body.innerHTML = sellerStatusCardHtml("approved", ICON_CHECK, "Approved!",
    `Your seller application was approved. Log out and back in to switch to your seller account.`);
}

function wireSellerForm() {
  const drop = document.getElementById("sellerPermitDrop");
  const input = document.getElementById("sellerPermitInput");
  const inner = document.getElementById("sellerPermitDropInner");
  const errorBox = document.getElementById("sellerApplyError");

  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) { drop.classList.remove("has-file"); return; }
    if (file.size > SELLER_PERMIT_MAX_BYTES) {
      errorBox.textContent = "That file is too large — please upload something under 5MB.";
      errorBox.hidden = false;
      input.value = "";
      drop.classList.remove("has-file");
      return;
    }
    errorBox.hidden = true;
    const sizeKb = Math.round(file.size / 1024);
    inner.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
      <span>${escapeHtml(file.name)}</span>
      <span class="file-drop-hint">${sizeKb} KB · tap to replace</span>
    `;
    drop.classList.add("has-file");
  });

  document.getElementById("sellerApplyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("sellerApplySubmitBtn");
    const businessName = document.getElementById("sellerBusinessName").value.trim();
    const lineOfBusiness = document.getElementById("sellerLineOfBusiness").value.trim();
    const file = input.files[0];

    errorBox.hidden = true;
    if (!businessName || !lineOfBusiness) {
      errorBox.textContent = "Please fill in your business name and line of business.";
      errorBox.hidden = false;
      return;
    }
    if (!file) {
      errorBox.textContent = "Please upload your business permit.";
      errorBox.hidden = false;
      return;
    }

    const fd = new FormData();
    fd.append("business_name", businessName);
    fd.append("line_of_business", lineOfBusiness);
    fd.append("business_permit", file);

    btn.classList.add("is-loading");
    btn.disabled = true;
    try {
      const res = await api.post("/me/seller-application", fd);
      sellerApplication = {
        id: res?.application_id,
        business_name: businessName,
        line_of_business: lineOfBusiness,
        status: "pending",
        rejection_reason: null,
        submitted_at: new Date().toISOString(),
      };
      renderSellerTab();
      toast(res?.message || "Application submitted.", "success");
    } catch (err) {
      errorBox.textContent = err.fieldErrors?.business_permit?.[0] || err.message || "Couldn't submit your application.";
      errorBox.hidden = false;
      btn.classList.remove("is-loading");
      btn.disabled = false;
    }
  });
}

/* ---------------- contact save (Profile tab) ---------------- */

document.getElementById("contactForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("contactSaveBtn");
  const errorBox = document.getElementById("contactError");
  const msg = document.getElementById("contactSaveMsg");
  errorBox.hidden = true;
  msg.classList.remove("is-shown");

  const username = document.getElementById("acctUsername").value.trim();
  if (username && !/^[a-zA-Z0-9_.]{3,30}$/.test(username)) {
    errorBox.textContent = "Username must be 3–30 characters: letters, numbers, underscores, or periods only.";
    errorBox.hidden = false;
    return;
  }

  const sex = document.getElementById("acctSex").value;
  const birthday = document.getElementById("acctBirthday").value;
  if (birthday && new Date(birthday) >= new Date(new Date().toDateString())) {
    errorBox.textContent = "Birthday must be a date in the past.";
    errorBox.hidden = false;
    return;
  }

  btn.classList.add("is-loading");
  btn.disabled = true;
  try {
    const payload = {
      first_name: document.getElementById("acctFirstName").value.trim(),
      last_name: document.getElementById("acctLastName").value.trim(),
      middle_initial: document.getElementById("acctMiddleInitial").value.trim() || null,
      username: username || null,
      email: document.getElementById("acctEmailInput").value.trim(),
      contact_no: document.getElementById("acctContactNo").value.trim(),
    };
    // sex/birthday are only sent when actually filled in — the backend
    // rejects an empty sex ("sometimes", not nullable, must be male/female)
    // and an empty birthday would fail its date rule, so an untouched or
    // cleared field is left out of the payload rather than sent blank.
    if (sex) payload.sex = sex;
    if (birthday) payload.birthday = birthday;

    const res = await api.patch("/me", payload);
    user = res?.user || user;
    setStoredUser(user);
    renderSummary();
    refreshAccountSummary();
    msg.classList.add("is-shown");
    setTimeout(() => msg.classList.remove("is-shown"), 2500);
    toast("Profile updated.", "success");
  } catch (err) {
    errorBox.textContent = err.message || "Couldn't save your changes.";
    errorBox.hidden = false;
  } finally {
    btn.classList.remove("is-loading");
    btn.disabled = false;
  }
});

/* ---------------- password save ---------------- */

document.getElementById("passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("passwordSaveBtn");
  const errorBox = document.getElementById("passwordError");
  const msg = document.getElementById("passwordSaveMsg");
  errorBox.hidden = true;
  msg.classList.remove("is-shown");

  const current = document.getElementById("acctCurrentPassword").value;
  const next = document.getElementById("acctNewPassword").value;
  const confirm = document.getElementById("acctConfirmPassword").value;

  if (!current) {
    errorBox.textContent = "Please enter your current password.";
    errorBox.hidden = false;
    return;
  }
  if (next.length < 8) {
    errorBox.textContent = "New password must be at least 8 characters.";
    errorBox.hidden = false;
    return;
  }
  if (next !== confirm) {
    errorBox.textContent = "New password and confirmation don't match.";
    errorBox.hidden = false;
    return;
  }

  btn.classList.add("is-loading");
  btn.disabled = true;
  try {
    await api.patch("/me/password", {
      current_password: current,
      new_password: next,
      new_password_confirmation: confirm,
    });
    document.getElementById("passwordForm").reset();
    document.querySelectorAll("#passwordForm input[type=text]").forEach((el) => { el.type = "password"; });
    document.querySelectorAll("#passwordForm .pw-toggle").forEach((el) => {
      el.innerHTML = eyeIcon();
      el.setAttribute("aria-label", "Show password");
    });
    pwStrength.hidden = true;
    msg.classList.add("is-shown");
    setTimeout(() => msg.classList.remove("is-shown"), 2500);
    toast("Password updated.", "success");
  } catch (err) {
    errorBox.textContent = err.message || "Couldn't update your password.";
    errorBox.hidden = false;
  } finally {
    btn.classList.remove("is-loading");
    btn.disabled = false;
  }
});