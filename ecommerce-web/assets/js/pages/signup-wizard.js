// assets/js/pages/signup-wizard.js
// Drives the 4-step buyer sign-up wizard on login.html:
//   1. Account    — email, password, confirm
//   2. Details    — name, sex, birthday (age auto-computed), mobile number
//   3. Address    — Region → Province → Municipality/City → Barangay (live
//                   PSGC data), street, house no.
//   4. Verify     — ID type + upload, review summary, submit
// Every account starts as a Buyer; other roles are applied for later inside
// the app. On success, swaps the form out for a "pending approval" screen.
//
// Address step note: some regions (NCR/Metro Manila chief among them) have
// no province tier in the PSGC — cities sit directly under the region. When
// the selected region has zero provinces, the Province field is hidden and
// skipped, and the Municipality/City list is fetched straight from the
// region instead. `regionHasProvinces` tracks this per-selection so
// validation and the submitted payload agree with what's on screen.

import { register } from "../auth.js";
import { escapeHtml } from "../lib/ui.js";
import { getRegions, getProvinces, getCitiesMunicipalities, getBarangays } from "../lib/psgc.js";

const TOTAL_STEPS = 4;
const MIN_AGE = 18;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MOBILE_PATTERN = /^(09\d{9}|\+639\d{9})$/;

const ID_TYPE_LABELS = {
  national_id: "Philippine National ID",
  drivers_license: "Driver's License",
  passport: "Passport",
  umid: "UMID",
  voters_id: "Voter's ID",
  postal_id: "Postal ID",
};

