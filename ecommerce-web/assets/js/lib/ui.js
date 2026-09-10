// assets/js/lib/ui.js
// Small shared UI helpers used across every admin page: toasts, a generic
// modal (including a note/reason prompt used by most moderation actions),
// and formatting utilities. No framework — plain DOM.

import { fetchAuthedFile } from "../api.js";

let toastStack = null;

function ensureToastStack() {
  if (!toastStack) {
    toastStack = document.createElement("div");
    toastStack.className = "toast-stack";
    document.body.appendChild(toastStack);
  }
  return toastStack;
}

/**
 * `opts.actionLabel` + `opts.onAction` render a small action button inside
 * the toast (used for "Undo" after a soft-delete) — clicking it cancels the
 * auto-dismiss timer immediately. `opts.duration` overrides the default
 * 3.2s (undo toasts get longer so there's real time to react).
 */
export function toast(message, type = "default", opts = {}) {
  const { actionLabel, onAction, duration = 3200 } = opts;
  const stack = ensureToastStack();
  const el = document.createElement("div");
  el.className = `toast${type === "error" ? " is-error" : type === "success" ? " is-success" : ""}`;
  el.innerHTML = `
    <span class="toast-mark">${type === "error" ? "✕" : type === "success" ? "✓" : "•"}</span>
    <span class="toast-msg"></span>
    ${actionLabel ? `<button type="button" class="toast-action"></button>` : ""}
  `;
  el.querySelector(".toast-msg").textContent = message;

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.style.opacity = "0";
    el.style.transition = "opacity .2s ease";
    setTimeout(() => el.remove(), 200);
  };

  if (actionLabel) {
    const btn = el.querySelector(".toast-action");
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      clearTimeout(timer);
      dismiss();
      onAction?.();
    });
  }

  stack.appendChild(el);
  const timer = setTimeout(dismiss, duration);
  return dismiss;
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function timeAgo(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function money(value) {
  const n = Number(value || 0);
  return "₱" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function debounce(fn, wait = 350) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function fullName(person) {
  if (!person) return "—";
  return `${person.first_name || ""} ${person.last_name || ""}`.trim() || "—";
}

/* ---------------- Modal ---------------- */

let overlayEl = null;

function ensureOverlay() {
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.className = "modal-overlay";
    overlayEl.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(overlayEl);
    overlayEl.addEventListener("click", (e) => {
      if (e.target !== overlayEl) return;
      if (overlayEl.dataset.persistent === "1") return;
      closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !overlayEl.classList.contains("is-open")) return;
      if (overlayEl.dataset.persistent === "1") return;
      closeModal();
    });
  }
  return overlayEl;
}

export function closeModal() {
  if (overlayEl) overlayEl.classList.remove("is-open");
}

/**
 * Opens a modal with custom HTML content. `render(box)` receives the
 * `.modal-box` element to populate; return value is ignored.
 *
 * `persistent: true` disables backdrop-click and Escape closing — use it
 * for multi-step flows (like the add-product wizard) where an accidental
 * outside click shouldn't silently discard whatever the seller just typed.
 * The modal can still be closed programmatically via closeModal() or
 * forceCloseModal(), typically from an explicit Close/Cancel button that
 * runs its own "are you sure?" check first when there's unsaved input.
 */
export function openModal(render, { wide = false, xwide = false, persistent = false } = {}) {
  const overlay = ensureOverlay();
  const box = overlay.querySelector(".modal-box");
  box.classList.toggle("is-wide", wide);
  box.classList.toggle("is-xwide", xwide);
  overlay.dataset.persistent = persistent ? "1" : "0";
  box.innerHTML = "";
  render(box);
  overlay.classList.add("is-open");
  return { overlay, box, close: closeModal };
}

/** Escape hatch for persistent modals: closes regardless of the persistent
 * flag. Used once a seller has explicitly confirmed they want to exit a
 * flow like the add-product wizard. */
export function forceCloseModal() {
  if (overlayEl) {
    overlayEl.dataset.persistent = "0";
    overlayEl.classList.remove("is-open");
  }
}

