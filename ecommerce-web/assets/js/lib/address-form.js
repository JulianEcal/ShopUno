// assets/js/lib/address-form.js
// One implementation of "the address form" (label, recipient name/phone,
// Region -> Province -> Municipality -> Barangay cascade, street, house
// number, optional default toggle), shared by:
//   - buyer-account.js's Address tab (a full address book: add/edit/delete)
//   - buyer-cart.js's checkout "Change address" picker (add new address
//     inline, Shopee-style)
// Previously this cascade only existed once, inline in buyer-account.js —
// pulled out here so a second copy doesn't have to be hand-maintained in
// buyer-cart.js. Behavior (including the NCR-has-no-province-tier handling
// and the best-effort reverse-lookup prefill) is unchanged from the
// original.

import { escapeHtml } from "./ui.js";
import { getRegions, getProvinces, getCitiesMunicipalities, getBarangays } from "./psgc.js";

const PSGC_BASE = "https://psgc.cloud/api/v2";

/**
 * Returns the HTML for one address form's fields, given a unique `prefix`
 * used to namespace every element id (so more than one of these can exist
 * in the DOM at once — e.g. the account page's form and a checkout modal's
 * form, or several across re-renders). `opts.showDefaultToggle` adds a
 * "Set as default address" checkbox (used in the address book, not needed
 * the very first time a buyer has zero addresses since that one is always
 * made default automatically).
 */
export function addressFormFieldsHtml(prefix, opts = {}) {
  const { showDefaultToggle = false } = opts;

  return `
    <div class="addr-form-section-label">Recipient</div>
    <div class="acct-field-row">
      <div class="field-group">
        <label for="${prefix}Label">Label</label>
        <input type="text" id="${prefix}Label" placeholder="e.g. Home, Office" maxlength="40">
      </div>
      <div class="field-group">
        <label for="${prefix}RecipientPhone">Recipient's mobile number</label>
        <input type="text" id="${prefix}RecipientPhone" placeholder="e.g. 09171234567" inputmode="tel" autocomplete="tel">
      </div>
    </div>
    <div class="field-group">
      <label for="${prefix}RecipientName">Recipient's full name</label>
      <input type="text" id="${prefix}RecipientName" placeholder="Who should the courier hand this to?" autocomplete="name">
    </div>
    <div class="addr-form-section-label">Delivery location</div>
    <div class="acct-field-row">
      <div class="field-group">
        <label for="${prefix}Region">Region</label>
        <select id="${prefix}Region"><option value="" selected>Loading…</option></select>
      </div>
      <div class="field-group" id="${prefix}ProvinceGroup">
        <label for="${prefix}Province">Province</label>
        <select id="${prefix}Province" disabled><option value="" selected>Select region first</option></select>
      </div>
    </div>
    <div class="acct-field-row">
      <div class="field-group">
        <label for="${prefix}Municipality">Municipality / City</label>
        <select id="${prefix}Municipality" disabled><option value="" selected>Select region first</option></select>
      </div>
      <div class="field-group">
        <label for="${prefix}Barangay">Barangay</label>
        <select id="${prefix}Barangay" disabled><option value="" selected>Select municipality first</option></select>
      </div>
    </div>
    <div class="acct-field-row">
      <div class="field-group">
        <label for="${prefix}Street">Street</label>
        <input type="text" id="${prefix}Street" placeholder="e.g. Rizal St." autocomplete="address-line1">
      </div>
      <div class="field-group">
        <label for="${prefix}HouseNumber">House / unit no.</label>
        <input type="text" id="${prefix}HouseNumber" placeholder="e.g. 123" autocomplete="address-line2">
      </div>
    </div>
    ${showDefaultToggle ? `
      <label class="addr-default-toggle">
        <input type="checkbox" id="${prefix}IsDefault">
        <span>Set as default address</span>
      </label>
    ` : ""}
  `;
}

