// assets/js/partials/admin-shell.js
// Renders the ticket-rail nav + topbar shared by every admin page, wires
// up logout, and fills the rail's notification badges from the dashboard's
// `needs_attention` block. Each page calls initShell({ page, title, eyebrow })
// and gets back a reference to the <main class="admin-content"> node to
// render its own content into.
//
// Nav concept: instead of a full-width sidebar, the rail sits collapsed
// at icon-width and expands over the content on hover/focus, or stays
// open if the admin pins it (preference remembered per-browser).

import { api } from "../api.js";
import { requireAuth, getUser, logout } from "../auth.js";

const NAV = [
  {
    group: "Overview",
    items: [{ key: "dashboard", label: "Dashboard", href: "dashboard.html", icon: "grid" }],
  },
  {
    group: "People",
    items: [
      { key: "registrations", label: "Registrations", href: "registrations.html", icon: "inbox", badgeKeys: ["pending_registrations", "pending_seller_applications"] },
      { key: "accounts", label: "Accounts", href: "accounts.html", icon: "users" },
    ],
  },
  {
    group: "Trust & Safety",
    items: [
      { key: "compliance", label: "Compliance", href: "compliance.html", icon: "shield", badgeKey: "flagged_products" },
      { key: "complaints", label: "Complaints", href: "complaints.html", icon: "flag", badgeKey: "open_complaints" },
    ],
  },
  {
    group: "Platform",
    items: [
      { key: "reports", label: "Reports", href: "reports.html", icon: "bar-chart" },
      { key: "announcements", label: "Announcements", href: "announcements.html", icon: "megaphone" },
      { key: "settings", label: "Settings", href: "settings.html", icon: "sliders" },
    ],
  },
];

const ICONS = {
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  "bar-chart": '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  megaphone: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 0 1-5.8-1.6"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  pin: '<path d="M12 17v5"/><path d="M8 12.5 5 14l2-6-2.5-2.5L9 4l3 1 3-1 4.5 1.5L17 8l2 6-3-1.5"/><path d="M8 12.5h8"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
};

const PIN_KEY = "shopuno_admin_nav_pinned";
const THEME_KEY = "shopuno_admin_theme";

// Applied at module load — before initShell rebuilds <body> — so a saved
// dark-mode preference takes effect immediately instead of flashing the
// light paper theme for a frame first.
try {
  if (localStorage.getItem(THEME_KEY) === "dark") document.documentElement.dataset.theme = "dark";
} catch {
  // Private browsing / storage disabled — default to the light theme.
}

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}

function initials(user) {
  const a = (user?.first_name || "?")[0] || "?";
  const b = (user?.last_name || "")[0] || "";
  return (a + b).toUpperCase();
}

// Flat, searchable index of every destination in NAV — the thing a real
// ledger would have at the front, so an admin can jump straight to a
// section by typing its name instead of hunting the rail.
const INDEX_ENTRIES = NAV.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.group }))
);

