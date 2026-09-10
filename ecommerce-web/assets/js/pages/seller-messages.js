// assets/js/pages/seller-messages.js
// Seller inbox (seller/messages.html). Same generic /conversations API as
// the buyer inbox (see buyer-messages.js — messaging is role-agnostic on
// the backend), restyled for the seller console's two-pane "workbench"
// panel instead of the buyer's floating card. Supports a `?c=<id>` deep
// link so "Message buyer" on an order jumps straight into that thread.
//
// REAL-TIME NOTE: same as buyer-messages.js — no broadcasting layer on the
// backend yet, so this fills the gap with interval polling. Swap
// startThreadPolling / startListPolling for an Echo subscription once the
// backend grows a MessageSent broadcast event.

import { api } from "../api.js";
import { initShell, refreshMessagesBadge } from "../partials/seller-shell.js";
import { escapeHtml, toast, debounce, normalizePaginated, openImageLightbox, confirmSimple } from "../lib/ui.js";
import {
  ATTACHMENT_ACCEPT, attachmentError, formatFileSize,
  REACTION_EMOJIS, applyOptimisticReaction,
} from "../lib/messaging.js";

const THREAD_POLL_MS = 4000;
const LIST_POLL_MS = 8000;

// Mirrors the backend's own 10-minute unsend window (see the note on the
// DELETE /conversations/{c}/messages/{m} endpoint in messaging.js) —
// checked client-side too so the Unsend button just quietly disappears
// once the window's closed, instead of the seller tapping it and getting
// a rejected request back.
const UNSEND_WINDOW_MS = 10 * 60 * 1000;

function canUnsend(m) {
  if (!m || !m.is_mine || m.pending || m.is_unsent) return false;
  const sentAt = new Date(m.created_at).getTime();
  if (isNaN(sentAt)) return false;
  return Date.now() - sentAt < UNSEND_WINDOW_MS;
}

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 21l1.5-5a8.5 8.5 0 1 1 16.5-4.5Z"/>',
  attach: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  chevron: '<polyline points="6 9 12 15 18 9"/>',
};

function icon(name, extra = "") {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICONS[name] || ""}</svg>`;
}

const PALETTES = ["thrive", "accent", "warn"];

function paletteFor(id) {
  const n = Number(id) || 0;
  return PALETTES[n % PALETTES.length];
}

function initialsFor(name) {
  const parts = String(name || "").trim().split(/\s+/);
  const a = (parts[0] || "?")[0] || "?";
  const b = (parts[1] || "")[0] || "";
  return (a + b).toUpperCase();
}

/** Avatar circle for a conversation row / thread head — an actual photo
 * when the participant has one, initials otherwise. */
function avatarHtml(person, fallbackId) {
  const name = person?.name || "ShopUno buyer";
  const palette = paletteFor(person?.id ?? fallbackId);
  if (person?.avatar_url) {
    return `<span class="msg-avatar msg-avatar--${palette}"><img src="${escapeHtml(person.avatar_url)}" alt=""></span>`;
  }
  return `<span class="msg-avatar msg-avatar--${palette}">${escapeHtml(initialsFor(name))}</span>`;
}

function otherPerson(conversation) {
  return conversation?.participants?.[0] || null;
}

function timeShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const diffDays = Math.round((now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function clockTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dayLabel(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

const state = {
  conversations: [],
  loadingList: true,
  activeId: null,
  activeConversation: null,
  messages: [],
  renderedIds: new Set(),
  page: 1,
  lastPage: 1,
  loadingThread: false,
  loadingOlder: false,
  sending: false,
  searchQuery: "",
  threadPollTimer: null,
  listPollTimer: null,
  pendingAttachment: null, // File staged in the composer, not yet sent
  reactingToId: null, // id of the message the emoji picker is currently open for
  expandedGroups: new Map(), // product-group key -> explicit true/false the seller set by clicking; unset = default to "expanded if it contains the open thread"
};

// A deep link from an order's "Message buyer" button (?c=<conversation id>)
// selects that thread once the list has loaded — see loadConversations().
const deepLinkId = Number(new URLSearchParams(location.search).get("c")) || null;

const content = initShell({ page: "messages", title: "Messages", eyebrow: "Seller console" });

content.innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Buyer conversations</h3>
        <p>Everything buyers have messaged you about orders and products, all in one place.</p>
      </div>
    </div>
    <div class="panel-body is-flush">
      <div class="msg-shell" id="msgShell">
        <div class="msg-list-col" id="msgListCol">
          <div class="msg-list-head">
            <div class="msg-search">
              ${icon("search")}
              <input type="search" id="msgSearchInput" placeholder="Search conversations…" autocomplete="off">
            </div>
          </div>
          <div class="msg-list-scroll" id="msgListScroll">${listSkeleton()}</div>
        </div>

        <div class="msg-thread-col" id="msgThreadCol">
          ${emptyThreadPane()}
        </div>
      </div>
    </div>
  </div>
`;

