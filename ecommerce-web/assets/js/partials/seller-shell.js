// assets/js/partials/seller-shell.js
// Renders the seller console's shell — a slim icon-only rail down the left
// (always visible, never a hover-expand drawer like admin's) plus a topbar
// that carries live "shop floor" numbers (today's sales, pending orders,
// low stock) instead of a page eyebrow doing all the work. Each page calls
// initShell({ page, title, eyebrow }) and gets back the empty
// <main class="seller-content"> node to render its own content into.
//
// The rail's icons alone don't explain themselves, so hovering shows a
// small tooltip — the console trades the admin rail's text labels for
// density, and earns that back with the tooltip instead of a hover-expand
// animation.

import { api } from "../api.js";
import { requireAuth, getUser, logout, setActiveView } from "../auth.js";

const THEME_KEY = "shopuno_seller_theme";

// Applied at module load — before initShell rebuilds <body> — so a saved
// dark-mode preference takes effect immediately instead of flashing the
// light paper theme for a frame first.
try {
  if (localStorage.getItem(THEME_KEY) === "dark") document.documentElement.dataset.theme = "dark";
} catch {
  // Private browsing / storage disabled — default to the light theme.
}

const NAV = [
  { key: "dashboard", label: "Dashboard", href: "dashboard.html", icon: "grid" },
  { key: "products", label: "Products", href: "products.html", icon: "box", dotKey: "low_stock_products" },
  { key: "orders", label: "Orders", href: "orders.html", icon: "package", dotKey: "pending_orders" },
  { key: "messages", label: "Messages", href: "messages.html", icon: "chat" },
  { key: "vouchers", label: "Vouchers", href: "vouchers.html", icon: "tag" },
  { key: "ratings", label: "Ratings", href: "ratings.html", icon: "star" },
  { key: "reports", label: "Reports", href: "reports.html", icon: "bar-chart" },
];

