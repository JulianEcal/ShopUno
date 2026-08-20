// assets/js/pages/admin-announcements.js
import { api } from "../api.js";
import { initShell } from "../partials/admin-shell.js";
import {
  escapeHtml, formatDateTime, toast, normalizePaginated,
  openModal, closeModal, confirmSimple,
} from "../lib/ui.js";

const content = initShell({
  page: "announcements",
  title: "Announcements",
  eyebrow: "Platform",
  actions: `<button class="btn btn-primary" id="newAnnouncementBtn">+ New announcement</button>`,
});

content.innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Site-wide announcements</h3>
        <p>Shown as banners across the app. Drafts are visible here but not to users.</p>
      </div>
    </div>
    <div class="panel-body is-flush">
      <div id="list"><div class="empty-state">Loading announcements…</div></div>
    </div>
  </div>
`;

document.getElementById("newAnnouncementBtn").addEventListener("click", () => openForm());

load();

async function load() {
  const list = document.getElementById("list");
  list.innerHTML = `<div class="empty-state">Loading announcements…</div>`;
  try {
    const json = await api.get("/admin/announcements");
    const { items } = normalizePaginated(json);
    renderList(items);
  } catch (err) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(err.message || "Failed to load announcements.")}</div>`;
  }
}

function renderList(items) {
  const list = document.getElementById("list");
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-title">No announcements yet</div>Post one to let everyone on the platform know what's new.</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (a) => `
      <div class="activity-row" style="padding:18px 22px; align-items:flex-start;">
        <div class="activity-body">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span style="font-family:'Fraunces',serif; font-weight:600; font-size:15.5px;">${escapeHtml(a.title)}</span>
            <span class="badge ${a.is_published ? "badge-active" : "badge-deactivated"}">${a.is_published ? "Published" : "Draft"}</span>
          </div>
          <div class="activity-summary" style="color:var(--ink-soft);">${escapeHtml(a.body)}</div>
          <div class="activity-time">By ${escapeHtml(a.admin ? `${a.admin.first_name} ${a.admin.last_name}` : "—")} · ${formatDateTime(a.created_at)}</div>
        </div>
        <div class="cell-actions">
          <button class="btn btn-sm btn-outline" data-edit="${a.id}">Edit</button>
          <button class="btn btn-sm btn-chili" data-delete="${a.id}">Delete</button>
        </div>
      </div>`
    )
    .join("");

  list.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      const a = items.find((x) => String(x.id) === b.dataset.edit);
      openForm(a);
    })
  );
  list.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", () => deleteAnnouncement(b.dataset.delete)));
}

function openForm(existing) {
  const isEdit = Boolean(existing);
  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>${isEdit ? "Edit announcement" : "New announcement"}</h3>
          <p>${isEdit ? "Update the title, body, or publish status." : "This will be shown as a banner once published."}</p>
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="field-group">
          <label for="annTitle">Title</label>
          <input type="text" id="annTitle" maxlength="150" value="${escapeHtml(existing?.title || "")}" placeholder="e.g. Scheduled maintenance this weekend">
        </div>
        <div class="field-group">
          <label for="annBody">Message</label>
          <textarea id="annBody" maxlength="5000" placeholder="Write the announcement…" style="min-height:120px;">${escapeHtml(existing?.body || "")}</textarea>
        </div>
        <div class="checkbox-row">
          <input type="checkbox" id="annPublished" ${existing ? (existing.is_published ? "checked" : "") : "checked"}>
          <label for="annPublished" style="font-weight:500;">Published (visible to users)</label>
        </div>
        <div class="field-error" data-error hidden></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" data-save>${isEdit ? "Save changes" : "Post announcement"}</button>
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));

    box.querySelector("[data-save]").addEventListener("click", async () => {
      const title = box.querySelector("#annTitle").value.trim();
      const body = box.querySelector("#annBody").value.trim();
      const is_published = box.querySelector("#annPublished").checked;
      const errorBox = box.querySelector("[data-error]");
      errorBox.hidden = true;

      if (!title || !body) {
        errorBox.textContent = "Both a title and message are required.";
        errorBox.hidden = false;
        return;
      }

      const btn = box.querySelector("[data-save]");
      btn.disabled = true;
      const original = btn.textContent;
      btn.innerHTML = `<span class="spinner"></span>`;
      try {
        if (isEdit) {
          await api.put(`/admin/announcements/${existing.id}`, { title, body, is_published });
          toast("Announcement updated.", "success");
        } else {
          await api.post("/admin/announcements", { title, body, is_published });
          toast("Announcement posted.", "success");
        }
        closeModal();
        load();
      } catch (err) {
        errorBox.textContent = err.message || "Failed to save announcement.";
        errorBox.hidden = false;
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  });
}

function deleteAnnouncement(id) {
  confirmSimple({
    title: "Delete this announcement?",
    description: "This can't be undone. It will no longer be visible to users.",
    confirmLabel: "Delete",
    tone: "chili",
    onConfirm: async () => {
      await api.delete(`/admin/announcements/${id}`);
      toast("Announcement deleted.", "success");
      load();
    },
  });
}