/**
 * Wires up the cascade's event listeners for a form previously rendered
 * with addressFormFieldsHtml(prefix, ...), and returns helpers to read,
 * validate, prefill, and reset it. Call this AFTER the markup is in the
 * DOM (e.g. right after setting .innerHTML or right after openModal's
 * render callback populates the box).
 */
export function bindAddressForm(prefix) {
  const el = (suffix) => document.getElementById(`${prefix}${suffix}`);
  const addr = {
    label: el("Label"),
    recipientName: el("RecipientName"),
    recipientPhone: el("RecipientPhone"),
    region: el("Region"),
    province: el("Province"),
    municipality: el("Municipality"),
    barangay: el("Barangay"),
    street: el("Street"),
    houseNumber: el("HouseNumber"),
    isDefault: el("IsDefault"),
  };
  const provinceGroup = el("ProvinceGroup");
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

  loadRegions();

  /** Best-effort reverse lookup: municipality name -> region, so an
   * existing address opens pre-selected instead of forcing a full
   * reselect. Silently gives up (leaves the cascade blank) on any
   * mismatch or network hiccup — this is a convenience, never a
   * requirement to proceed. Also fills in the non-cascade fields
   * (label, recipient, street, house number). */
  async function prefill(address) {
    if (!address) return;

    addr.label.value = address.label || "";
    addr.recipientName.value = address.recipient_name || "";
    addr.recipientPhone.value = address.recipient_phone || "";
    addr.street.value = address.street || "";
    addr.houseNumber.value = address.house_number || "";
    if (addr.isDefault) addr.isDefault.checked = !!address.is_default;

    if (!address.municipality) return;

    try {
      const res = await fetch(`${PSGC_BASE}/cities-municipalities`, { headers: { Accept: "application/json" } });
      if (!res.ok) return;
      const json = await res.json();
      const all = Array.isArray(json) ? json : json.data || [];
      const match = all.find((c) => c.name?.toLowerCase() === address.municipality.toLowerCase());
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
        const provinceMatch = provinces.find((p) => p.name === address.province);
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
      const barangayMatch = barangays.find((b) => b.name.toLowerCase() === (address.barangay || "").toLowerCase());
      if (barangayMatch) addr.barangay.value = barangayMatch.code;
    } catch {
      // Reverse lookup failed — cascade stays blank, buyer just reselects.
    }
  }

  /** True once every required field has a value. */
  function isComplete() {
    return !!(
      addr.recipientName.value.trim() &&
      addr.recipientPhone.value.trim() &&
      addr.region.value &&
      (!regionHasProvinces || addr.province.value) &&
      addr.municipality.value &&
      addr.barangay.value
    );
  }

  /** Reads the form into the exact payload shape POST/PUT /addresses expects. */
  function read() {
    return {
      label: addr.label.value.trim() || null,
      recipient_name: addr.recipientName.value.trim(),
      recipient_phone: addr.recipientPhone.value.trim(),
      province: regionHasProvinces ? selectedLabel(addr.province) : selectedLabel(addr.region),
      municipality: selectedLabel(addr.municipality),
      barangay: selectedLabel(addr.barangay),
      street: addr.street.value.trim() || null,
      house_number: addr.houseNumber.value.trim() || null,
      ...(addr.isDefault ? { is_default: addr.isDefault.checked } : {}),
    };
  }

  /**
   * Calls `callback` every time a required field changes, so a caller can
   * keep its "Save" button's disabled state in sync with isComplete() in
   * real time — instead of the buyer only finding out something's missing
   * after clicking Save and reading an error banner. Only covers fields
   * this module sets directly with .value (recipientName, recipientPhone)
   * or fires native change events for (the four cascade selects) — a
   * prefill() call does neither, so callers should re-run their own check
   * once that promise resolves too.
   */
  function watch(callback) {
    [addr.recipientName, addr.recipientPhone, addr.region, addr.province, addr.municipality, addr.barangay]
      .forEach((el) => {
        el.addEventListener("input", callback);
        el.addEventListener("change", callback);
      });
  }

  return { prefill, read, isComplete, watch };
}