const ICONS = {
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
  box: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  package: '<path d="M16.5 9.4 7.5 4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.27 6.96 12 12l8.73-5.04"/><path d="M12 22.08V12"/>',
  tag: '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2.5 12.5V4a1.5 1.5 0 0 1 1.5-1.5h8.5l8.09 8.09a2 2 0 0 1 0 2.82Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  "bar-chart": '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  swap: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  sales: '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  stock: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 21l1.5-5a8.5 8.5 0 1 1 16.5-4.5Z"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}

function initials(user) {
  const a = (user?.first_name || "?")[0] || "?";
  const b = (user?.last_name || "")[0] || "";
  return (a + b).toUpperCase();
}

function avatarHtml(user) {
  return user?.avatar_url ? `<img src="${user.avatar_url}" alt="">` : initials(user);
}

export function initShell({ page, title, eyebrow = "Seller console" }) {
  requireAuth();
  const user = getUser();
  const businessName = user?.seller?.business_name;

  document.body.classList.add("seller-page");
  document.body.dataset.page = page;
  document.body.innerHTML = `
    <div class="seller-shell">
      <div class="rail-backdrop" id="railBackdrop"></div>
      <aside class="seller-rail" id="sellerRail">
        <a href="dashboard.html" class="rail-brand" title="ShopUno seller console">
          <img src="/assets/img/logo-mark.png" alt="">
        </a>
        <nav class="rail-nav" id="railNav"></nav>
        <div class="rail-foot">
          <button type="button" class="rail-theme-toggle" id="railThemeToggle" aria-pressed="false" title="Toggle dark mode">
            <svg class="theme-icon-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
            <svg class="theme-icon-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
            <span class="rail-tip" id="railThemeToggleTip">Dark mode</span>
          </button>
          <div class="rail-account">
            <button type="button" class="rail-avatar" id="railAvatarBtn">${avatarHtml(user)}</button>
            <div class="rail-account-pop" id="railAccountPop">
              <div class="rail-account-who">
                <strong>${user ? `${user.first_name} ${user.last_name}` : "Seller"}</strong>
                <span>${businessName || user?.email || ""}</span>
              </div>
              <button type="button" class="rail-account-item" id="railAccountLink">${icon("user")} Account</button>
              ${user?.dual_access ? `<button type="button" class="rail-account-item" id="railSwitchViewBtn">${icon("swap")} Switch to Buyer view</button>` : ""}
              <button type="button" class="rail-account-item is-danger" id="railLogoutBtn">${icon("logout")} Sign out</button>
            </div>
          </div>
        </div>
      </aside>

      <div class="seller-main">
        <header class="seller-topbar">
          <div class="topbar-left">
            <button type="button" class="topbar-burger" id="railBurger" aria-label="Open menu">${icon("menu")}</button>
            <div>
              <span class="topbar-eyebrow"><span class="stamp"><img src="/assets/img/logo-mark.png" alt=""></span>${businessName || eyebrow}</span>
              <h1>${title}</h1>
            </div>
          </div>
          <div class="pulse-strip" id="pulseStrip"></div>
          <div class="topbar-right">
            <div class="notif-wrap">
              <button type="button" class="topbar-iconbtn" id="notifBtn" title="Notifications" aria-haspopup="true">
                ${icon("bell")}
                <span class="ping" id="notifPing" hidden></span>
              </button>
              <div class="notif-pop" id="notifPop">
                <div class="notif-pop-head">
                  <h4>Notifications</h4>
                  <span>What needs your attention</span>
                </div>
                <div class="notif-list" id="notifList">
                  <div class="notif-empty">Loading…</div>
                </div>
              </div>
            </div>
          </div>
        </header>
        <main class="seller-content" id="sellerContent"></main>
      </div>
    </div>
  `;

  renderNav(page);
  setupMobileRail();
  setupAccountPopover();
  setupNotifPopover();
  setupThemeToggle();
  document.getElementById("railLogoutBtn").addEventListener("click", () => logout());
  document.getElementById("railAccountLink").addEventListener("click", () => { window.location.href = "account.html"; });
  // Same token, no re-login — cart/orders endpoints aren't gated by role,
  // so hopping back to the storefront just needs the view flag flipped.
  document.getElementById("railSwitchViewBtn")?.addEventListener("click", () => {
    setActiveView("buyer");
    window.location.href = "/buyer/index.html";
  });
  loadPulse();
  refreshMessagesBadge();

  return document.getElementById("sellerContent");
}

function renderNav(activeKey) {
  const nav = document.getElementById("railNav");
  nav.innerHTML = NAV.map(
    (item) => `
    <a class="rail-link${item.key === activeKey ? " is-active" : ""}" href="${item.href}" data-dot-key="${item.dotKey || ""}" title="${item.label}">
      ${icon(item.icon)}
      ${item.key === "messages"
        ? `<span class="rail-msg-badge" data-msg-badge hidden>0</span>`
        : `<span class="rail-dot" data-dot></span>`}
      <span class="rail-tip">${item.label}</span>
    </a>`
  ).join("");
}

/** Light/dark toggle for the seller console — a data attribute on <html>
 * swaps every CSS variable at once, same mechanism as the admin console's
 * "night audit" theme. Preference persists per-browser, keyed separately
 * from admin's so a dual-role account can run each console in its own
 * theme. */
function setupThemeToggle() {
  const btn = document.getElementById("railThemeToggle");
  const tip = document.getElementById("railThemeToggleTip");
  const apply = (dark) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    btn.setAttribute("aria-pressed", String(dark));
    tip.textContent = dark ? "Light mode" : "Dark mode";
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

function setupMobileRail() {
  const rail = document.getElementById("sellerRail");
  const burger = document.getElementById("railBurger");
  const backdrop = document.getElementById("railBackdrop");
  const setOpen = (open) => {
    rail.classList.toggle("is-open", open);
    backdrop.classList.toggle("is-open", open);
  };
  burger.addEventListener("click", () => setOpen(!rail.classList.contains("is-open")));
  backdrop.addEventListener("click", () => setOpen(false));
  rail.querySelectorAll(".rail-link").forEach((link) => link.addEventListener("click", () => setOpen(false)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
}

const ATTENTION_NOTIF = {
  pending_orders: { title: (n) => `${n} order${n === 1 ? "" : "s"} awaiting shipment`, sub: "Pack and hand these off soon", href: "orders.html?status=to_ship", icon: "package" },
  low_stock_products: { title: (n) => `${n} product${n === 1 ? "" : "s"} running low`, sub: "5 units or fewer left", href: "products.html?filter=low_stock", icon: "box" },
  flagged_products: { title: (n) => `${n} product${n === 1 ? "" : "s"} flagged`, sub: "Under compliance review", href: "products.html?filter=flagged", icon: "tag" },
  draft_products: { title: (n) => `${n} draft${n === 1 ? "" : "s"} not published yet`, sub: "Finish and publish whenever you're ready", href: "products.html?filter=draft", icon: "box" },
};

function setupNotifPopover() {
  const btn = document.getElementById("notifBtn");
  const pop = document.getElementById("notifPop");
  const close = () => pop.classList.remove("is-open");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.classList.toggle("is-open");
  });
  document.addEventListener("click", (e) => {
    if (!pop.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

/** Builds the notification dropdown's contents from the same attention
 * counts the pulse strip and rail dots already use, plus a couple of the
 * most recent activity items — no separate endpoint needed. */
function renderNotifList(attention, activity) {
  const list = document.getElementById("notifList");
  const ping = document.getElementById("notifPing");
  if (!list) return;

  const attentionEntries = Object.entries(attention || {}).filter(([, count]) => (count || 0) > 0);
  const recentActivity = (activity || []).slice(0, 3);
  const hasAnything = attentionEntries.length > 0 || recentActivity.length > 0;

  ping.hidden = attentionEntries.length === 0;
  if (!ping.hidden) {
    // A count, not just a bare dot — "something needs attention" lands
    // very differently from "3 things need attention." Summed across
    // categories (pending orders + low stock + flagged + drafts) rather
    // than the number of categories, so it reflects actual item count.
    const total = attentionEntries.reduce((sum, [, count]) => sum + (count || 0), 0);
    ping.textContent = total > 9 ? "9+" : String(total);
  }

  if (!hasAnything) {
    list.innerHTML = `<div class="notif-empty">You're all caught up — nothing needs your attention.</div>`;
    return;
  }

  const attentionHtml = attentionEntries.map(([key, count]) => {
    const meta = ATTENTION_NOTIF[key] || { title: () => key.replace(/_/g, " "), sub: "", href: "dashboard.html", icon: "bell" };
    return `
      <a class="notif-item" href="${meta.href}">
        <span class="notif-item-icon">${icon(meta.icon)}</span>
        <span class="notif-item-body">
          <span class="notif-item-title">${meta.title(count)}</span>
          <span class="notif-item-sub">${meta.sub}</span>
        </span>
      </a>`;
  }).join("");

  const activityHtml = recentActivity.map((item) => `
    <a class="notif-item" href="${item.type === "rating" ? "ratings.html" : "orders.html"}">
      <span class="notif-item-icon is-info">${icon(item.type === "rating" ? "star" : "package")}</span>
      <span class="notif-item-body">
        <span class="notif-item-title">${(item.summary || "").replace(/</g, "&lt;")}</span>
        <span class="notif-item-sub">Recent activity</span>
      </span>
    </a>`).join("");

  list.innerHTML = attentionHtml + activityHtml;
}

function setupAccountPopover() {
  const btn = document.getElementById("railAvatarBtn");
  const pop = document.getElementById("railAccountPop");
  const close = () => pop.classList.remove("is-open");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.classList.toggle("is-open");
  });
  document.addEventListener("click", (e) => {
    if (!pop.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

/** Populates the rail's per-item attention dots and the topbar's pulse
 * chips from the seller dashboard summary. Silently no-ops on failure —
 * same "a stale badge beats a broken page" spirit as the other shells. */
async function loadPulse() {
  try {
    const data = await api.get("/seller/dashboard");
    const counts = data.counts || {};
    const attention = data.needs_attention || {};

    document.querySelectorAll("[data-dot-key]").forEach((link) => {
      const key = link.dataset.dotKey;
      if (!key) return;
      const dot = link.querySelector("[data-dot]");
      if ((attention[key] || 0) > 0) dot.classList.add("is-visible");
    });

    renderNotifList(attention, data.recent_activity || []);

    const strip = document.getElementById("pulseStrip");
    strip.innerHTML = `
      <span class="pulse-chip is-good">
        <span class="pulse-icon">${icon("sales")}</span>
        <span class="pulse-val">${counts.orders_today ?? 0}</span>
        <span class="pulse-label">orders today</span>
      </span>
      <span class="pulse-chip${(counts.pending_orders || 0) > 0 ? " is-warm" : ""}">
        <span class="pulse-icon">${icon("clock")}</span>
        <span class="pulse-val">${counts.pending_orders ?? 0}</span>
        <span class="pulse-label">to ship</span>
      </span>
      <span class="pulse-chip${(counts.low_stock_products || 0) > 0 ? " is-warm" : ""}">
        <span class="pulse-icon">${icon("stock")}</span>
        <span class="pulse-val">${counts.low_stock_products ?? 0}</span>
        <span class="pulse-label">low stock</span>
      </span>
    `;
  } catch {
    // Pulse chips are a nice-to-have; a failed fetch shouldn't block the page.
    const list = document.getElementById("notifList");
    if (list) list.innerHTML = `<div class="notif-empty">Couldn't load notifications.</div>`;
  }
}

/** Fetches the seller's conversations and updates the rail's Messages icon
 * with the total unread count across every thread. Exported so the
 * messages page can call it right after opening a thread (which marks it
 * read) without waiting for a full reload — same nice-to-have spirit as
 * the pulse strip above. */
export async function refreshMessagesBadge() {
  const badge = document.querySelector("[data-msg-badge]");
  if (!badge) return;
  try {
    const res = await api.get("/conversations");
    const conversations = res?.data || [];
    const count = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  } catch {
    // Same as the pulse strip: a stale count is fine, don't block the page.
  }
}