document.getElementById("msgSearchInput").addEventListener(
  "input",
  debounce((e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderConversationList();
  }, 250)
);

loadConversations({ initial: true });
startListPolling();

/* ================= conversation list ================= */

function listSkeleton() {
  return Array.from({ length: 4 })
    .map(
      () => `
    <div class="msg-row msg-row-skel">
      <div class="msg-avatar-skel"></div>
      <div class="msg-row-body">
        <div class="sk-line w60"></div>
        <div class="sk-line w40"></div>
      </div>
    </div>`
    )
    .join("");
}

async function loadConversations({ initial = false, silent = false } = {}) {
  if (initial) state.loadingList = true;
  try {
    const res = await api.get("/conversations");
    state.conversations = res?.data || [];
    state.loadingList = false;
    renderConversationList();
    refreshMessagesBadge();

    // First load only: honor the ?c= deep link once we actually have the
    // conversation list to select from.
    if (initial && deepLinkId && !state.activeId) {
      const match = state.conversations.find((c) => c.id === deepLinkId);
      if (match) selectConversation(deepLinkId);
    }
  } catch (err) {
    state.loadingList = false;
    if (!silent) {
      document.getElementById("msgListScroll").innerHTML = errorState(err.message || "Couldn't load your messages.");
    }
  }
}

function filteredConversations() {
  if (!state.searchQuery) return state.conversations;
  return state.conversations.filter((c) => {
    const name = otherPerson(c)?.name || "";
    const preview = c.last_message?.body || "";
    const product = c.product?.name || "";
    return (name + " " + preview + " " + product).toLowerCase().includes(state.searchQuery);
  });
}

function renderConversationList() {
  const scroll = document.getElementById("msgListScroll");
  if (!scroll) return;
  const list = filteredConversations();

  if (state.loadingList) {
    scroll.innerHTML = listSkeleton();
    return;
  }

  if (!state.conversations.length) {
    scroll.innerHTML = `
      <div class="msg-empty-list">
        <span class="state-seal">${icon("chat", 'width="18" height="18"')}</span>
        <h3>No messages yet</h3>
        <p>Once a buyer messages you about an order or a product, it'll show up here.</p>
      </div>`;
    return;
  }

  if (!list.length) {
    scroll.innerHTML = `<div class="msg-empty-list"><p>No conversations match "${escapeHtml(state.searchQuery)}".</p></div>`;
    return;
  }

  scroll.innerHTML = groupConversations(list)
    .map((g) => (g.items.length > 1 ? conversationGroupHtml(g) : conversationRowHtml(g.items[0])))
    .join("");

  scroll.querySelectorAll("[data-conv-id]").forEach((row) => {
    row.addEventListener("click", () => selectConversation(Number(row.dataset.convId)));
  });
  scroll.querySelectorAll("[data-group-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => toggleGroup(btn.dataset.groupToggle, btn));
  });
}

/**
 * Different variants of the same product each get their own conversation
 * row on the backend now (see ConversationController::store) — great for
 * keeping "which size did they ask about" unambiguous, but left alone it
 * means a buyer bouncing between three sizes of the same jersey clutters
 * the inbox with three near-identical rows. This folds sibling threads —
 * same buyer, same product, no order attached — into one collapsible
 * group, purely for display; each thread underneath is still its own real
 * conversation, nothing about selecting/sending changes. Order-scoped and
 * general (no-product) conversations are never grouped.
 */
function groupConversations(list) {
  const groups = [];
  const byKey = new Map();
  list.forEach((c) => {
    const key = !c.order_id && c.product ? `${otherPerson(c)?.id}:${c.product.id}` : null;
    if (!key) {
      groups.push({ key: `single-${c.id}`, items: [c] });
      return;
    }
    const existing = byKey.get(key);
    if (existing) {
      existing.items.push(c);
    } else {
      const group = { key, items: [c] };
      byKey.set(key, group);
      groups.push(group);
    }
  });
  return groups;
}

function isGroupExpanded(g) {
  // A manual toggle always wins over the default — otherwise a group
  // holding the currently-open thread could never be collapsed, since
  // "contains the active conversation" would keep re-forcing it open.
  if (state.expandedGroups.has(g.key)) return state.expandedGroups.get(g.key);
  return g.items.some((c) => c.id === state.activeId);
}

function toggleGroup(key, btn) {
  const groupEl = btn.closest(".msg-group");
  const currentlyExpanded = groupEl ? groupEl.classList.contains("is-expanded") : false;
  state.expandedGroups.set(key, !currentlyExpanded);
  renderConversationList();
}