export function initShell({ page, title, eyebrow = "Admin Console", actions = "" }) {
  requireAuth();
  const user = getUser();

  document.body.classList.add("admin-page");
  document.body.innerHTML = `
    <div class="admin-shell">
      <div class="sidebar-backdrop" id="sidebarBackdrop"></div>
      <aside class="admin-sidebar" id="adminSidebar">
        <div class="sidebar-brand">
          <div class="seal"><img src="/assets/img/logo-mark.png" alt="" width="24" height="24"></div>
          <div class="brand-text">
            <h2>ShopUno</h2>
            <span>Admin Ledger</span>
          </div>
          <button type="button" class="rail-pin" id="railPin" aria-label="Keep menu open" aria-pressed="false" title="Keep menu open">
            ${icon("pin")}
          </button>
        </div>
        <nav class="sidebar-nav" id="sidebarNav"></nav>
        <div class="sidebar-foot">
          <button type="button" class="theme-toggle" id="themeToggle" aria-pressed="false" title="Toggle dark mode">
            <svg class="theme-icon-light" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
            <svg class="theme-icon-dark" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
            <span class="rail-label" id="themeToggleLabel">Dark mode</span>
          </button>
          <div class="sidebar-user">
            <div class="avatar">${initials(user)}</div>
            <div class="who">
              <strong>${user ? `${user.first_name} ${user.last_name}` : "Admin"}</strong>
              <span>${user?.email || ""}</span>
            </div>
          </div>
          <button type="button" class="logout-btn" id="logoutBtn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span class="rail-label">Log out</span>
          </button>
        </div>
      </aside>

      <div class="admin-main">
        <header class="admin-topbar">
          <div class="topbar-title">
            <button type="button" class="topbar-burger" id="sidebarBurger" aria-label="Open menu" aria-expanded="false">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <div>
              <span class="eyebrow">${eyebrow}</span>
              <h1>${title}</h1>
            </div>
          </div>
          <div class="topbar-actions" id="topbarActions">
            <button type="button" class="index-trigger" id="indexTrigger" title="Jump to a section">
              ${icon("search")}
              <span>Ledger index</span>
              <kbd>${isMac() ? "⌘" : "Ctrl"} K</kbd>
            </button>
            <span class="topbar-stamp mono">${todayLabel()}</span>
            ${actions}
          </div>
        </header>
        <main class="admin-content" id="adminContent"></main>
      </div>
    </div>

    <div class="index-overlay" id="indexOverlay">
      <div class="index-box" role="dialog" aria-modal="true" aria-label="Ledger index — jump to a section">
        <div class="index-input-row">
          ${icon("search")}
          <input type="text" id="indexInput" class="index-input" placeholder="Jump to a section…" autocomplete="off">
          <kbd>Esc</kbd>
        </div>
        <div class="index-results" id="indexResults"></div>
      </div>
    </div>
  `;

  renderNav(page);
  document.getElementById("logoutBtn").addEventListener("click", () => logout());
  setupRailPin();
  setupMobileSidebar();
  setupIndex();
  setupThemeToggle();
  loadBadgeCounts();

  return document.getElementById("adminContent");
}

function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
}

/** The ⌘K "Ledger index" — a searchable flat list of every section, opened
 * from the topbar button or the keyboard shortcut, closed on Escape, click
 * outside, or picking a result. Arrow keys move the active row; Enter goes
 * there. Kept intentionally simple — this indexes pages, not records. */
function setupIndex() {
  const overlay = document.getElementById("indexOverlay");
  const input = document.getElementById("indexInput");
  const results = document.getElementById("indexResults");
  const trigger = document.getElementById("indexTrigger");
  let activeIndex = 0;
  let visible = [];

  function renderResults(query) {
    const q = query.trim().toLowerCase();
    visible = INDEX_ENTRIES.filter(
      (e) => !q || e.label.toLowerCase().includes(q) || e.group.toLowerCase().includes(q)
    );
    activeIndex = 0;

    if (!visible.length) {
      results.innerHTML = `<div class="index-empty">Nothing filed under "${query}".</div>`;
      return;
    }

    let lastGroup = null;
    results.innerHTML = visible
      .map((e, i) => {
        const groupHeader = e.group !== lastGroup ? `<div class="index-group-label">${e.group}</div>` : "";
        lastGroup = e.group;
        return `
          ${groupHeader}
          <button type="button" class="index-item${i === 0 ? " is-active" : ""}" data-index="${i}">
            <span class="index-item-icon">${icon(e.icon)}</span>
            <span class="index-item-label">${e.label}</span>
          </button>`;
      })
      .join("");
  }

  function setActive(i) {
    activeIndex = Math.max(0, Math.min(visible.length - 1, i));
    results.querySelectorAll(".index-item").forEach((el, idx) => {
      el.classList.toggle("is-active", idx === activeIndex);
    });
    results.querySelector(".index-item.is-active")?.scrollIntoView({ block: "nearest" });
  }

  function go(i) {
    const entry = visible[i];
    if (entry) window.location.href = entry.href;
  }

  function open() {
    overlay.classList.add("is-open");
    renderResults("");
    input.value = "";
    setTimeout(() => input.focus(), 10);
  }
  function close() {
    overlay.classList.remove("is-open");
  }

  trigger.addEventListener("click", open);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  input.addEventListener("input", () => renderResults(input.value));
  results.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-index]");
    if (btn) go(Number(btn.dataset.index));
  });

  document.addEventListener("keydown", (e) => {
    const isOpen = overlay.classList.contains("is-open");
    const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
    if (cmdK) {
      e.preventDefault();
      isOpen ? close() : open();
      return;
    }
    if (!isOpen) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive(activeIndex + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(activeIndex - 1); }
    else if (e.key === "Enter") { e.preventDefault(); go(activeIndex); }
  });
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
}

