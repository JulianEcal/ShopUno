// assets/js/pages/seller-account.js
// Seller account settings (seller/account.html). Four things live here:
//   1. A "shop plate" summary card — logo, business name, line of
//      business, account status, live rating (from GET /seller/dashboard,
//      best-effort — same "a stale/missing number beats a broken page"
//      spirit as seller-shell.js's pulse strip), and "selling since".
//   2. Business tab: business_name + line_of_business (PATCH /me), shop
//      logo (POST/DELETE /seller/logo — its own logo_path on the Seller
//      row, independent of the user's personal avatar_path so a seller's
//      buyer-side profile picture and shop logo can differ), and
//      the business permit on file — view via an authenticated document
//      viewer, or replace it (POST /seller/business-permit).
//   3. Profile tab: the person behind the shop — name, middle initial,
//      username, sex, birthday, email, contact number — all saved
//      together through PATCH /me, same identity-fields-are-editable
//      posture as buyer-account.js.
//   4. Address tab (pickup address — where couriers collect orders) and
//      Security tab (password change via PATCH /me/password) — same
//      region → province → city → barangay cascade and password-strength
//      meter as buyer-account.js, since the backend's Address/password
//      rules don't differ by role.
//
// Address prefill uses the same best-effort reverse lookup as
// buyer-account.js: /me only returns flat text, not the PSGC codes that
// produced it, so this finds the city/municipality by name and cascades
// upward/downward from there. Silently gives up on a mismatch — never
// blocks editing.

import { api, setStoredUser } from "../api.js";
import { initShell } from "../partials/seller-shell.js";
import { escapeHtml, toast, formatDate, confirmSimple, openDocumentViewer, openModal, closeModal, debounce } from "../lib/ui.js";
import { getRegions, getProvinces, getCitiesMunicipalities, getBarangays } from "../lib/psgc.js";

const PSGC_BASE = "https://psgc.cloud/api/v2";

const STATUS_LABEL = { active: "Active", pending: "Pending", suspended: "Suspended", deactivated: "Deactivated", rejected: "Rejected" };
const SEX_LABEL = { male: "Male", female: "Female" };

// Copy for the account-status banner — only shown when status isn't
// "active", so a seller always knows *why* selling might be limited and
// what to do about it, instead of just seeing a status badge with no
// explanation.
const STATUS_BANNER = {
  pending: {
    tone: "is-info",
    title: "Your account is pending review",
    body: "You can still update your details below, but selling features stay locked until an admin approves your application.",
  },
  suspended: {
    tone: "is-danger",
    title: "Your account has been suspended",
    body: "Your shop is hidden from buyers while this is in effect. Contact ShopUno support if you'd like to understand why or appeal.",
  },
  rejected: {
    tone: "is-danger",
    title: "Your application was rejected",
    body: "Double-check your business permit and details below, then contact ShopUno support if you believe this was a mistake.",
  },
  deactivated: {
    tone: "is-warn",
    title: "Your account is deactivated",
    body: "Contact ShopUno support to reactivate your shop.",
  },
};

const content = initShell({ page: "account", title: "Account", eyebrow: "Seller console" });

