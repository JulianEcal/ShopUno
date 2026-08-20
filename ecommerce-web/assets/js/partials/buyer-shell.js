// assets/js/partials/buyer-shell.js
// Renders the floating storefront nav shared by every buyer page (logo,
// search box, section links, cart badge, account dropdown), wires up
// logout, and hands back the <main id="buyerContent"> node for the page
// to render into. Mirrors admin-shell.js's initShell({page,title}) shape,
// but the nav itself is the landing page's floating pill bar, not the
// admin rail — buyers browse a storefront, not a ledger.

import { api } from "../api.js";
import { requireAuth, getUser, logout } from "../auth.js";
import { debounce } from "../lib/ui.js";

// Every buyer page that exists (or is coming soon) so the nav links stay
// consistent as more pages get built. `soon: true` renders a muted badge
// instead of navigating — flip it off as each page ships.
const NAV_LINKS = [
  { key: "browse", label: "Browse", href: "/buyer/index.html" },
  { key: "orders", label: "Orders", href: "/buyer/orders.html", soon: true },
  { key: "messages", label: "Messages", href: "/buyer/messages.html", soon: true },
];

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  chevron: '<polyline points="6 9 12 15 18 9"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
};

function icon(name, extra = "") {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICONS[name] || ""}</svg>`;
}

function initials(user) {
  const a = (user?.first_name || "?")[0] || "?";
  const b = (user?.last_name || "")[0] || "";
  return (a + b).toUpperCase();
}

function navLinksHtml(activeKey) {
  return NAV_LINKS.map((l) => {
    if (l.soon) {
      return `<span class="bn-link" aria-disabled="true">${l.label}<span class="bn-soon">Soon</span></span>`;
    }
    return `<a class="bn-link${l.key === activeKey ? " is-active" : ""}" href="${l.href}">${l.label}</a>`;
  }).join("");
}

/**
 * Renders the shell and returns the empty content node to fill in.
 * `page` is the NAV_LINKS key to highlight; `onSearch(query)` (optional)
 * is called (debounced by the caller if it wants) whenever the buyer
 * types in the nav search box — pages that don't search can omit it.
 */
export function initShell({ page, onSearch } = {}) {
  requireAuth();
  const user = getUser();

  document.body.classList.add("buyer-page");
  document.body.innerHTML = `
    <nav class="buyer-nav" id="buyerNav">
      <a href="/buyer/index.html" class="bn-logo">
        <span class="bn-seal" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4.5 8.5h15l-1.4 10.3a2 2 0 0 1-2 1.7H7.9a2 2 0 0 1-2-1.7L4.5 8.5Z"/>
            <path d="M8.5 8.5V6.8a3.5 3.5 0 0 1 7 0v1.7"/>
            <path d="M9 12v3M15 12v3"/>
          </svg>
        </span>
        ShopUno
      </a>

      <div class="bn-search">
        ${icon("search")}
        <input type="search" id="buyerSearchInput" placeholder="Search for anything…" autocomplete="off">
      </div>

      <div class="bn-links">${navLinksHtml(page)}</div>

      <div class="bn-actions">
        <a href="/buyer/cart.html" class="bn-cart" id="bnCartBtn" aria-label="View cart" title="Cart">
          ${icon("bag")}
          <span class="bn-cart-badge" id="bnCartBadge" hidden>0</span>
        </a>

        <div class="bn-account">
          <button type="button" class="bn-avatar-btn" id="bnAvatarBtn" aria-haspopup="true" aria-expanded="false">
            <span class="bn-avatar">${initials(user)}</span>
            ${icon("chevron")}
          </button>
          <div class="bn-dropdown" id="bnDropdown">
            <div class="bn-dropdown-who">
              <strong>${user ? `${user.first_name} ${user.last_name}` : "Buyer"}</strong>
              <span>${user?.email || ""}</span>
            </div>
            <a class="bn-dropdown-item" href="/buyer/orders.html">${icon("bag", 'width="14" height="14"')} My orders</a>
            <a class="bn-dropdown-item" href="#" id="bnAccountLink">${icon("user", 'width="14" height="14"')} Account settings</a>
            <button type="button" class="bn-dropdown-item is-danger" id="bnLogoutBtn">${icon("logout", 'width="14" height="14"')} Sign out</button>
          </div>
        </div>

        <button type="button" class="bn-burger" id="bnBurger" aria-label="Open menu">${icon("menu")}</button>
      </div>
    </nav>

    <div class="bn-drawer" id="bnDrawer">
      <div class="bn-drawer-backdrop" id="bnDrawerBackdrop"></div>
      <div class="bn-drawer-panel">
        <div class="bn-search">
          ${icon("search")}
          <input type="search" id="buyerSearchInputMobile" placeholder="Search for anything…" autocomplete="off">
        </div>
        <div class="bn-links">${navLinksHtml(page)}</div>
      </div>
    </div>

    <main class="buyer-main" id="buyerContent"><div class="wrap"></div></main>
  `;

  document.getElementById("bnLogoutBtn").addEventListener("click", () => logout());
  setupAccountDropdown();
  setupMobileDrawer();
  refreshCartBadge();

  if (onSearch) {
    const debouncedSearch = debounce((v) => onSearch(v), 350);
    ["buyerSearchInput", "buyerSearchInputMobile"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", (e) => debouncedSearch(e.target.value));
    });
  }

  return document.querySelector("#buyerContent .wrap");
}

function setupAccountDropdown() {
  const btn = document.getElementById("bnAvatarBtn");
  const dropdown = document.getElementById("bnDropdown");
  const close = () => {
    dropdown.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = dropdown.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

function setupMobileDrawer() {
  const drawer = document.getElementById("bnDrawer");
  const burger = document.getElementById("bnBurger");
  const backdrop = document.getElementById("bnDrawerBackdrop");
  const open = () => drawer.classList.add("is-open");
  const close = () => drawer.classList.remove("is-open");
  burger.addEventListener("click", open);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

/** Fetches the buyer's cart and updates the nav badge with total item
 * quantity. Exported so pages can call it again right after an add/remove
 * without a full page reload. Silently no-ops on failure — a stale badge
 * is a much smaller problem than a broken page. */
export async function refreshCartBadge() {
  const badge = document.getElementById("bnCartBadge");
  if (!badge) return;
  try {
    const res = await api.get("/cart");
    const items = res?.cart?.items || [];
    const count = items.reduce((sum, i) => sum + (i.quantity || 0), 0);
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  } catch {
    // Cart badge is a nice-to-have; a failed fetch shouldn't block the page.
  }
}