/* ---------------- Confirm dialog (stacked, not the shared modal) ----------------
 * confirmSimple/confirmWithNote used to call openModal(), which reuses the
 * SAME overlay/box as whatever modal is already open (e.g. the add-product
 * wizard, or the manage-product modal's Options tab). That meant confirming
 * something like "remove this value?" would wipe the parent modal's DOM to
 * show the confirmation, and afterwards closeModal() — which just hides the
 * one shared overlay — closed everything, kicking the seller out of the
 * wizard/modal entirely instead of returning them to where they were. It
 * also clobbered the parent modal's `persistent` flag.
 *
 * Fix: give confirm dialogs their own overlay (same approach already used
 * by the image lightbox to stack on top of an open modal — see
 * ensureLightbox above) so confirming or cancelling never touches the
 * modal underneath. */

let confirmOverlayEl = null;

function ensureConfirmOverlay() {
  if (!confirmOverlayEl) {
    confirmOverlayEl = document.createElement("div");
    confirmOverlayEl.className = "modal-overlay";
    // Inline z-index so this always sits above the page's modal-overlay
    // (whose z-index varies per stylesheet) without needing CSS changes.
    confirmOverlayEl.style.zIndex = "9999";
    confirmOverlayEl.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(confirmOverlayEl);
    confirmOverlayEl.addEventListener("click", (e) => {
      if (e.target === confirmOverlayEl) closeConfirmDialog();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && confirmOverlayEl.classList.contains("is-open")) closeConfirmDialog();
    });
  }
  return confirmOverlayEl;
}

function closeConfirmDialog() {
  if (confirmOverlayEl) confirmOverlayEl.classList.remove("is-open");
}

function openConfirmDialog(render) {
  const overlay = ensureConfirmOverlay();
  const box = overlay.querySelector(".modal-box");
  box.classList.remove("is-wide", "is-xwide");
  box.innerHTML = "";
  render(box);
  overlay.classList.add("is-open");
}

/**
 * A confirmation modal that requires a short text note before proceeding —
 * used for warn / suspend / deactivate / reject / flag / resolve / archive,
 * all of which require a note or reason on the backend.
 */
export function confirmWithNote({
  title,
  description = "",
  fieldLabel = "Note",
  fieldPlaceholder = "Explain the reason for this action…",
  confirmLabel = "Confirm",
  tone = "chili", // chili | teal | ochre | primary
  maxLength = 500,
  stampText = null,
  onConfirm, // async (note) => void — throwing keeps the modal open and shows the error
}) {
  openConfirmDialog((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="field-group">
          <label for="modal-note">${escapeHtml(fieldLabel)}</label>
          <textarea id="modal-note" maxlength="${maxLength}" placeholder="${escapeHtml(fieldPlaceholder)}"></textarea>
          <div class="field-error" data-error hidden></div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-close>Cancel</button>
        <button type="button" class="btn btn-${tone}" data-confirm>${escapeHtml(confirmLabel)}</button>
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeConfirmDialog));
    const confirmBtn = box.querySelector("[data-confirm]");
    const textarea = box.querySelector("#modal-note");
    const errorBox = box.querySelector("[data-error]");
    textarea.focus();

    confirmBtn.addEventListener("click", async () => {
      const note = textarea.value.trim();
      errorBox.hidden = true;
      if (!note) {
        errorBox.textContent = "Please enter a note before continuing.";
        errorBox.hidden = false;
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `<span class="spinner"></span>`;
      try {
        await onConfirm(note);
        stampText ? playStampFx(box, stampText, tone, closeConfirmDialog) : closeConfirmDialog();
      } catch (err) {
        errorBox.textContent = err.message || "Something went wrong. Please try again.";
        errorBox.hidden = false;
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmLabel;
      }
    });
  });
}

/** A plain yes/no confirmation, no note field — used for lighter actions like activate.
 * Pass `stampText` (e.g. "APPROVED") to play a stamp-impact animation in place of an
 * instant close once onConfirm succeeds — reserve this for the handful of actions that
 * genuinely deserve the weight of a stamp (approve/reject-style decisions). */