content.innerHTML = `
  <section class="acct-head">
    <h1>Shop <em style="color:var(--accent-deep); font-style:italic; font-family:'Petrona',serif;">settings</em></h1>
    <p>Your storefront's business details, the person behind it, pickup address, and security — all in one place.</p>
  </section>

  <div class="acct-status-banner" id="acctStatusBanner" hidden></div>

  <div class="acct-layout">
    <aside class="acct-rail">
      <div class="shop-plate" id="shopPlate">
        <div class="shop-plate-banner" id="acctBannerStrip">
          <span class="shop-plate-banner-hint" id="acctBannerHint">Add a shop banner</span>
          <button type="button" class="shop-plate-banner-edit" id="acctBannerEditBtn" aria-label="Change shop banner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/></svg>
            <span class="spinner"></span>
          </button>
          <button type="button" class="shop-plate-banner-remove" id="acctBannerRemoveBtn" hidden aria-label="Remove shop banner">✕</button>
          <input type="file" id="acctBannerInput" accept="image/png,image/jpeg,image/webp" hidden>
        </div>

        <span class="shop-plate-rivet is-left"></span>
        <span class="shop-plate-rivet is-right"></span>

        <div class="acct-logo-wrap" id="acctLogoWrap">
          <div class="acct-logo" id="acctLogo">··</div>
          <button type="button" class="acct-logo-edit-btn" id="acctLogoEditBtn" aria-label="Change shop logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/></svg>
            <span class="spinner"></span>
          </button>
          <input type="file" id="acctLogoInput" accept="image/png,image/jpeg,image/webp" hidden>
        </div>
        <button type="button" class="acct-logo-remove" id="acctLogoRemoveBtn" hidden>Remove logo</button>

        <h2 id="acctShopName">Loading…</h2>
        <span class="shop-line" id="acctShopLine"></span>

        <div class="shop-stars" id="acctShopStars"></div>
        <div class="shop-rating-count" id="acctRatingCount"></div>

        <div class="shop-plate-badges" id="acctBadges"></div>

        <div class="shop-plate-facts" id="acctFacts"></div>
      </div>

      <nav class="acct-nav" id="acctNav">
        <button type="button" class="acct-nav-btn is-active" data-tab="business">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 9l1.5-5h15L21 9"/><path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/></svg>
          Business
          <span class="acct-nav-dot" id="acctBusinessDot" hidden></span>
        </button>
        <button type="button" class="acct-nav-btn" data-tab="profile">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Profile
        </button>
        <button type="button" class="acct-nav-btn" data-tab="address">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          Pickup address
        </button>
        <button type="button" class="acct-nav-btn" data-tab="security">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Security
        </button>
      </nav>
    </aside>

    <div class="acct-panels">
      <section class="acct-panel" data-panel="business">
        <div class="acct-panel-head"><span class="bar"></span><h3>Business profile</h3></div>
        <p class="acct-panel-sub">How your shop is registered on ShopUno — this is what buyers and admins see.</p>

        <div class="permit-card" id="permitCard">
          <div class="permit-card-icon" id="permitCardIcon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
          <div class="permit-card-body">
            <strong id="permitCardTitle">Loading…</strong>
            <span id="permitCardSub"></span>
          </div>
          <div class="permit-card-actions">
            <button type="button" class="btn btn-sm btn-outline" id="permitViewBtn" hidden>View</button>
            <button type="button" class="btn btn-sm btn-outline" id="permitReplaceBtn">Replace</button>
          </div>
        </div>

        <form id="businessForm" novalidate>
          <div class="field-group">
            <div class="field-group-head">
              <label for="acctBusinessName">Business name</label>
              <span class="field-count" id="businessNameCount">0/150</span>
            </div>
            <input type="text" id="acctBusinessName" placeholder="e.g. Dela Cruz Home Goods" maxlength="150">
            <div class="field-inline-error" id="businessNameError"></div>
          </div>
          <div class="field-group">
            <div class="field-group-head">
              <label for="acctLineOfBusiness">Line of business</label>
              <span class="field-count" id="lineOfBusinessCount">0/100</span>
            </div>
            <input type="text" id="acctLineOfBusiness" placeholder="e.g. Home & living, apparel, electronics" maxlength="100">
            <div class="field-inline-error" id="lineOfBusinessError"></div>
          </div>
          <div class="field-group">
            <div class="field-group-head">
              <label for="acctShopDescription">Shop description</label>
              <span class="field-count" id="shopDescriptionCount">0/1000</span>
            </div>
            <textarea id="acctShopDescription" maxlength="1000" placeholder="Tell buyers what your shop sells and what makes it worth buying from — this shows up on your public storefront."></textarea>
          </div>
          <div class="field-error" id="businessError" hidden></div>
          <div class="acct-form-foot">
            <button type="submit" class="btn btn-primary" id="businessSaveBtn">
              <span class="btn-label">Save changes</span>
              <span class="spinner spinner-inline"></span>
            </button>
            <span class="acct-save-msg" id="businessSaveMsg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Saved.
            </span>
            <span class="unsaved-pill" id="businessUnsavedPill">Unsaved changes</span>
          </div>
        </form>

        <div id="permitReplaceZone" hidden style="margin-top:22px; padding-top:22px; border-top:1px solid var(--line-soft);">
          <div class="field-group">
            <label for="permitInput">Upload a new business permit</label>
            <div class="file-drop" id="permitDrop">
              <input type="file" id="permitInput" accept="image/png,image/jpeg,application/pdf">
              <div class="file-drop-inner" id="permitDropInner">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
                <span>Tap to upload a clear photo or scan</span>
                <span class="file-drop-hint">Mayor's/Business Permit or DTI reg. · JPG, PNG, or PDF · max 5MB</span>
              </div>
            </div>
          </div>
          <div class="field-error" id="permitError" hidden></div>
          <div class="acct-form-foot">
            <button type="button" class="btn btn-primary" id="permitUploadBtn" disabled>
              <span class="btn-label">Upload replacement</span>
              <span class="spinner spinner-inline"></span>
            </button>
            <button type="button" class="btn btn-ghost" id="permitCancelBtn">Cancel</button>
          </div>
        </div>
      </section>

      <section class="acct-panel" data-panel="profile" hidden>
        <div class="acct-panel-head"><span class="bar" style="background:var(--thrive);"></span><h3>Profile</h3></div>
        <p class="acct-panel-sub">The person behind the shop — how buyers and support reach you.</p>

        <div class="acct-info-list" id="acctInfoList"></div>
        <a href="#" id="acctDocLink" class="acct-doc-link" target="_blank" rel="noopener" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          View my uploaded ID
        </a>

        <form id="contactForm" novalidate>
          <div class="acct-field-row">
            <div class="field-group">
              <label for="acctFirstName">First name</label>
              <input type="text" id="acctFirstName" placeholder="Juan" maxlength="100">
              <div class="field-inline-error" id="firstNameError"></div>
            </div>
            <div class="field-group">
              <label for="acctLastName">Last name</label>
              <input type="text" id="acctLastName" placeholder="Dela Cruz" maxlength="100">
              <div class="field-inline-error" id="lastNameError"></div>
            </div>
          </div>
          <div class="acct-field-row">
            <div class="field-group">
              <label for="acctMiddleInitial">Middle initial</label>
              <input type="text" id="acctMiddleInitial" placeholder="e.g. S" maxlength="5">
              <div class="field-inline-error" id="middleInitialError"></div>
            </div>
            <div class="field-group">
              <div class="field-group-head">
                <label for="acctUsername">Username</label>
                <span class="field-count" id="usernameCount"></span>
              </div>
              <input type="text" id="acctUsername" placeholder="e.g. juan_delacruz" maxlength="30">
              <div class="field-inline-error" id="usernameError"></div>
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
            <input type="email" id="acctEmailInput" placeholder="you@example.com" maxlength="150">
            <div class="field-inline-error" id="emailError"></div>
          </div>
          <div class="field-group">
            <label for="acctContactNo">Mobile number</label>
            <input type="text" id="acctContactNo" placeholder="09171234567" maxlength="20">
            <div class="field-inline-error" id="contactNoError"></div>
          </div>
          <div class="field-error" id="contactError" hidden></div>
          <div class="acct-form-foot">
            <button type="submit" class="btn btn-primary" id="contactSaveBtn">
              <span class="btn-label">Save changes</span>
              <span class="spinner spinner-inline"></span>
            </button>
            <span class="acct-save-msg" id="contactSaveMsg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Saved.
            </span>
            <span class="unsaved-pill" id="contactUnsavedPill">Unsaved changes</span>
          </div>
        </form>
      </section>

      <section class="acct-panel" data-panel="address" hidden>
        <div class="acct-panel-head"><span class="bar" style="background:var(--warn);"></span><h3>Pickup address</h3></div>
        <p class="acct-panel-sub">Where couriers collect your orders once they're ready to ship.</p>

        <div class="acct-address-current" id="acctAddressCurrent">
          <p class="is-empty">Loading address…</p>
        </div>

        <form id="addressForm">
          <div class="acct-field-row">
            <div class="field-group">
              <label for="acctRegion">Region</label>
              <select id="acctRegion"><option value="" selected>Loading…</option></select>
            </div>
            <div class="field-group" id="acctProvinceGroup">
              <label for="acctProvince">Province</label>
              <select id="acctProvince" disabled><option value="" selected>Select region first</option></select>
            </div>
          </div>
          <div class="acct-field-row">
            <div class="field-group">
              <label for="acctMunicipality">Municipality / City</label>
              <select id="acctMunicipality" disabled><option value="" selected>Select region first</option></select>
            </div>
            <div class="field-group">
              <label for="acctBarangay">Barangay</label>
              <select id="acctBarangay" disabled><option value="" selected>Select municipality first</option></select>
            </div>
          </div>
          <div class="acct-field-row">
            <div class="field-group">
              <label for="acctStreet">Street</label>
              <input type="text" id="acctStreet" placeholder="e.g. Rizal St.">
            </div>
            <div class="field-group">
              <label for="acctHouseNumber">House / unit no.</label>
              <input type="text" id="acctHouseNumber" placeholder="e.g. 123">
            </div>
          </div>

          <div class="field-error" id="addressError" hidden></div>
          <div class="acct-form-foot">
            <button type="submit" class="btn btn-primary" id="addressSaveBtn">
              <span class="btn-label">Save address</span>
              <span class="spinner spinner-inline"></span>
            </button>
            <span class="acct-save-msg" id="addressSaveMsg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Saved.
            </span>
            <span class="unsaved-pill" id="addressUnsavedPill">Unsaved changes</span>
          </div>
        </form>
      </section>

      <section class="acct-panel" data-panel="security" hidden>
        <div class="acct-panel-head"><span class="bar" style="background:var(--danger);"></span><h3>Security</h3></div>
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
              <span class="spinner spinner-inline"></span>
            </button>
            <span class="acct-save-msg" id="passwordSaveMsg">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Updated.
            </span>
            <span class="unsaved-pill" id="passwordUnsavedPill">Unsaved changes</span>
          </div>
        </form>
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
function starIcon(filled) {
  return `<svg class="rr-star${filled ? " is-filled" : ""}" viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
}