function conversationGroupHtml(g) {
  const head = g.items[0]; // list is already most-recent-first, so this is the freshest thread
  const person = otherPerson(head);
  const name = person?.name || "ShopUno buyer";
  const totalUnread = g.items.reduce((sum, c) => sum + (c.unread_count || 0), 0);
  const expanded = isGroupExpanded(g);

  return `
    <div class="msg-group${expanded ? " is-expanded" : ""}">
      <button type="button" class="msg-row msg-group-header${totalUnread ? " is-unread" : ""}" data-group-toggle="${g.key}">
        ${avatarHtml(person, head.id)}
        <span class="msg-row-body">
          <span class="msg-row-top">
            <span class="msg-row-name">${escapeHtml(name)}</span>
            <span class="msg-row-time">${timeShort(head.last_message?.created_at || head.updated_at)}</span>
          </span>
          <span class="msg-row-bottom">
            <span class="msg-row-preview">${g.items.length} conversations about this item</span>
            ${totalUnread ? `<span class="msg-unread-dot"></span>` : ""}
          </span>
          <span class="msg-row-item">
            ${head.product.image_url ? `<img src="${escapeHtml(head.product.image_url)}" alt="">` : ""}
            <span>${escapeHtml(head.product.name)}</span>
          </span>
        </span>
        <span class="msg-group-caret">${icon("chevron")}</span>
      </button>
      <div class="msg-group-children"${expanded ? "" : " hidden"}>
        ${g.items.map((c) => conversationSubRowHtml(c)).join("")}
      </div>
    </div>`;
}

/** A single variant thread nested under a conversationGroupHtml() header —
 * same info as conversationRowHtml() but without repeating the avatar/
 * product chip the group header above it already shows. The variant
 * itself (e.g. "[Small / Mbappe]") lives in the message body's own bracket
 * tag (see messaging.js), so the preview text alone already identifies
 * which thread is which. */
function conversationSubRowHtml(c) {
  const person = otherPerson(c);
  const isUnread = (c.unread_count || 0) > 0;
  const isActive = c.id === state.activeId;
  const preview = c.last_message
    ? c.last_message.is_unsent
      ? (c.last_message.sender_id === person?.id ? "This buyer unsent a message." : "You unsent a message.")
      : `${c.last_message.sender_id === person?.id ? "" : "You: "}${escapeHtml(c.last_message.body)}`
    : "No messages yet.";

  return `
    <button type="button" class="msg-row msg-subrow${isUnread ? " is-unread" : ""}${isActive ? " is-active" : ""}" data-conv-id="${c.id}">
      <span class="msg-subrow-dot" aria-hidden="true"></span>
      <span class="msg-row-body">
        <span class="msg-row-top">
          <span class="msg-row-time">${timeShort(c.last_message?.created_at || c.updated_at)}</span>
        </span>
        <span class="msg-row-bottom">
          <span class="msg-row-preview">${preview}</span>
          ${isUnread ? `<span class="msg-unread-dot"></span>` : ""}
        </span>
      </span>
    </button>`;
}