export function initSignupWizard() {
  const form = document.getElementById("signupForm");
  if (!form) return; // page doesn't have the wizard — nothing to do

  const errorBox = document.getElementById("signupError");
  const stepsList = document.getElementById("wizardSteps");
  const panels = Array.from(document.querySelectorAll(".wizard-panel"));
  const backBtn = document.getElementById("wizardBack");
  const continueBtn = document.getElementById("wizardContinue");
  const submitBtn = document.getElementById("signupSubmit");

  const fields = {
    email: document.getElementById("signupEmail"),
    password: document.getElementById("signupPassword"),
    confirm: document.getElementById("signupConfirm"),
    lastName: document.getElementById("lastName"),
    firstName: document.getElementById("firstName"),
    middleInitial: document.getElementById("middleInitial"),
    sex: document.getElementById("sex"),
    birthday: document.getElementById("birthday"),
    ageDisplay: document.getElementById("ageDisplay"),
    contactNo: document.getElementById("contactNo"),
    region: document.getElementById("region"),
    province: document.getElementById("province"),
    municipality: document.getElementById("municipality"),
    barangay: document.getElementById("barangay"),
    street: document.getElementById("street"),
    houseNumber: document.getElementById("houseNumber"),
    idType: document.getElementById("idType"),
    idUpload: document.getElementById("idUpload"),
  };

  const provinceGroup = document.getElementById("provinceGroup");

  const fileDrop = document.getElementById("fileDrop");
  const fileDropInner = document.getElementById("fileDropInner");
  const summaryBox = document.getElementById("wizardSummary");

  const pendingPanel = document.getElementById("pendingPanel");
  const pendingName = document.getElementById("pendingName");
  const pendingEmail = document.getElementById("pendingEmail");

  // today, clamped so no one can pick a future birthday
  fields.birthday.max = new Date().toISOString().slice(0, 10);

  let currentStep = 1;
  let maxStepReached = 1;

  // Whether the currently-selected region has a province tier at all.
  // False for NCR and any other region where cities sit directly under
  // the region — Province is hidden and not required in that case.
  let regionHasProvinces = true;

  /* ------------------------------------------------------------- helpers */
  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function clearError() {
    errorBox.textContent = "";
    errorBox.hidden = true;
  }
  function setLoading(isLoading) {
    submitBtn.classList.toggle("is-loading", isLoading);
    submitBtn.disabled = isLoading;
    backBtn.disabled = isLoading;
  }

  function computeAge(birthdayStr) {
    if (!birthdayStr) return null;
    const dob = new Date(birthdayStr + "T00:00:00");
    if (Number.isNaN(dob.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age -= 1;
    return age;
  }

  fields.birthday.addEventListener("change", () => {
    const age = computeAge(fields.birthday.value);
    fields.ageDisplay.value = age === null ? "" : `${age} yrs`;
  });

  /* ------------------------------------------------------- step tracker */
  function renderSteps() {
    stepsList.querySelectorAll(".wizard-step").forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle("is-active", n === currentStep);
      li.classList.toggle("is-done", n < currentStep);
    });
  }

  function goToStep(n) {
    currentStep = n;
    maxStepReached = Math.max(maxStepReached, n);
    panels.forEach((p) => p.classList.toggle("is-active", Number(p.dataset.panel) === n));
    renderSteps();
    clearError();

    backBtn.hidden = n === 1;
    continueBtn.hidden = n === TOTAL_STEPS;
    submitBtn.hidden = n !== TOTAL_STEPS;

    if (n === TOTAL_STEPS) buildSummary();

    form.scrollTop = 0;
  }

  // Clicking an already-completed step jumps straight back to it.
  stepsList.querySelectorAll(".wizard-step").forEach((li) => {
    li.addEventListener("click", () => {
      const n = Number(li.dataset.step);
      if (n < currentStep) goToStep(n);
    });
    li.style.cursor = "pointer";
  });

  /* ------------------------------------------------------ per-step check */
  function validateStep(n) {
    if (n === 1) {
      if (!fields.email.value.trim() || !fields.email.checkValidity()) {
        return "Please enter a valid email address.";
      }
      if (fields.password.value.length < 8) {
        return "Password must be at least 8 characters.";
      }
      if (fields.password.value !== fields.confirm.value) {
        return "Passwords don't match.";
      }
      return null;
    }

    if (n === 2) {
      if (!fields.lastName.value.trim() || !fields.firstName.value.trim()) {
        return "Please enter your first and last name.";
      }
      if (!fields.sex.value) return "Please select your sex.";
      if (!fields.birthday.value) return "Please enter your birthday.";
      const age = computeAge(fields.birthday.value);
      if (age === null || age < 0) return "Please enter a valid birthday.";
      if (age < MIN_AGE) return `You must be at least ${MIN_AGE} years old to sign up.`;
      if (!fields.contactNo.value.trim() || !MOBILE_PATTERN.test(fields.contactNo.value.trim())) {
        return "Please enter a valid PH mobile number (e.g. 09171234567).";
      }
      return null;
    }

    if (n === 3) {
      if (!fields.region.value) return "Please select a region.";
      if (regionHasProvinces && !fields.province.value) return "Please select a province.";
      if (!fields.municipality.value) return "Please select a municipality or city.";
      if (!fields.barangay.value) return "Please select a barangay.";
      if (!fields.street.value.trim() || !fields.houseNumber.value.trim()) {
        return "Please complete your street and house number.";
      }
      return null;
    }

    if (n === 4) {
      if (!fields.idType.value) return "Please select the type of ID you're uploading.";
      if (!fields.idUpload.files[0]) return "Please upload a photo or scan of your ID.";
      return null;
    }

    return null;
  }

  continueBtn.addEventListener("click", () => {
    const message = validateStep(currentStep);
    if (message) {
      showError(message);
      return;
    }
    clearError();
    goToStep(Math.min(currentStep + 1, TOTAL_STEPS));
  });

  backBtn.addEventListener("click", () => {
    clearError();
    goToStep(Math.max(currentStep - 1, 1));
  });

  // Enter key should advance the wizard instead of submitting mid-flow.
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.target.tagName === "TEXTAREA") return;
    if (currentStep < TOTAL_STEPS) {
      event.preventDefault();
      continueBtn.click();
    }
  });

  /* -------------------------------------------------------- address API */
  function resetSelect(select, placeholder) {
    select.innerHTML = `<option value="" selected>${placeholder}</option>`;
    select.disabled = true;
  }

  function fillSelect(select, items, placeholder) {
    const options = items
      .map((item) => `<option value="${escapeHtml(item.code)}" data-name="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`)
      .join("");
    select.innerHTML = `<option value="" selected disabled>${placeholder}</option>${options}`;
    select.disabled = false;
  }

  function selectedLabel(select) {
    const opt = select.options[select.selectedIndex];
    return opt ? opt.dataset.name || opt.textContent : "";
  }

  async function loadRegions() {
    try {
      const regions = await getRegions();
      fillSelect(fields.region, regions, "Select region");
    } catch {
      resetSelect(fields.region, "Couldn't load regions — check connection");
    }
  }
  loadRegions();

  async function loadMunicipalities(regionName, provinceName) {
    resetSelect(fields.municipality, "Loading…");
    try {
      const towns = await getCitiesMunicipalities(regionName, provinceName);
      fillSelect(fields.municipality, towns, "Select municipality / city");
    } catch {
      resetSelect(fields.municipality, "Couldn't load — try again");
    }
  }

  fields.region.addEventListener("change", async () => {
    clearError();
    regionHasProvinces = true;
    provinceGroup.hidden = false;
    resetSelect(fields.municipality, "Select province first");
    resetSelect(fields.barangay, "Select municipality first");

    if (!fields.region.value) {
      resetSelect(fields.province, "Select region first");
      return;
    }

    resetSelect(fields.province, "Loading…");
    const regionName = selectedLabel(fields.region);
    try {
      const provinces = await getProvinces(regionName);
      if (provinces.length) {
        fillSelect(fields.province, provinces, "Select province");
      } else {
        // Regions like NCR have no province tier — skip straight to cities.
        regionHasProvinces = false;
        provinceGroup.hidden = true;
        resetSelect(fields.province, "Not applicable for this region");
        await loadMunicipalities(regionName, null);
      }
    } catch {
      resetSelect(fields.province, "Couldn't load — try again");
    }
  });

  fields.province.addEventListener("change", async () => {
    resetSelect(fields.barangay, "Select municipality first");
    if (!fields.province.value) {
      resetSelect(fields.municipality, "Select province first");
      return;
    }
    await loadMunicipalities(selectedLabel(fields.region), selectedLabel(fields.province));
  });

  fields.municipality.addEventListener("change", async () => {
    resetSelect(fields.barangay, "Loading…");
    if (!fields.municipality.value) {
      resetSelect(fields.barangay, "Select municipality first");
      return;
    }
    try {
      const barangays = await getBarangays(fields.municipality.value);
      fillSelect(fields.barangay, barangays, "Select barangay");
    } catch {
      resetSelect(fields.barangay, "Couldn't load — try again");
    }
  });

  /* ------------------------------------------------------------ file up */
  fields.idUpload.addEventListener("change", () => {
    const file = fields.idUpload.files[0];
    if (!file) {
      fileDrop.classList.remove("has-file");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showError("That file is too large — please upload something under 5MB.");
      fields.idUpload.value = "";
      fileDrop.classList.remove("has-file");
      return;
    }
    clearError();

    const sizeKb = Math.round(file.size / 1024);
    fileDropInner.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
      <span>${escapeHtml(file.name)}</span>
      <span class="file-drop-hint">${sizeKb} KB · tap to replace</span>
    `;
    fileDrop.classList.add("has-file");
    if (currentStep === TOTAL_STEPS) buildSummary();
  });

  fields.idType.addEventListener("change", () => {
    if (currentStep === TOTAL_STEPS) buildSummary();
  });

  /* -------------------------------------------------------------- review */
  function buildSummary() {
    const age = computeAge(fields.birthday.value);
    const fullName = [fields.firstName.value.trim(), fields.middleInitial.value.trim(), fields.lastName.value.trim()]
      .filter(Boolean)
      .join(" ");
    const address = [
      fields.houseNumber.value.trim(),
      fields.street.value.trim(),
      selectedLabel(fields.barangay),
      selectedLabel(fields.municipality),
      regionHasProvinces ? selectedLabel(fields.province) : null,
      selectedLabel(fields.region),
    ]
      .filter(Boolean)
      .join(", ");

    const rows = [
      ["Name", fullName],
      ["Email", fields.email.value.trim()],
      ["Mobile", fields.contactNo.value.trim()],
      ["Birthday", `${fields.birthday.value}${age !== null ? ` (${age} yrs)` : ""}`],
      ["Address", address],
      ["ID type", ID_TYPE_LABELS[fields.idType.value] || "—"],
    ];

    summaryBox.innerHTML = rows
      .map(([k, v]) => `<div class="wizard-summary-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v || "—")}</span></div>`)
      .join("");
  }

  /* -------------------------------------------------------------- submit */
  // Backend note: `addresses.province` is required and NOT nullable, and
  // there is no `region` column at all — so for NCR (no province tier) we
  // fall back to sending the region name itself as the province value.
  // That's the only sane non-empty value available and matches how NCR
  // addresses are commonly represented (no real province exists to send).
  function buildRegistrationFormData() {
    const fd = new FormData();
    fd.append("last_name", fields.lastName.value.trim());
    fd.append("first_name", fields.firstName.value.trim());
    fd.append("middle_initial", fields.middleInitial.value.trim());
    fd.append("sex", fields.sex.value);
    fd.append("email", fields.email.value.trim());
    fd.append("password", fields.password.value);
    fd.append("password_confirmation", fields.confirm.value);
    fd.append("contact_no", fields.contactNo.value.trim());
    fd.append("birthday", fields.birthday.value);
    fd.append("province", regionHasProvinces ? selectedLabel(fields.province) : selectedLabel(fields.region));
    fd.append("municipality", selectedLabel(fields.municipality));
    fd.append("barangay", selectedLabel(fields.barangay));
    fd.append("street", fields.street.value.trim());
    fd.append("house_number", fields.houseNumber.value.trim());
    fd.append("upload_id", fields.idUpload.files[0]);
    // Not stored server-side yet (RegisterBuyerRequest has no id_type field
    // and there's no matching users column) — sent anyway so the value
    // isn't silently lost if/when the backend adds support. The API just
    // ignores unrecognized fields today.
    fd.append("id_type", fields.idType.value);
    return fd;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (currentStep !== TOTAL_STEPS) return; // Enter-key guard above should prevent this anyway

    const message = validateStep(TOTAL_STEPS);
    if (message) {
      showError(message);
      return;
    }
    clearError();

    const displayInfo = {
      first_name: fields.firstName.value.trim(),
      email: fields.email.value.trim(),
    };

    setLoading(true);
    try {
      await register(buildRegistrationFormData());
      showPending(displayInfo);
    } catch (err) {
      showError(err?.message || "Couldn't submit your application. Please try again.");
      setLoading(false);
    }
  });

  function showPending(payload) {
    pendingName.textContent = payload.first_name || "friend";
    pendingEmail.textContent = payload.email;
    form.hidden = true;
    pendingPanel.hidden = false;
  }

  /* --------------------------------------------------------------- init */
  goToStep(1);
}