let user = null; // current /me payload, refreshed after every successful save
let addressInitStarted = false;

init();

async function init() {
  try {
    const res = await api.get("/me");
    user = res?.user || null;
    renderPlate();
    renderStatusBanner();
    renderProfileSummary();
    renderAddressSummary();
    renderPermitCard();
    renderBannerStrip();

    document.getElementById("acctBusinessName").value = user?.seller?.business_name || "";
    document.getElementById("acctLineOfBusiness").value = user?.seller?.line_of_business || "";
    document.getElementById("acctShopDescription").value = user?.seller?.shop_description || "";

    document.getElementById("acctFirstName").value = user?.first_name || "";
    document.getElementById("acctLastName").value = user?.last_name || "";
    document.getElementById("acctMiddleInitial").value = user?.middle_initial || "";
    document.getElementById("acctUsername").value = user?.username || "";
    document.getElementById("acctSex").value = user?.sex || "";
    document.getElementById("acctBirthday").value = user?.birthday || "";
    document.getElementById("acctEmailInput").value = user?.email || "";
    document.getElementById("acctContactNo").value = user?.contact_no || "";

    refreshCounters();
    captureBaseline("business");
    captureBaseline("contact");
    captureBaseline("password");
    stabilizePanelsHeight();
  } catch (err) {
    toast(err.message || "Couldn't load your account.", "error");
  }

  // Best-effort: pulls total products + average rating into the shop
  // plate's facts row. Same "a missing number beats a broken page" spirit
  // as seller-shell.js's own pulse strip — never blocks the rest of init.
  try {
    const res = await api.get("/seller/dashboard");
    renderPlateStats(res?.counts || {});
  } catch {
    renderPlateStats({});
  }
}

/* ---------------- field counters + inline (blur) validation ---------------- */

function bindCounter(inputId, countId, max) {
  const input = document.getElementById(inputId);
  const count = document.getElementById(countId);
  const update = () => {
    const len = input.value.length;
    count.textContent = `${len}/${max}`;
    count.classList.toggle("is-near", len >= max * 0.9 && len < max);
    count.classList.toggle("is-over", len >= max);
  };
  input.addEventListener("input", update);
  return update;
}

/** Wires blur-time validation for a single field: red border + inline
 * message the moment the seller leaves a bad field, instead of only
 * finding out everything wrong with the form at once on submit. Returns a
 * `run()` you can also call manually right before a submit to catch fields
 * the seller never actually blurred (e.g. autofilled or left as-is). */
function bindInlineValidation(inputId, errorId, validate) {
  const input = document.getElementById(inputId);
  const errorBox = document.getElementById(errorId);
  const run = () => {
    const msg = validate(input.value);
    input.classList.toggle("is-invalid", !!msg);
    errorBox.textContent = msg || "";
    errorBox.classList.toggle("is-shown", !!msg);
    return !msg;
  };
  input.addEventListener("blur", run);
  input.addEventListener("input", () => { if (errorBox.classList.contains("is-shown")) run(); });
  return run;
}

const refreshCounters = [
  bindCounter("acctBusinessName", "businessNameCount", 150),
  bindCounter("acctLineOfBusiness", "lineOfBusinessCount", 100),
  bindCounter("acctShopDescription", "shopDescriptionCount", 1000),
  bindCounter("acctUsername", "usernameCount", 30),
].reduce((fn, next) => () => { fn(); next(); }, () => {});

const validate = {
  businessName: bindInlineValidation("acctBusinessName", "businessNameError", (v) => (!v.trim() ? "Business name is required." : null)),
  lineOfBusiness: bindInlineValidation("acctLineOfBusiness", "lineOfBusinessError", (v) => (!v.trim() ? "Line of business is required." : null)),
  firstName: bindInlineValidation("acctFirstName", "firstNameError", (v) => (!v.trim() ? "First name is required." : null)),
  lastName: bindInlineValidation("acctLastName", "lastNameError", (v) => (!v.trim() ? "Last name is required." : null)),
  middleInitial: bindInlineValidation("acctMiddleInitial", "middleInitialError", (v) => (v.length > 5 ? "Max 5 characters." : null)),
  username: bindInlineValidation("acctUsername", "usernameError", (v) =>
    v && !/^[a-zA-Z0-9_.]{3,30}$/.test(v) ? "3–30 characters: letters, numbers, underscores, or periods only." : null),
  email: bindInlineValidation("acctEmailInput", "emailError", (v) => {
    if (!v.trim()) return "Email is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return "Enter a valid email address.";
    return null;
  }),
  contactNo: bindInlineValidation("acctContactNo", "contactNoError", (v) => (!v.trim() ? "Mobile number is required." : null)),
};

