// assets/js/pages/admin-settings.js
import { api } from "../api.js";
import { initShell } from "../partials/admin-shell.js";
import { escapeHtml, toast } from "../lib/ui.js";

const content = initShell({ page: "settings", title: "Settings", eyebrow: "Platform" });

content.innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Platform settings</h3>
        <p>These values are shown in emails, the app header, and during registration.</p>
      </div>
    </div>
    <div class="panel-body">
      <form id="settingsForm">
        <div id="fieldsWrap"><div class="empty-state">Loading settings…</div></div>
        <div style="display:flex; justify-content:flex-end; margin-top:8px;">
          <button type="submit" class="btn btn-primary" id="saveBtn">Save changes</button>
        </div>
      </form>
    </div>
  </div>
`;

const LONG_TEXT_KEYS = ["terms_of_service", "privacy_policy", "seller_agreement"];

load();

async function load() {
  try {
    const { data } = await api.get("/admin/settings");
    renderFields(data || []);
  } catch (err) {
    document.getElementById("fieldsWrap").innerHTML = `<div class="empty-state">${escapeHtml(err.message || "Failed to load settings.")}</div>`;
  }
}

function renderFields(fields) {
  const wrap = document.getElementById("fieldsWrap");
  wrap.innerHTML = fields
    .map((f) => {
      const isLong = LONG_TEXT_KEYS.includes(f.key);
      const value = f.value ?? "";
      return `
        <div class="field-group">
          <label for="setting-${escapeHtml(f.key)}">${escapeHtml(f.label)}</label>
          <div class="hint">${escapeHtml(f.description || "")}</div>
          ${
            isLong
              ? `<textarea id="setting-${escapeHtml(f.key)}" data-key="${escapeHtml(f.key)}" style="min-height:140px;">${escapeHtml(value)}</textarea>`
              : `<input type="text" id="setting-${escapeHtml(f.key)}" data-key="${escapeHtml(f.key)}" value="${escapeHtml(value)}">`
          }
        </div>
      `;
    })
    .join("");
}

document.getElementById("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById("saveBtn");
  const inputs = document.querySelectorAll("[data-key]");
  const settings = {};
  inputs.forEach((el) => { settings[el.dataset.key] = el.value; });

  saveBtn.disabled = true;
  const original = saveBtn.textContent;
  saveBtn.innerHTML = `<span class="spinner"></span>`;
  try {
    await api.patch("/admin/settings", { settings });
    toast("Settings updated.", "success");
  } catch (err) {
    toast(err.message || "Failed to save settings.", "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = original;
  }
});
