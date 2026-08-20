// assets/js/lib/ui.js
// Small shared UI helpers used across every admin page: toasts, a generic
// modal (including a note/reason prompt used by most moderation actions),
// and formatting utilities. No framework — plain DOM.

let toastStack = null;

function ensureToastStack() {
  if (!toastStack) {
    toastStack = document.createElement("div");
    toastStack.className = "toast-stack";
    document.body.appendChild(toastStack);
  }
  return toastStack;
}

export function toast(message, type = "default") {
  const stack = ensureToastStack();
  const el = document.createElement("div");
  el.className = `toast${type === "error" ? " is-error" : type === "success" ? " is-success" : ""}`;
  el.innerHTML = `
    <span class="toast-mark">${type === "error" ? "✕" : type === "success" ? "✓" : "•"}</span>
    <span class="toast-msg"></span>
  `;
  el.querySelector(".toast-msg").textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .2s ease";
    setTimeout(() => el.remove(), 200);
  }, 3200);
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
      if (e.target === overlayEl) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlayEl.classList.contains("is-open")) closeModal();
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
 */
export function openModal(render, { wide = false } = {}) {
  const overlay = ensureOverlay();
  const box = overlay.querySelector(".modal-box");
  box.classList.toggle("is-wide", wide);
  box.innerHTML = "";
  render(box);
  overlay.classList.add("is-open");
  return { overlay, box, close: closeModal };
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
  openModal((box) => {
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
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
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
        stampText ? playStampFx(box, stampText, tone) : closeModal();
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
  openModal((box) => {
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
    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    const confirmBtn = box.querySelector("[data-confirm]");
    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `<span class="spinner"></span>`;
      try {
        await onConfirm();
        stampText ? playStampFx(box, stampText, tone) : closeModal();
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
function playStampFx(box, text, tone) {
  box.classList.add("is-stamping");
  const layer = document.createElement("div");
  layer.className = "stamp-fx-layer";
  const markClass = tone === "chili" ? "is-reject" : tone === "teal" ? "is-approve" : "is-neutral";
  layer.innerHTML = `<div class="stamp-fx-mark ${markClass}">${escapeHtml(text)}</div>`;
  box.appendChild(layer);
  setTimeout(closeModal, 720);
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
 * Normalizes the two paginated shapes the API returns:
 *  - Resource::collection($paginator) → { data: { data: [...], meta: {...} } }
 *  - a raw $paginator → { data: { data: [...], current_page, last_page, total, ... } }
 *  - a plain (unpaginated) collection → { data: [...] }
 * Always returns { items, meta } where meta is null when there's no pagination.
 */
export function normalizePaginated(json) {
  const d = json?.data;
  if (Array.isArray(d)) return { items: d, meta: null };
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