/* ---------------- unsaved-changes tracking ---------------- */

const FORM_FIELDS = {
  business: ["acctBusinessName", "acctLineOfBusiness", "acctShopDescription"],
  contact: ["acctFirstName", "acctLastName", "acctMiddleInitial", "acctUsername", "acctSex", "acctBirthday", "acctEmailInput", "acctContactNo"],
  address: ["acctRegion", "acctProvince", "acctMunicipality", "acctBarangay", "acctStreet", "acctHouseNumber"],
  password: ["acctCurrentPassword", "acctNewPassword", "acctConfirmPassword"],
};
const dirty = { business: false, contact: false, address: false, password: false };
const baselines = {};

function serializeTab(tab) {
  return FORM_FIELDS[tab].map((id) => document.getElementById(id)?.value ?? "").join("\u0001");
}
function captureBaseline(tab) {
  baselines[tab] = serializeTab(tab);
  setDirty(tab, false);
}
function checkDirty(tab) {
  setDirty(tab, serializeTab(tab) !== baselines[tab]);
}
function setDirty(tab, val) {
  dirty[tab] = val;
  document.getElementById(`${tab}UnsavedPill`)?.classList.toggle("is-shown", val);
}
function anyDirty() {
  return Object.values(dirty).some(Boolean);
}

Object.entries(FORM_FIELDS).forEach(([tab, ids]) => {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => checkDirty(tab));
    el?.addEventListener("change", () => checkDirty(tab));
  });
});

// Re-populates a tab's fields from the last-known-saved `user` object —
// used when the seller chooses to discard changes rather than save them
// before switching tabs. The address cascade's selects can't be cheaply
// restored without re-running the async PSGC lookups, so that tab's
// "discard" just accepts the current values as the new baseline instead.
function resetTabToSaved(tab) {
  if (tab === "business") {
    document.getElementById("acctBusinessName").value = user?.seller?.business_name || "";
    document.getElementById("acctLineOfBusiness").value = user?.seller?.line_of_business || "";
    document.getElementById("acctShopDescription").value = user?.seller?.shop_description || "";
    refreshCounters();
  } else if (tab === "contact") {
    document.getElementById("acctFirstName").value = user?.first_name || "";
    document.getElementById("acctLastName").value = user?.last_name || "";
    document.getElementById("acctMiddleInitial").value = user?.middle_initial || "";
    document.getElementById("acctUsername").value = user?.username || "";
    document.getElementById("acctSex").value = user?.sex || "";
    document.getElementById("acctBirthday").value = user?.birthday || "";
    document.getElementById("acctEmailInput").value = user?.email || "";
    document.getElementById("acctContactNo").value = user?.contact_no || "";
    refreshCounters();
  } else if (tab === "password") {
    document.getElementById("passwordForm").reset();
    pwStrength.hidden = true;
  }
  captureBaseline(tab);
}

window.addEventListener("beforeunload", (e) => {
  if (!anyDirty()) return;
  e.preventDefault();
  e.returnValue = "";
});

/* ---------------- tab switching ---------------- */

document.getElementById("acctNav").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  const currentTab = document.querySelector(".acct-nav-btn.is-active")?.dataset.tab;
  const tab = btn.dataset.tab;
  if (tab === currentTab) return;

  if (currentTab && dirty[currentTab]) {
    confirmSimple({
      title: "Discard unsaved changes?",
      description: "You have unsaved changes in this tab. Switching now will lose them.",
      confirmLabel: "Discard & switch",
      tone: "danger",
      onConfirm: async () => {
        resetTabToSaved(currentTab);
        await activateTab(tab, btn);
      },
    });
    return;
  }
  await activateTab(tab, btn);
});