function conversationRowHtml(c) {
  const person = otherPerson(c);
  const name = person?.name || "ShopUno buyer";
  const isUnread = (c.unread_count || 0) > 0;
  const isActive = c.id === state.activeId;
  const preview = c.last_message
    ? c.last_message.is_unsent
      ? (c.last_message.sender_id === person?.id ? "This buyer unsent a message." : "You unsent a message.")
      : `${c.last_message.sender_id === person?.id ? "" : "You: "}${escapeHtml(c.last_message.body)}`
    : "No messages yet.";

  return `
    <button type="button" class="msg-row${isUnread ? " is-unread" : ""}${isActive ? " is-active" : ""}" data-conv-id="${c.id}">
      ${avatarHtml(person, c.id)}
      <span class="msg-row-body">
        <span class="msg-row-top">
          <span class="msg-row-name">${escapeHtml(name)}</span>
          <span class="msg-row-time">${timeShort(c.last_message?.created_at || c.updated_at)}</span>
        </span>
        <span class="msg-row-bottom">
          <span class="msg-row-preview">${preview}</span>
          ${isUnread ? `<span class="msg-unread-dot"></span>` : ""}
        </span>
        ${c.order_id ? `<span class="msg-row-order">Order #${c.order_id}</span>` : ""}
        ${c.product ? `
          <span class="msg-row-item">
            ${c.product.image_url ? `<img src="${escapeHtml(c.product.image_url)}" alt="">` : ""}
            <span>${escapeHtml(c.product.name)}</span>
          </span>` : ""}
      </span>
    </button>`;
}

function errorState(message) {
  return `
    <div class="msg-empty-list">
      <span class="state-seal">✕</span>
      <h3>Something went wrong</h3>
      <p>${escapeHtml(message)}</p>
    </div>`;
}

/* ================= thread ================= */

function emptyThreadPane() {
  return `
    <div class="msg-empty-pane">
      <span class="state-seal">${icon("chat", 'width="18" height="18"')}</span>
      <h3>Select a conversation</h3>
      <p>Pick a thread on the left to read and reply.</p>
    </div>`;
}

async function selectConversation(id) {
  if (state.activeId === id) return;
  stopThreadPolling();
  closeEmojiPicker();
  state.activeId = id;
  state.activeConversation = state.conversations.find((c) => c.id === id) || null;
  state.messages = [];
  state.renderedIds = new Set();
  state.page = 1;
  state.lastPage = 1;
  state.pendingAttachment = null;

  document.getElementById("msgShell").classList.add("is-thread-open");
  renderConversationList();
  renderThreadShell();
  await loadThread({ initial: true });
  startThreadPolling();
}

function backToList() {
  stopThreadPolling();
  closeEmojiPicker();
  state.activeId = null;
  state.activeConversation = null;
  state.pendingAttachment = null;
  document.getElementById("msgShell").classList.remove("is-thread-open");
  document.getElementById("msgThreadCol").innerHTML = emptyThreadPane();
  renderConversationList();
}

function renderThreadShell() {
  const col = document.getElementById("msgThreadCol");
  const c = state.activeConversation;
  const person = otherPerson(c);
  const name = person?.name || "ShopUno buyer";

  col.innerHTML = `
    <div class="msg-thread-head">
      <button type="button" class="msg-back-btn" id="msgBackBtn" aria-label="Back to conversations">${icon("back")}</button>
      ${avatarHtml(person, c?.id)}
      <span class="msg-thread-who">
        <strong>${escapeHtml(name)}</strong>
        <span>${person?.role ? escapeHtml(person.role[0].toUpperCase() + person.role.slice(1)) : "ShopUno"}${c?.order_id ? ` · Order #${c.order_id}` : ""}</span>
      </span>
      ${c?.order_id ? `<a class="btn btn-sm btn-outline" href="orders.html?view=${c.order_id}" style="margin-left:auto;">View order</a>` : ""}
    </div>
    ${c?.product ? `
      <div class="msg-thread-product">
        ${c.product.image_url
          ? `<img src="${escapeHtml(c.product.image_url)}" alt="">`
          : `<span class="msg-thread-product-noimg">${escapeHtml((c.product.name || "?").slice(0, 1).toUpperCase())}</span>`}
        <span class="msg-thread-product-info">
          <small>About this item</small>
          <span>${escapeHtml(c.product.name)}</span>
        </span>
      </div>` : ""}
    <div class="msg-thread-scroll" id="msgThreadScroll">
      <div class="msg-thread-loading"><span class="spinner"></span></div>
    </div>
    <div class="msg-emoji-picker" id="msgEmojiPicker" hidden>
      ${REACTION_EMOJIS.map((e) => `<button type="button" class="msg-emoji-opt" data-emoji="${e}">${e}</button>`).join("")}
    </div>
    <div class="msg-composer-wrap">
      <div class="msg-attach-preview" id="msgAttachPreview" hidden></div>
      <form class="msg-composer" id="msgComposer">
        <input type="file" id="msgFileInput" accept="${ATTACHMENT_ACCEPT}" hidden>
        <button type="button" class="msg-attach-btn" id="msgAttachBtn" aria-label="Attach a file">${icon("attach")}</button>
        <textarea id="msgInput" rows="1" maxlength="2000" placeholder="Write a message…"></textarea>
        <button type="submit" class="msg-send-btn" id="msgSendBtn" aria-label="Send message" disabled>${icon("send")}</button>
      </form>
    </div>
  `;

  document.getElementById("msgBackBtn").addEventListener("click", backToList);

  const input = document.getElementById("msgInput");
  const sendBtn = document.getElementById("msgSendBtn");
  const updateSendState = () => {
    sendBtn.disabled = (!input.value.trim() && !state.pendingAttachment) || state.sending;
  };
  input.addEventListener("input", () => {
    updateSendState();
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("msgComposer").requestSubmit();
    }
  });
  document.getElementById("msgComposer").addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage();
  });

  const fileInput = document.getElementById("msgFileInput");
  document.getElementById("msgAttachBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    const err = attachmentError(file);
    if (err) {
      toast(err, "error");
      return;
    }
    stagePendingAttachment(file);
    updateSendState();
  });

  // Reactions: a bare click on an existing pill toggles it directly; the
  // small smiley button on a bubble opens the picker to add a *new* one.
  // Delegated on the scroll container since bubbles re-render constantly
  // (polling, pagination) — binding per-row would mean re-binding every time.
  const scrollEl = document.getElementById("msgThreadScroll");
  scrollEl.addEventListener("click", (e) => {
    const pill = e.target.closest("[data-react-emoji]");
    if (pill) {
      const row = pill.closest("[data-msg-id]");
      if (row) toggleReaction(row.dataset.msgId, pill.dataset.reactEmoji);
      return;
    }
    const reactBtn = e.target.closest("[data-react-toggle]");
    if (reactBtn) {
      openEmojiPicker(reactBtn);
      return;
    }
    const unsendBtn = e.target.closest("[data-unsend-toggle]");
    if (unsendBtn) {
      const row = unsendBtn.closest("[data-msg-id]");
      if (row) confirmUnsend(row.dataset.msgId);
      return;
    }
    const imgBtn = e.target.closest("[data-lightbox-url]");
    if (imgBtn) {
      openImageLightbox(imgBtn.dataset.lightboxUrl, imgBtn.dataset.lightboxCaption || "");
    }
  });

  const picker = document.getElementById("msgEmojiPicker");
  picker.addEventListener("click", (e) => {
    const opt = e.target.closest("[data-emoji]");
    if (!opt) return;
    if (state.reactingToId != null) toggleReaction(state.reactingToId, opt.dataset.emoji);
    closeEmojiPicker();
  });
}

async function loadThread({ initial = false } = {}) {
  const scroll = document.getElementById("msgThreadScroll");
  state.loadingThread = true;
  try {
    const first = normalizePaginated(await api.get(`/conversations/${state.activeId}/messages`));
    let items = first.items;
    let meta = first.meta;

    // Messages come back oldest-first, paginated 30/page — page 1 is the
    // OLDEST 30, not the most recent ones. Jump straight to the last page
    // so a thread opens showing the latest messages, same as any chat app.
    if (meta && meta.last_page > 1) {
      const last = normalizePaginated(await api.get(`/conversations/${state.activeId}/messages?page=${meta.last_page}`));
      items = last.items;
      meta = last.meta;
    }

    state.messages = items;
    state.renderedIds = new Set(items.map((m) => m.id));
    state.page = meta?.current_page || 1;
    state.lastPage = meta?.last_page || 1;
    state.loadingThread = false;

    renderThreadMessages({ scrollToBottom: true });
    // Mark-as-read happens server-side on this GET — refresh the badge/list
    // so the unread dot clears without waiting for the next list poll.
    markLocallyRead(state.activeId);
    refreshMessagesBadge();
  } catch (err) {
    state.loadingThread = false;
    scroll.innerHTML = `<div class="msg-thread-loading">${errorState(err.message || "Couldn't load this conversation.")}</div>`;
  }
}

async function loadOlderMessages() {
  if (state.loadingOlder || state.page <= 1) return;
  state.loadingOlder = true;
  const scroll = document.getElementById("msgThreadScroll");
  const prevHeight = scroll.scrollHeight;

  try {
    const targetPage = state.page - 1;
    const { items } = normalizePaginated(await api.get(`/conversations/${state.activeId}/messages?page=${targetPage}`));
    const fresh = items.filter((m) => !state.renderedIds.has(m.id));
    fresh.forEach((m) => state.renderedIds.add(m.id));
    state.messages = [...fresh, ...state.messages];
    state.page = targetPage;
    renderThreadMessages({ scrollToBottom: false });
    scroll.scrollTop = scroll.scrollHeight - prevHeight;
  } catch (err) {
    toast(err.message || "Couldn't load earlier messages.", "error");
  } finally {
    state.loadingOlder = false;
  }
}

function attachmentHtml(attachment) {
  if (!attachment) return "";
  if (attachment.type === "image") {
    return `
      <button type="button" class="msg-attachment-image" data-lightbox-url="${escapeHtml(attachment.url)}" data-lightbox-caption="${escapeHtml(attachment.name || "")}">
        <img src="${escapeHtml(attachment.url)}" alt="${escapeHtml(attachment.name || "")}" loading="lazy">
      </button>`;
  }
  return `
    <a class="msg-attachment-file" href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener">
      <span class="msg-attachment-file-icon">${icon("file")}</span>
      <span class="msg-attachment-file-info">
        <strong>${escapeHtml(attachment.name || "Attachment")}</strong>
        <small>${formatFileSize(attachment.size)}</small>
      </span>
      <span class="msg-attachment-file-dl">${icon("download")}</span>
    </a>`;
}

function reactionsHtml(m) {
  const reactions = m.reactions || [];
  if (!reactions.length) return "";
  return `
    <div class="msg-reactions">
      ${reactions.map((r) => `
        <button type="button" class="msg-reaction-pill${r.reacted_by_me ? " is-mine" : ""}" data-react-emoji="${escapeHtml(r.emoji)}">
          <span>${r.emoji}</span><small>${r.count}</small>
        </button>`).join("")}
    </div>`;
}

function renderThreadMessages({ scrollToBottom }) {
  const scroll = document.getElementById("msgThreadScroll");
  if (!scroll) return;

  let html = state.page > 1 ? `<button type="button" class="msg-load-older" id="msgLoadOlder">Load earlier messages</button>` : "";
  let lastDay = null;
  let lastSender = null;

  state.messages.forEach((m) => {
    const day = dayLabel(m.created_at);
    if (day !== lastDay) {
      // Includes the clock time of this day's first message, so the
      // divider doubles as "conversation (re)started at ___" for the day,
      // not just which day it was.
      html += `<div class="msg-day-divider">${escapeHtml(day)} · ${clockTime(m.created_at)}</div>`;
      lastDay = day;
      lastSender = null;
    }
    const grouped = lastSender === m.sender_id;
    html += `
      <div class="msg-bubble-row${m.is_mine ? " is-mine" : ""}${grouped ? " is-grouped" : ""}${m.pending ? " is-pending" : ""}${m.is_unsent ? " is-unsent" : ""}" data-msg-id="${m.id}">
        <div class="msg-bubble-col">
          ${m.is_unsent
            ? `<div class="msg-bubble-unsent">${icon("undo")}<span>${m.is_mine ? "You unsent a message" : "This message was unsent"}</span></div>`
            : `${attachmentHtml(m.attachment)}${m.body ? `<div class="msg-bubble">${escapeHtml(m.body)}</div>` : ""}${reactionsHtml(m)}`}
          ${m.pending ? "" : `<div class="msg-bubble-time">${clockTime(m.created_at)}</div>`}
        </div>
        ${m.pending || m.is_unsent ? "" : `<button type="button" class="msg-react-btn" data-react-toggle aria-label="React">${icon("smile")}</button>`}
        ${canUnsend(m) ? `<button type="button" class="msg-unsend-btn" data-unsend-toggle aria-label="Unsend message" title="Unsend — available for 10 min after sending">${icon("undo")}</button>` : ""}
      </div>`;
    lastSender = m.sender_id;
  });

  if (!state.messages.length) {
    html += `
      <div class="msg-thread-empty">
        <p>No messages yet — send the first one below.</p>
      </div>`;
  }

  scroll.innerHTML = html;

  const olderBtn = document.getElementById("msgLoadOlder");
  if (olderBtn) olderBtn.addEventListener("click", loadOlderMessages);

  if (scrollToBottom) scroll.scrollTop = scroll.scrollHeight;
  scheduleUnsendExpiryRefresh();
}

/* ================= unsend ================= */

// The Unsend button's visibility is computed at render time from
// canUnsend(), so nothing re-checks it on its own as the clock ticks —
// without this, a button would sit there clickable (and then get
// rejected by the backend) for however long it took something else to
// trigger a re-render. This finds the soonest a still-unsendable message
// in view will age out of the window and schedules exactly one re-render
// for that moment, so the button quietly disappears on time.
let unsendExpiryTimer = null;
function scheduleUnsendExpiryRefresh() {
  clearTimeout(unsendExpiryTimer);
  unsendExpiryTimer = null;
  const now = Date.now();
  let soonest = null;
  state.messages.forEach((m) => {
    if (!m.is_mine || m.pending || m.is_unsent) return;
    const sentAt = new Date(m.created_at).getTime();
    if (isNaN(sentAt)) return;
    const expiresAt = sentAt + UNSEND_WINDOW_MS;
    if (expiresAt > now && (soonest === null || expiresAt < soonest)) soonest = expiresAt;
  });
  if (soonest !== null) {
    unsendExpiryTimer = setTimeout(() => renderThreadMessages({ scrollToBottom: false }), soonest - now + 250);
  }
}

function confirmUnsend(messageId) {
  const msg = state.messages.find((m) => String(m.id) === String(messageId));
  if (!canUnsend(msg)) {
    // Window closed (or something else changed it) between the button
    // rendering and the click landing — drop the stale button instead of
    // sending a request we already know the backend will reject.
    toast("That message can no longer be unsent.", "error");
    renderThreadMessages({ scrollToBottom: false });
    return;
  }
  confirmSimple({
    title: "Unsend this message?",
    description: "It'll be replaced with \u201cMessage unsent\u201d for both of you. This can't be undone.",
    confirmLabel: "Unsend",
    tone: "danger",
    onConfirm: async () => {
      const res = await api.delete(`/conversations/${state.activeId}/messages/${messageId}`);
      const idx = state.messages.findIndex((m) => String(m.id) === String(messageId));
      const updated = res?.message || { ...msg, is_unsent: true, body: null, attachment: null, reactions: [] };
      if (idx !== -1) state.messages[idx] = updated;
      renderThreadMessages({ scrollToBottom: false });
      reflectUnsendInList(state.activeId, updated);
    },
  });
}

/** If the unsent message was also the conversation list's last-message
 * preview, patch that preview in place instead of waiting for the next
 * silent list poll to catch up. */
function reflectUnsendInList(conversationId, updatedMessage) {
  const c = state.conversations.find((x) => x.id === conversationId);
  if (!c || !c.last_message) return;
  if (new Date(c.last_message.created_at).getTime() !== new Date(updatedMessage.created_at).getTime()) return;
  c.last_message = { ...c.last_message, body: null, is_unsent: true };
  renderConversationList();
}

async function sendMessage() {
  const input = document.getElementById("msgInput");
  const sendBtn = document.getElementById("msgSendBtn");
  const body = input.value.trim();
  const file = state.pendingAttachment;
  if ((!body && !file) || state.sending) return;

  state.sending = true;
  sendBtn.disabled = true;

  // Optimistic bubble so sending feels instant — replaced with the real
  // record (or rolled back) once the request settles. An image attachment
  // gets an instant local preview via a blob: URL; that URL is revoked as
  // soon as we have the real, server-hosted one (or on failure).
  const tempId = `temp-${Date.now()}`;
  const optimisticAttachment = file ? {
    type: file.type.startsWith("image/") ? "image" : "file",
    url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    name: file.name,
    mime: file.type,
    size: file.size,
  } : null;
  const optimistic = {
    id: tempId,
    body,
    sender_id: 0,
    is_mine: true,
    created_at: new Date().toISOString(),
    pending: true,
    attachment: optimisticAttachment,
    reactions: [],
  };
  state.messages.push(optimistic);
  renderThreadMessages({ scrollToBottom: true });
  input.value = "";
  input.style.height = "auto";
  clearPendingAttachment();

  try {
    let res;
    if (file) {
      const form = new FormData();
      if (body) form.append("body", body);
      form.append("attachment", file);
      res = await api.post(`/conversations/${state.activeId}/messages`, form);
    } else {
      res = await api.post(`/conversations/${state.activeId}/messages`, { body });
    }
    const real = res.message;
    const idx = state.messages.findIndex((m) => m.id === tempId);
    if (idx !== -1) state.messages[idx] = real;
    state.renderedIds.add(real.id);
    if (optimisticAttachment?.url) URL.revokeObjectURL(optimisticAttachment.url);
    renderThreadMessages({ scrollToBottom: true });
    bumpConversationPreview(state.activeId, real);
  } catch (err) {
    state.messages = state.messages.filter((m) => m.id !== tempId);
    if (optimisticAttachment?.url) URL.revokeObjectURL(optimisticAttachment.url);
    renderThreadMessages({ scrollToBottom: true });
    input.value = body;
    if (file) stagePendingAttachment(file); // don't make them re-pick the file after a network hiccup
    toast(err.message || "Message couldn't be sent. Try again.", "error");
  } finally {
    state.sending = false;
    sendBtn.disabled = !input.value.trim() && !state.pendingAttachment;
  }
}

/* ================= attachments (composer) ================= */

function stagePendingAttachment(file) {
  state.pendingAttachment = file;
  const preview = document.getElementById("msgAttachPreview");
  if (!preview) return;
  const isImage = file.type.startsWith("image/");
  const objectUrl = isImage ? URL.createObjectURL(file) : null;
  preview.innerHTML = `
    <div class="msg-attach-chip">
      ${isImage ? `<img src="${objectUrl}" alt="">` : `<span class="msg-attach-chip-icon">${icon("file")}</span>`}
      <span class="msg-attach-chip-info">
        <strong>${escapeHtml(file.name)}</strong>
        <small>${formatFileSize(file.size)}</small>
      </span>
      <button type="button" class="msg-attach-chip-remove" id="msgAttachRemove" aria-label="Remove attachment">${icon("x")}</button>
    </div>`;
  preview.hidden = false;
  preview._objectUrl = objectUrl;
  document.getElementById("msgAttachRemove").addEventListener("click", () => {
    clearPendingAttachment();
    const sendBtn = document.getElementById("msgSendBtn");
    const input = document.getElementById("msgInput");
    if (sendBtn) sendBtn.disabled = !input.value.trim();
  });
  const sendBtn = document.getElementById("msgSendBtn");
  if (sendBtn) sendBtn.disabled = state.sending;
}

function clearPendingAttachment() {
  state.pendingAttachment = null;
  const preview = document.getElementById("msgAttachPreview");
  if (!preview) return;
  if (preview._objectUrl) URL.revokeObjectURL(preview._objectUrl);
  preview._objectUrl = null;
  preview.hidden = true;
  preview.innerHTML = "";
}

/* ================= reactions ================= */

function openEmojiPicker(reactBtn) {
  const row = reactBtn.closest("[data-msg-id]");
  const picker = document.getElementById("msgEmojiPicker");
  // Position relative to the thread column, not `picker.offsetParent` —
  // the picker still has its `hidden` attribute at this point (display:none),
  // and a display:none element's offsetParent is null, which would throw
  // here and silently kill every click on the react button.
  const pane = document.getElementById("msgThreadCol");
  if (!row || !picker || !pane) return;

  // Toggle off if re-opening for the same message.
  if (!picker.hidden && state.reactingToId === row.dataset.msgId) {
    closeEmojiPicker();
    return;
  }

  state.reactingToId = row.dataset.msgId;
  const rowRect = row.getBoundingClientRect();
  const paneRect = pane.getBoundingClientRect();
  picker.style.top = `${rowRect.top - paneRect.top - 46}px`;
  const isMine = row.classList.contains("is-mine");
  if (isMine) {
    picker.style.right = `${paneRect.right - rowRect.right}px`;
    picker.style.left = "auto";
  } else {
    picker.style.left = `${rowRect.left - paneRect.left}px`;
    picker.style.right = "auto";
  }
  picker.hidden = false;
}

function closeEmojiPicker() {
  const picker = document.getElementById("msgEmojiPicker");
  if (picker) picker.hidden = true;
  state.reactingToId = null;
}

document.addEventListener("click", (e) => {
  const picker = document.getElementById("msgEmojiPicker");
  if (!picker || picker.hidden) return;
  if (e.target.closest("#msgEmojiPicker") || e.target.closest("[data-react-toggle]")) return;
  closeEmojiPicker();
});

async function toggleReaction(messageId, emoji) {
  if (String(messageId).startsWith("temp-")) return; // can't react before the send round-trip finishes
  const msg = state.messages.find((m) => String(m.id) === String(messageId));
  if (!msg) return;

  const prevReactions = msg.reactions || [];
  msg.reactions = applyOptimisticReaction(prevReactions, emoji);
  renderThreadMessages({ scrollToBottom: false });

  try {
    const res = await api.post(`/conversations/${state.activeId}/messages/${messageId}/reactions`, { emoji });
    msg.reactions = res.message.reactions || [];
    renderThreadMessages({ scrollToBottom: false });
  } catch (err) {
    msg.reactions = prevReactions;
    renderThreadMessages({ scrollToBottom: false });
    toast(err.message || "Couldn't react to that message.", "error");
  }
}

/* ================= local state helpers ================= */

function markLocallyRead(conversationId) {
  const c = state.conversations.find((c) => c.id === conversationId);
  if (c) c.unread_count = 0;
  renderConversationList();
}

function bumpConversationPreview(conversationId, message) {
  const c = state.conversations.find((c) => c.id === conversationId);
  if (!c) return;
  // Mirror the backend's fallback (ConversationResource) for an
  // attachment-only message so the list preview isn't blank until the
  // next list poll catches up.
  const body = message.body || (message.attachment ? (message.attachment.type === "image" ? "📷 Photo" : `📎 ${message.attachment.name || "Attachment"}`) : "");
  c.last_message = { body, sender_id: message.sender_id, created_at: message.created_at };
  c.updated_at = message.created_at;
  state.conversations = [c, ...state.conversations.filter((x) => x.id !== conversationId)];
  renderConversationList();
}

/* ================= polling (temporary — see file header) ================= */

function startThreadPolling() {
  stopThreadPolling();
  state.threadPollTimer = setInterval(pollThread, THREAD_POLL_MS);
}
function stopThreadPolling() {
  if (state.threadPollTimer) clearInterval(state.threadPollTimer);
  state.threadPollTimer = null;
}

async function pollThread() {
  if (!state.activeId || document.hidden) return;
  const pollingFor = state.activeId;
  try {
    const { items, meta } = normalizePaginated(await api.get(`/conversations/${pollingFor}/messages?page=${state.lastPage}`));
    if (state.activeId !== pollingFor) return; // switched threads mid-request

    // Merges a poll page against state.messages: appends anything not
    // rendered yet, and — since a message already on screen can still
    // change server-side (the other person unsends it, a reaction lands
    // from their side) — patches any already-rendered message whose data
    // has actually moved on, rather than only ever appending new ones.
    let changed = false;
    const mergePage = (pageItems) => {
      pageItems.forEach((m) => {
        if (!state.renderedIds.has(m.id)) {
          state.renderedIds.add(m.id);
          state.messages.push(m);
          changed = true;
          return;
        }
        const idx = state.messages.findIndex((x) => x.id === m.id);
        if (idx !== -1 && JSON.stringify(state.messages[idx]) !== JSON.stringify(m)) {
          state.messages[idx] = m;
          changed = true;
        }
      });
    };

    mergePage(items);
    if (meta?.last_page && meta.last_page !== state.lastPage) {
      // A new page rolled over (30+ messages arrived) — fetch that page instead.
      const bump = normalizePaginated(await api.get(`/conversations/${pollingFor}/messages?page=${meta.last_page}`));
      if (state.activeId !== pollingFor) return;
      state.lastPage = meta.last_page;
      state.page = meta.last_page;
      mergePage(bump.items);
    }
    if (!changed) return;

    const scroll = document.getElementById("msgThreadScroll");
    const wasNearBottom = scroll && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120;
    renderThreadMessages({ scrollToBottom: wasNearBottom });
    refreshMessagesBadge();
  } catch {
    // Silent — a missed poll tick isn't worth interrupting the reader over.
  }
}

function startListPolling() {
  state.listPollTimer = setInterval(() => {
    if (!document.hidden) loadConversations({ silent: true });
  }, LIST_POLL_MS);
}