export function confirmSimple({
  title,
  description = "",
  confirmLabel = "Confirm",
  tone = "primary",
  stampText = null,
  onConfirm,
}) {
  openConfirmDialog((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        </div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-close>Cancel</button>
        <button type="button" class="btn btn-${tone}" data-confirm>${escapeHtml(confirmLabel)}</button>
      </div>
    `;
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeConfirmDialog));
    const confirmBtn = box.querySelector("[data-confirm]");
    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `<span class="spinner"></span>`;
      try {
        await onConfirm();
        stampText ? playStampFx(box, stampText, tone, closeConfirmDialog) : closeConfirmDialog();
      } catch (err) {
        toast(err.message || "Something went wrong.", "error");
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmLabel;
      }
    });
  });
}

/** Stamps `text` (e.g. "APPROVED") down onto an open modal box, then closes it —
 * the moment this whole design language has been describing its badges after
 * without ever actually doing. Reused by confirmSimple and confirmWithNote. */
function playStampFx(box, text, tone, close) {
  box.classList.add("is-stamping");
  const layer = document.createElement("div");
  layer.className = "stamp-fx-layer";
  const markClass = tone === "chili" ? "is-reject" : tone === "teal" ? "is-approve" : "is-neutral";
  layer.innerHTML = `<div class="stamp-fx-mark ${markClass}">${escapeHtml(text)}</div>`;
  box.appendChild(layer);
  setTimeout(close, 720);
}

export function statusBadge(status) {
  const cls = String(status || "").toLowerCase().replace(/\s+/g, "_");
  return `<span class="badge badge-${escapeHtml(cls)}">${escapeHtml(String(status || "—").replace(/_/g, " "))}</span>`;
}

export function roleBadge(role) {
  const cls = String(role || "").toLowerCase();
  return `<span class="badge badge-${escapeHtml(cls)}">${escapeHtml(role || "—")}</span>`;
}

/**
 * Normalizes the paginated shapes the API can return:
 *  - current shape → { data: [...], meta: { current_page, last_page, total, per_page } }
 *  - legacy nested shape (older endpoints, kept for safety) → { data: { data: [...], meta: {...} } }
 *  - legacy raw paginator (older endpoints, kept for safety) → { data: { data: [...], current_page, ... } }
 *  - a plain (unpaginated) collection → { data: [...] }, no meta
 * Always returns { items, meta } where meta is null when there's no pagination.
 */
export function normalizePaginated(json) {
  const d = json?.data;
  if (Array.isArray(d)) return { items: d, meta: json?.meta || null };
  if (d && Array.isArray(d.data)) {
    const meta = d.meta || {
      current_page: d.current_page,
      last_page: d.last_page,
      total: d.total,
      per_page: d.per_page,
    };
    return { items: d.data, meta };
  }
  return { items: [], meta: null };
}

/* ---------------- Skeletons & empty states ---------------- */
// Shared "shimmer" placeholders so tables show the shape of what's loading
// instead of a plain "Loading…" row, and one consistent empty state for
// when a filtered view genuinely has nothing in it.

export function skeletonRows(colCount, rowCount = 5) {
  const cells = Array.from({ length: colCount }, (_, i) => `
    <td><span class="skel-bar" style="width:${i === 0 ? "72%" : "50%"}"></span></td>
  `).join("");
  return Array.from({ length: rowCount }, () => `<tr class="skel-row">${cells}</tr>`).join("");
}

export function emptyStateRow(colCount, { title = "Nothing here yet", subtitle = "", icon = "" } = {}) {
  return `
    <tr><td colspan="${colCount}">
      <div class="empty-state">
        ${icon || '<svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16v16H4z" opacity="0"/><path d="M3 7h18M3 7l1.5 12a1.5 1.5 0 0 0 1.5 1.3h12a1.5 1.5 0 0 0 1.5-1.3L21 7M3 7l2-4h14l2 4"/></svg>'}
        <div class="empty-title">${escapeHtml(title)}</div>
        ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
      </div>
    </td></tr>`;
}

/* ---------------- Document viewer ---------------- */
// A single overlay for previewing an applicant's uploaded ID / permit.
// Unlike a plain <img src> or <a target="_blank">, this fetches the file
// through the authenticated API client first (see fetchAuthedFile), so it
// keeps working even when the file route requires the admin's session —
// no more raw {"message":"Unauthenticated."} where a photo should be.

let docViewerEl = null;
let docViewerObjectUrl = null;

function ensureDocViewer() {
  if (!docViewerEl) {
    docViewerEl = document.createElement("div");
    docViewerEl.className = "doc-viewer-overlay";
    docViewerEl.innerHTML = `
      <div class="doc-viewer-box" role="dialog" aria-modal="true">
        <div class="doc-viewer-head">
          <span class="doc-viewer-caption"></span>
          <div class="doc-viewer-actions">
            <a class="btn btn-sm btn-outline" data-doc-download download>Download</a>
            <button type="button" class="modal-close" data-doc-close aria-label="Close">✕</button>
          </div>
        </div>
        <div class="doc-viewer-body"></div>
      </div>
    `;
    document.body.appendChild(docViewerEl);
    docViewerEl.addEventListener("click", (e) => {
      if (e.target === docViewerEl) closeDocumentViewer();
    });
    docViewerEl.querySelector("[data-doc-close]").addEventListener("click", closeDocumentViewer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && docViewerEl.classList.contains("is-open")) closeDocumentViewer();
    });
  }
  return docViewerEl;
}

export function closeDocumentViewer() {
  if (docViewerEl) docViewerEl.classList.remove("is-open");
  if (docViewerObjectUrl) {
    URL.revokeObjectURL(docViewerObjectUrl);
    docViewerObjectUrl = null;
  }
}

/** Opens `url` (a protected document URL) in a full-screen viewer, fetching
 * it with the admin's auth token first. Images render inline and zoomable;
 * PDFs render in an embedded frame; anything else falls back to a download
 * tile. `caption` labels the header and the downloaded filename. */
export async function openDocumentViewer(url, caption = "Document") {
  const el = ensureDocViewer();
  const body = el.querySelector(".doc-viewer-body");
  const downloadLink = el.querySelector("[data-doc-download]");
  el.querySelector(".doc-viewer-caption").textContent = caption;
  downloadLink.removeAttribute("href");
  body.innerHTML = `<div class="doc-viewer-loading"><span class="spinner"></span> Loading document…</div>`;
  el.classList.add("is-open");

  try {
    const { blob, contentType } = await fetchAuthedFile(url);
    if (docViewerObjectUrl) URL.revokeObjectURL(docViewerObjectUrl);
    docViewerObjectUrl = URL.createObjectURL(blob);
    downloadLink.href = docViewerObjectUrl;
    downloadLink.setAttribute("download", caption.replace(/\s+/g, "_"));

    if (contentType.startsWith("image/")) {
      body.innerHTML = `<img class="doc-viewer-img" src="${docViewerObjectUrl}" alt="${escapeHtml(caption)}">`;
    } else if (contentType === "application/pdf") {
      body.innerHTML = `<iframe class="doc-viewer-frame" src="${docViewerObjectUrl}" title="${escapeHtml(caption)}"></iframe>`;
    } else {
      body.innerHTML = `
        <div class="doc-viewer-fallback">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          <p>This file type can't be previewed here.</p>
        </div>`;
    }
  } catch (err) {
    body.innerHTML = `<div class="doc-viewer-fallback is-error"><p>${escapeHtml(err.message || "Couldn't load this file.")}</p></div>`;
  }
}

/* ---------------- Image lightbox ---------------- */
// A single full-screen viewer reused for any "click to enlarge" image across
// the admin (ID photos, product images, etc.) — separate from the generic
// modal so it can be opened on top of an already-open modal without closing it.

let lightboxEl = null;

function ensureLightbox() {
  if (!lightboxEl) {
    lightboxEl = document.createElement("div");
    lightboxEl.className = "img-lightbox-overlay";
    lightboxEl.innerHTML = `
      <figure class="img-lightbox-figure">
        <button type="button" class="img-lightbox-close" data-lightbox-close aria-label="Close">✕</button>
        <img class="img-lightbox-img" alt="">
        <figcaption class="img-lightbox-caption"></figcaption>
      </figure>
    `;
    document.body.appendChild(lightboxEl);
    lightboxEl.addEventListener("click", (e) => {
      if (e.target === lightboxEl || e.target.closest("[data-lightbox-close]")) closeImageLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && lightboxEl.classList.contains("is-open")) closeImageLightbox();
    });
  }
  return lightboxEl;
}

export function closeImageLightbox() {
  if (lightboxEl) lightboxEl.classList.remove("is-open");
}

/** Opens a full-screen preview of a single image. `caption` is optional. */
export function openImageLightbox(url, caption = "") {
  const el = ensureLightbox();
  const img = el.querySelector(".img-lightbox-img");
  const cap = el.querySelector(".img-lightbox-caption");
  img.src = url;
  img.alt = caption;
  cap.textContent = caption;
  el.classList.add("is-open");
}