async function activateTab(tab, btn) {
  document.querySelectorAll(".acct-nav-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
  document.querySelectorAll(".acct-panel").forEach((p) => { p.hidden = p.dataset.panel !== tab; });

  if (tab === "address" && !addressInitStarted) {
    addressInitStarted = true;
    await loadRegions();
    await prefillFromCurrentAddress();
    captureBaseline("address");
    stabilizePanelsHeight();
  }
}

/**
 * Tab panels are wildly different heights (Business carries the permit
 * card + description textarea; Profile is a handful of fields), and only
 * one is ever visible at a time (the rest are `hidden` → display:none).
 * With the sticky `.acct-rail` sitting next to them, that height swing on
 * every tab switch was yanking the sidebar's containing box around and
 * making the whole page visibly jump. Pinning `.acct-panels` to the
 * tallest panel's height removes the swing entirely — switching tabs no
 * longer changes the page's overall height at all.
 *
 * Measures panels off the visible flow (absolute + hidden, not
 * `display:none`) so a currently-hidden panel can still be measured
 * without ever flashing on screen.
 */
function stabilizePanelsHeight() {
  const container = document.querySelector(".acct-panels");
  if (!container) return;
  const panels = container.querySelectorAll(".acct-panel");
  const width = container.clientWidth;
  let maxHeight = 0;

  panels.forEach((panel) => {
    const wasHidden = panel.hidden;
    panel.hidden = false;
    panel.style.position = "absolute";
    panel.style.visibility = "hidden";
    panel.style.pointerEvents = "none";
    panel.style.width = `${width}px`;
    maxHeight = Math.max(maxHeight, panel.offsetHeight);
    panel.style.position = "";
    panel.style.visibility = "";
    panel.style.pointerEvents = "";
    panel.style.width = "";
    panel.hidden = wasHidden;
  });

  container.style.minHeight = maxHeight ? `${maxHeight}px` : "";
}
window.addEventListener("resize", debounce(stabilizePanelsHeight, 250));

/* ---------------- shop plate (summary card) ---------------- */

function renderStatusBanner() {
  const box = document.getElementById("acctStatusBanner");
  const info = STATUS_BANNER[user?.status];
  if (!info) { box.hidden = true; return; }
  box.className = `acct-status-banner ${info.tone}`;
  box.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <div><strong>${escapeHtml(info.title)}</strong><p>${escapeHtml(info.body)}</p></div>
  `;
  box.hidden = false;
}

function renderPlate() {
  if (!user) return;
  const initials = ((user.seller?.business_name || user.first_name || "?")[0] || "?").toUpperCase();
  const logoEl = document.getElementById("acctLogo");
  const logoUrl = user.seller?.logo_url;
  logoEl.innerHTML = logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="">` : escapeHtml(initials);
  document.getElementById("acctLogoRemoveBtn").hidden = !logoUrl;

  document.getElementById("acctShopName").textContent = user.seller?.business_name || "Your shop";
  document.getElementById("acctShopLine").textContent = user.seller?.line_of_business || "—";

  document.getElementById("acctBadges").innerHTML = `
    <span class="badge badge-seller">Seller</span>
    <span class="badge badge-${escapeHtml(String(user.status || "").toLowerCase())}">${escapeHtml(STATUS_LABEL[user.status] || user.status || "—")}</span>
    ${user.email_verified === false ? '<span class="badge badge-pending">Email unverified</span>' : ""}
  `;

  document.getElementById("acctFacts").innerHTML = `
    <div class="shop-plate-fact"><b>${user.seller?.since ? formatDate(user.seller.since) : "—"}</b><span>Selling since</span></div>
  `;
}

function renderPlateStats(counts) {
  const stars = document.getElementById("acctShopStars");
  const avg = counts.average_rating;
  stars.innerHTML = Array.from({ length: 5 }, (_, i) => starIcon(avg && i < Math.round(avg))).join("");
  document.getElementById("acctRatingCount").textContent = avg ? `${avg.toFixed(1)} average rating` : "No ratings yet";

  const facts = document.getElementById("acctFacts");
  facts.innerHTML += `<div class="shop-plate-fact"><b>${counts.total_products ?? "—"}</b><span>Products</span></div>`;
}

/* ---------------- shop banner (photo + upload/remove) ---------------- */

const bannerStrip = document.getElementById("acctBannerStrip");
const bannerInput = document.getElementById("acctBannerInput");
const BANNER_MAX_BYTES = 5 * 1024 * 1024;

function renderBannerStrip() {
  const url = user?.seller?.banner_url;
  bannerStrip.classList.toggle("has-image", !!url);
  bannerStrip.style.backgroundImage = url ? `url("${url}")` : "";
  document.getElementById("acctBannerRemoveBtn").hidden = !url;
}

document.getElementById("acctBannerEditBtn").addEventListener("click", () => bannerInput.click());

bannerInput.addEventListener("change", async () => {
  const file = bannerInput.files[0];
  if (!file) return;
  if (file.size > BANNER_MAX_BYTES) {
    toast("That image is too large — please keep it under 5MB.", "error");
    bannerInput.value = "";
    return;
  }

  const fd = new FormData();
  fd.append("banner", file);

  bannerStrip.classList.add("is-uploading");
  try {
    const res = await api.post("/seller/banner", fd);
    user = res?.user || user;
    setStoredUser(user);
    renderBannerStrip();
    toast("Shop banner updated.", "success");
  } catch (err) {
    toast(err.message || "Couldn't upload your banner.", "error");
  } finally {
    bannerStrip.classList.remove("is-uploading");
    bannerInput.value = "";
  }
});

document.getElementById("acctBannerRemoveBtn").addEventListener("click", () => {
  confirmSimple({
    title: "Remove shop banner?",
    description: "Your shop will go back to a plain background until you upload a new one.",
    confirmLabel: "Remove banner",
    tone: "danger",
    onConfirm: async () => {
      const res = await api.delete("/seller/banner");
      user = res?.user || user;
      setStoredUser(user);
      renderBannerStrip();
      toast("Shop banner removed.", "success");
    },
  });
});

/* ---------------- shop logo (photo + upload/remove) ---------------- */

const logoWrap = document.getElementById("acctLogoWrap");
const logoInput = document.getElementById("acctLogoInput");

document.getElementById("acctLogoEditBtn").addEventListener("click", () => logoInput.click());

logoInput.addEventListener("change", () => {
  const file = logoInput.files[0];
  if (!file) return;

  if (file.size > 3 * 1024 * 1024) {
    toast("That image is too large — please keep it under 3MB.", "error");
    logoInput.value = "";
    return;
  }

  openLogoCropModal(file);
});

/** Lets the seller position + zoom their photo into a circle before it
 * becomes the shop logo, instead of uploading whatever crop the source
 * file happened to have. Exports a fixed-size square JPEG that the
 * existing round .acct-logo frame then displays as-is. */
function openLogoCropModal(file) {
  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const STAGE = 280;
    const EXPORT = 400;
    const baseScale = Math.max(STAGE / img.width, STAGE / img.height);
    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;

    openModal((box) => {
      box.innerHTML = `
        <div class="modal-header">
          <div><h3>Position your logo</h3><p>Drag to reposition, use the slider to zoom.</p></div>
          <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <div class="crop-stage" id="cropStage"><canvas id="cropCanvas" width="${STAGE}" height="${STAGE}"></canvas></div>
          <div class="crop-controls">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="range" id="cropZoom" min="100" max="300" value="100">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <p class="crop-hint">This is how your logo will appear to buyers.</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline" data-close>Cancel</button>
          <button type="button" class="btn btn-primary" id="cropConfirmBtn">
            <span class="btn-label">Use this photo</span>
            <span class="spinner spinner-inline"></span>
          </button>
        </div>
      `;

      const stage = box.querySelector("#cropStage");
      const canvas = box.querySelector("#cropCanvas");
      const ctx = canvas.getContext("2d");
      const zoomSlider = box.querySelector("#cropZoom");

      function clampOffsets() {
        const scale = baseScale * zoom;
        const allowedX = Math.max(0, (img.width * scale - STAGE) / 2);
        const allowedY = Math.max(0, (img.height * scale - STAGE) / 2);
        offsetX = Math.min(allowedX, Math.max(-allowedX, offsetX));
        offsetY = Math.min(allowedY, Math.max(-allowedY, offsetY));
      }

      function draw() {
        clampOffsets();
        const scale = baseScale * zoom;
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.clearRect(0, 0, STAGE, STAGE);
        ctx.drawImage(img, STAGE / 2 - w / 2 + offsetX, STAGE / 2 - h / 2 + offsetY, w, h);
      }

      zoomSlider.addEventListener("input", () => {
        zoom = Number(zoomSlider.value) / 100;
        draw();
      });

      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      stage.addEventListener("pointerdown", (e) => {
        dragging = true;
        stage.classList.add("is-dragging");
        lastX = e.clientX;
        lastY = e.clientY;
        stage.setPointerCapture(e.pointerId);
      });
      stage.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        offsetX += e.clientX - lastX;
        offsetY += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        draw();
      });
      const stopDrag = () => { dragging = false; stage.classList.remove("is-dragging"); };
      stage.addEventListener("pointerup", stopDrag);
      stage.addEventListener("pointerleave", stopDrag);

      draw();

      box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => {
        URL.revokeObjectURL(objectUrl);
        logoInput.value = "";
        closeModal();
      }));

      box.querySelector("#cropConfirmBtn").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.classList.add("is-loading");
        btn.disabled = true;
        try {
          const ratio = EXPORT / STAGE;
          const exportCanvas = document.createElement("canvas");
          exportCanvas.width = EXPORT;
          exportCanvas.height = EXPORT;
          const exportCtx = exportCanvas.getContext("2d");
          const scale = baseScale * zoom * ratio;
          const w = img.width * scale;
          const h = img.height * scale;
          exportCtx.drawImage(img, EXPORT / 2 - w / 2 + offsetX * ratio, EXPORT / 2 - h / 2 + offsetY * ratio, w, h);
          const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/jpeg", 0.92));
          await uploadLogo(new File([blob], "logo.jpg", { type: "image/jpeg" }));
          URL.revokeObjectURL(objectUrl);
          logoInput.value = "";
          closeModal();
        } catch (err) {
          toast(err.message || "Couldn't upload your logo.", "error");
          btn.classList.remove("is-loading");
          btn.disabled = false;
        }
      });
    });
  };
  img.onerror = () => {
    toast("Couldn't read that image — try a different file.", "error");
    URL.revokeObjectURL(objectUrl);
    logoInput.value = "";
  };
  img.src = objectUrl;
}