/** The rail can be pinned open instead of only expanding on hover — the
 * preference is remembered locally so a given admin's machine keeps their
 * choice across pages/sessions. */
function setupRailPin() {
  const sidebar = document.getElementById("adminSidebar");
  const pinBtn = document.getElementById("railPin");
  let pinned = false;
  try {
    pinned = localStorage.getItem(PIN_KEY) === "1";
  } catch {
    // Private browsing / storage disabled — default to unpinned, no crash.
  }
  const apply = () => {
    sidebar.classList.toggle("is-pinned", pinned);
    pinBtn.setAttribute("aria-pressed", String(pinned));
  };
  apply();
  pinBtn.addEventListener("click", () => {
    pinned = !pinned;
    apply();
    try {
      localStorage.setItem(PIN_KEY, pinned ? "1" : "0");
    } catch {
      // Nothing to do if storage isn't available.
    }
  });
}

/** Light/dark ("night audit") toggle for the whole console — a data
 * attribute on <html> swaps every CSS variable at once, so no page-specific
 * styling needs to know about it. Preference persists per-browser, same as
 * the rail pin. */
function setupThemeToggle() {
  const btn = document.getElementById("themeToggle");
  const label = document.getElementById("themeToggleLabel");
  const apply = (dark) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    btn.setAttribute("aria-pressed", String(dark));
    label.textContent = dark ? "Light mode" : "Dark mode";
  };
  apply(document.documentElement.dataset.theme === "dark");
  btn.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    apply(dark);
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      // Nothing to do if storage isn't available.
    }
  });
}

/** Wires the mobile hamburger + backdrop so the rail can be opened as a
 * full off-canvas drawer below the 720px breakpoint, where hover-to-expand
 * doesn't apply. */
function setupMobileSidebar() {
  const sidebar = document.getElementById("adminSidebar");
  const burger = document.getElementById("sidebarBurger");
  const backdrop = document.getElementById("sidebarBackdrop");

  const setOpen = (open) => {
    sidebar.classList.toggle("is-open", open);
    backdrop.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", String(open));
  };

  burger.addEventListener("click", () => setOpen(!sidebar.classList.contains("is-open")));
  backdrop.addEventListener("click", () => setOpen(false));
  sidebar.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => setOpen(false)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
}

function renderNav(activeKey) {
  const nav = document.getElementById("sidebarNav");
  nav.innerHTML = NAV.map(
    (group) => `
      <div class="nav-group">
        <div class="nav-group-label rail-label">${group.group}</div>
        ${group.items
          .map(
            (item) => `
          <a class="nav-link${item.key === activeKey ? " is-active" : ""}" href="${item.href}" data-badge-key="${(item.badgeKeys || [item.badgeKey]).filter(Boolean).join(",")}" title="${item.label}">
            <span class="nav-icon">${icon(item.icon)}</span>
            <span class="rail-label nav-link-label">${item.label}</span>
            <span class="nav-badge" data-badge hidden></span>
          </a>`
          )
          .join("")}
      </div>`
  ).join("");
}

async function loadBadgeCounts() {
  try {
    const data = await api.get("/admin/dashboard");
    const attention = data.needs_attention || {};
    document.querySelectorAll("[data-badge-key]").forEach((link) => {
      const keys = link.dataset.badgeKey.split(",").filter(Boolean);
      if (!keys.length) return;
      const count = keys.reduce((sum, key) => sum + (attention[key] || 0), 0);
      const badge = link.querySelector("[data-badge]");
      if (count > 0) {
        badge.textContent = count > 99 ? "99+" : count;
        badge.hidden = false;
      }
    });
  } catch {
    // Badge counts are a nice-to-have; a failed fetch shouldn't block the page.
  }
}