async function uploadLogo(file) {
  const fd = new FormData();
  fd.append("logo", file);

  logoWrap.classList.add("is-uploading");
  try {
    const res = await api.post("/seller/logo", fd);
    user = res?.user || user;
    setStoredUser(user);
    renderPlate();
    toast("Shop logo updated.", "success");
  } finally {
    logoWrap.classList.remove("is-uploading");
  }
}

document.getElementById("acctLogoRemoveBtn").addEventListener("click", () => {
  confirmSimple({
    title: "Remove shop logo?",
    description: "You'll go back to initials until you upload a new one.",
    confirmLabel: "Remove logo",
    tone: "danger",
    onConfirm: async () => {
      const res = await api.delete("/seller/logo");
      user = res?.user || user;
      setStoredUser(user);
      renderPlate();
      toast("Shop logo removed.", "success");
    },
  });
});

/* ---------------- business permit (view + replace) ---------------- */

function renderPermitCard() {
  const icon = document.getElementById("permitCardIcon");
  const title = document.getElementById("permitCardTitle");
  const sub = document.getElementById("permitCardSub");
  const viewBtn = document.getElementById("permitViewBtn");
  const dot = document.getElementById("acctBusinessDot");

  if (user?.seller?.has_business_permit) {
    icon.classList.add("is-good");
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>`;
    title.textContent = "Business permit on file";
    sub.textContent = "Visible to ShopUno admins for compliance checks.";
    viewBtn.hidden = false;
    dot.hidden = true;
  } else {
    icon.classList.remove("is-good");
    title.textContent = "No permit on file";
    sub.textContent = "Upload your Mayor's/Business Permit or DTI registration.";
    viewBtn.hidden = true;
    dot.hidden = false;
  }
}

document.getElementById("permitViewBtn").addEventListener("click", () => {
  if (!user?.documents?.business_permit) {
    toast("Couldn't find your permit link — try refreshing the page.", "error");
    return;
  }
  openDocumentViewer(user.documents.business_permit, "Business Permit");
});

const permitReplaceZone = document.getElementById("permitReplaceZone");
const permitDrop = document.getElementById("permitDrop");
const permitInput = document.getElementById("permitInput");
const permitDropInner = document.getElementById("permitDropInner");
const permitUploadBtn = document.getElementById("permitUploadBtn");
const permitError = document.getElementById("permitError");
const PERMIT_MAX_BYTES = 5 * 1024 * 1024;

document.getElementById("permitReplaceBtn").addEventListener("click", () => {
  permitReplaceZone.hidden = false;
});
document.getElementById("permitCancelBtn").addEventListener("click", () => {
  if (permitPreviewUrl) { URL.revokeObjectURL(permitPreviewUrl); permitPreviewUrl = null; }
  permitReplaceZone.hidden = true;
  permitInput.value = "";
  permitUploadBtn.disabled = true;
  permitError.hidden = true;
  permitDrop.classList.remove("has-file");
  permitDropInner.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
    <span>Tap to upload a clear photo or scan</span>
    <span class="file-drop-hint">Mayor's/Business Permit or DTI reg. · JPG, PNG, or PDF · max 5MB</span>
  `;
});

let permitPreviewUrl = null;

permitInput.addEventListener("change", () => {
  const file = permitInput.files[0];
  if (permitPreviewUrl) { URL.revokeObjectURL(permitPreviewUrl); permitPreviewUrl = null; }
  if (!file) { permitDrop.classList.remove("has-file"); permitUploadBtn.disabled = true; return; }
  if (file.size > PERMIT_MAX_BYTES) {
    permitError.textContent = "That file is too large — please upload something under 5MB.";
    permitError.hidden = false;
    permitInput.value = "";
    permitDrop.classList.remove("has-file");
    permitUploadBtn.disabled = true;
    return;
  }
  permitError.hidden = true;
  const sizeKb = Math.round(file.size / 1024);
  const isImage = file.type.startsWith("image/");
  if (isImage) {
    permitPreviewUrl = URL.createObjectURL(file);
    permitDropInner.innerHTML = `
      <img class="file-drop-thumb" src="${permitPreviewUrl}" alt="">
      <span>${escapeHtml(file.name)}</span>
      <span class="file-drop-hint">${sizeKb} KB · tap to replace</span>
    `;
  } else {
    permitDropInner.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
      <span>${escapeHtml(file.name)}</span>
      <span class="file-drop-hint">${sizeKb} KB · tap to replace</span>
    `;
  }
  permitDrop.classList.add("has-file");
  permitUploadBtn.disabled = false;
});

permitUploadBtn.addEventListener("click", async () => {
  const file = permitInput.files[0];
  if (!file) return;

  const fd = new FormData();
  fd.append("business_permit", file);

  permitUploadBtn.classList.add("is-loading");
  permitUploadBtn.disabled = true;
  try {
    const res = await api.post("/seller/business-permit", fd);
    user = res?.user || user;
    setStoredUser(user);
    renderPermitCard();
    document.getElementById("permitCancelBtn").click();
    toast(res?.message || "Business permit updated.", "success");
  } catch (err) {
    permitError.textContent = err.fieldErrors?.business_permit?.[0] || err.message || "Couldn't upload your permit.";
    permitError.hidden = false;
  } finally {
    permitUploadBtn.classList.remove("is-loading");
    permitUploadBtn.disabled = false;
  }
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
  { width: "12%", color: "var(--danger-deep)", label: "Very weak" },
  { width: "32%", color: "var(--danger)", label: "Weak" },
  { width: "58%", color: "var(--warn-deep)", label: "Fair" },
  { width: "80%", color: "var(--thrive)", label: "Good" },
  { width: "100%", color: "var(--thrive-deep)", label: "Strong" },
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

/* ---------------- profile tab: read-only summary ---------------- */

function renderProfileSummary() {
  if (!user) return;
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
    // The link route sits behind auth:sanctum, so a plain navigation
    // won't carry the bearer token — route it through the same
    // authenticated viewer the permit uses instead of a raw <a> open.
    docLink.addEventListener("click", (e) => {
      e.preventDefault();
      openDocumentViewer(user.documents.id, "Government ID");
    });
  } else {
    docLink.hidden = true;
  }
}

function renderAddressSummary() {
  const box = document.getElementById("acctAddressCurrent");
  const p = box.querySelector("p");
  const a = user?.address;
  if (a && (a.municipality || a.barangay)) {
    const line = [a.house_number, a.street, a.barangay, a.municipality, a.province].filter(Boolean).join(", ");
    p.textContent = line;
    p.classList.remove("is-empty");
  } else {
    p.textContent = "No pickup address on file yet.";
    p.classList.add("is-empty");
  }
}

/* ---------------- business save (Business tab) ---------------- */

document.getElementById("businessForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("businessSaveBtn");
  const errorBox = document.getElementById("businessError");
  const msg = document.getElementById("businessSaveMsg");
  errorBox.hidden = true;
  msg.classList.remove("is-shown");

  const businessName = document.getElementById("acctBusinessName").value.trim();
  const lineOfBusiness = document.getElementById("acctLineOfBusiness").value.trim();
  const shopDescription = document.getElementById("acctShopDescription").value.trim();
  const okName = validate.businessName();
  const okLine = validate.lineOfBusiness();
  if (!okName || !okLine) {
    errorBox.textContent = "Please fix the highlighted field(s) before saving.";
    errorBox.hidden = false;
    return;
  }

  btn.classList.add("is-loading");
  btn.disabled = true;
  try {
    const res = await api.patch("/me", { business_name: businessName, line_of_business: lineOfBusiness, shop_description: shopDescription || null });
    user = res?.user || user;
    setStoredUser(user);
    renderPlate();
    captureBaseline("business");
    msg.classList.add("is-shown");
    setTimeout(() => msg.classList.remove("is-shown"), 2500);
    toast("Business profile updated.", "success");
  } catch (err) {
    errorBox.textContent = err.message || "Couldn't save your changes.";
    errorBox.hidden = false;
  } finally {
    btn.classList.remove("is-loading");
    btn.disabled = false;
  }
});

/* ---------------- contact save (Profile tab) ---------------- */

document.getElementById("contactForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("contactSaveBtn");
  const errorBox = document.getElementById("contactError");
  const msg = document.getElementById("contactSaveMsg");
  errorBox.hidden = true;
  msg.classList.remove("is-shown");

  const username = document.getElementById("acctUsername").value.trim();
  const sex = document.getElementById("acctSex").value;
  const birthday = document.getElementById("acctBirthday").value;

  const checks = [validate.firstName(), validate.lastName(), validate.middleInitial(), validate.username(), validate.email(), validate.contactNo()];
  if (checks.includes(false)) {
    errorBox.textContent = "Please fix the highlighted field(s) before saving.";
    errorBox.hidden = false;
    return;
  }
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
    if (sex) payload.sex = sex;
    if (birthday) payload.birthday = birthday;

    const res = await api.patch("/me", payload);
    user = res?.user || user;
    setStoredUser(user);
    renderPlate();
    renderProfileSummary();
    captureBaseline("contact");
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

/* ---------------- address cascade (adapted from buyer-account.js) ---------------- */

const addr = {
  region: document.getElementById("acctRegion"),
  province: document.getElementById("acctProvince"),
  municipality: document.getElementById("acctMunicipality"),
  barangay: document.getElementById("acctBarangay"),
  street: document.getElementById("acctStreet"),
  houseNumber: document.getElementById("acctHouseNumber"),
};
const provinceGroup = document.getElementById("acctProvinceGroup");
let regionHasProvinces = true;

function resetSelect(select, placeholder) {
  select.innerHTML = `<option value="" selected>${escapeHtml(placeholder)}</option>`;
  select.disabled = true;
}
function fillSelect(select, items, placeholder) {
  const options = items
    .map((item) => `<option value="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`)
    .join("");
  select.innerHTML = `<option value="" selected disabled>${escapeHtml(placeholder)}</option>${options}`;
  select.disabled = false;
}
function selectedLabel(select) {
  const opt = select.options[select.selectedIndex];
  return opt ? opt.dataset.name || opt.textContent : "";
}

async function loadRegions() {
  try {
    fillSelect(addr.region, await getRegions(), "Select region");
  } catch {
    resetSelect(addr.region, "Couldn't load regions — check connection");
  }
}

async function loadMunicipalities(regionName, provinceName) {
  resetSelect(addr.municipality, "Loading…");
  try {
    fillSelect(addr.municipality, await getCitiesMunicipalities(regionName, provinceName), "Select municipality / city");
  } catch {
    resetSelect(addr.municipality, "Couldn't load — try again");
  }
}

addr.region.addEventListener("change", async () => {
  regionHasProvinces = true;
  provinceGroup.hidden = false;
  resetSelect(addr.municipality, "Select province first");
  resetSelect(addr.barangay, "Select municipality first");

  if (!addr.region.value) {
    resetSelect(addr.province, "Select region first");
    return;
  }

  resetSelect(addr.province, "Loading…");
  const regionName = selectedLabel(addr.region);
  try {
    const provinces = await getProvinces(regionName);
    if (provinces.length) {
      fillSelect(addr.province, provinces, "Select province");
    } else {
      regionHasProvinces = false;
      provinceGroup.hidden = true;
      resetSelect(addr.province, "Not applicable for this region");
      await loadMunicipalities(regionName, null);
    }
  } catch {
    resetSelect(addr.province, "Couldn't load — try again");
  }
});

addr.province.addEventListener("change", async () => {
  resetSelect(addr.barangay, "Select municipality first");
  if (!addr.province.value) {
    resetSelect(addr.municipality, "Select province first");
    return;
  }
  await loadMunicipalities(selectedLabel(addr.region), selectedLabel(addr.province));
});

addr.municipality.addEventListener("change", async () => {
  resetSelect(addr.barangay, "Loading…");
  if (!addr.municipality.value) {
    resetSelect(addr.barangay, "Select municipality first");
    return;
  }
  try {
    fillSelect(addr.barangay, await getBarangays(addr.municipality.value), "Select barangay");
  } catch {
    resetSelect(addr.barangay, "Couldn't load — try again");
  }
});

/** Best-effort reverse lookup: municipality name -> region, so an existing
 * address opens pre-selected instead of forcing a full reselect. Silently
 * gives up (leaves the cascade blank) on any mismatch or network hiccup. */
async function prefillFromCurrentAddress() {
  const a = user?.address;
  if (!a?.municipality) return;

  addr.street.value = a.street || "";
  addr.houseNumber.value = a.house_number || "";

  try {
    const res = await fetch(`${PSGC_BASE}/cities-municipalities`, { headers: { Accept: "application/json" } });
    if (!res.ok) return;
    const json = await res.json();
    const all = Array.isArray(json) ? json : json.data || [];
    const match = all.find((c) => c.name?.toLowerCase() === a.municipality.toLowerCase());
    if (!match) return;

    const regions = await getRegions();
    const regionMatch = regions.find((r) => r.name === match.region);
    if (!regionMatch) return;

    addr.region.value = regionMatch.code;
    regionHasProvinces = true;
    provinceGroup.hidden = false;
    resetSelect(addr.province, "Loading…");

    const provinces = await getProvinces(match.region);
    let provinceName = null;
    if (provinces.length) {
      fillSelect(addr.province, provinces, "Select province");
      const provinceMatch = provinces.find((p) => p.name === a.province);
      if (provinceMatch) {
        addr.province.value = provinceMatch.code;
        provinceName = provinceMatch.name;
      }
    } else {
      regionHasProvinces = false;
      provinceGroup.hidden = true;
      resetSelect(addr.province, "Not applicable for this region");
    }

    await loadMunicipalities(match.region, provinceName);
    addr.municipality.value = match.code;

    const barangays = await getBarangays(match.code);
    fillSelect(addr.barangay, barangays, "Select barangay");
    const barangayMatch = barangays.find((b) => b.name.toLowerCase() === (a.barangay || "").toLowerCase());
    if (barangayMatch) addr.barangay.value = barangayMatch.code;
  } catch {
    // Reverse lookup failed — cascade stays blank, seller just reselects.
  }
}

/* ---------------- address save (Address tab) ---------------- */

document.getElementById("addressForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("addressSaveBtn");
  const errorBox = document.getElementById("addressError");
  const msg = document.getElementById("addressSaveMsg");
  errorBox.hidden = true;
  msg.classList.remove("is-shown");

  if (!addr.region.value || (regionHasProvinces && !addr.province.value) || !addr.municipality.value || !addr.barangay.value || !addr.street.value.trim() || !addr.houseNumber.value.trim()) {
    errorBox.textContent = "Please complete every address field.";
    errorBox.hidden = false;
    return;
  }

  const payload = {
    address: {
      province: regionHasProvinces ? selectedLabel(addr.province) : selectedLabel(addr.region),
      municipality: selectedLabel(addr.municipality),
      barangay: selectedLabel(addr.barangay),
      street: addr.street.value.trim(),
      house_number: addr.houseNumber.value.trim(),
    },
  };

  btn.classList.add("is-loading");
  btn.disabled = true;
  try {
    const res = await api.patch("/me", payload);
    user = res?.user || user;
    setStoredUser(user);
    renderAddressSummary();
    captureBaseline("address");
    msg.classList.add("is-shown");
    setTimeout(() => msg.classList.remove("is-shown"), 2500);
    toast("Pickup address updated.", "success");
  } catch (err) {
    errorBox.textContent = err.message || "Couldn't save your address.";
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
    captureBaseline("password");
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
