// assets/js/partials/buyer-shell.js
// Renders the floating storefront nav shared by every buyer page (logo,
// search box, section links, cart badge, account dropdown), wires up
// logout, and hands back the <main id="buyerContent"> node for the page
// to render into. Mirrors admin-shell.js's initShell({page,title}) shape,
// but the nav itself is the landing page's floating pill bar, not the
// admin rail — buyers browse a storefront, not a ledger.

import { api } from "../api.js";
import { requireAuth, getUser, logout, setActiveView } from "../auth.js";
import { debounce } from "../lib/ui.js";

// Every buyer page that exists (or is coming soon) so the nav links stay
// consistent as more pages get built. `soon: true` renders a muted badge
// instead of navigating — flip it off as each page ships.
const NAV_LINKS = [
  { key: "browse", label: "Browse", href: "/buyer/index.html" },
  { key: "orders", label: "Orders", href: "/buyer/orders.html" },
  { key: "messages", label: "Messages", href: "/buyer/messages.html" },
];

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  chevron: '<polyline points="6 9 12 15 18 9"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  swap: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
};

function icon(name, extra = "") {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICONS[name] || ""}</svg>`;
}

function initials(user) {
  const a = (user?.first_name || "?")[0] || "?";
  const b = (user?.last_name || "")[0] || "";
  return (a + b).toUpperCase();
}

function avatarHtml(user) {
  return user?.avatar_url
    ? `<img src="${user.avatar_url}" alt="">`
    : initials(user);
}

function navLinksHtml(activeKey) {
  return NAV_LINKS.map((l) => {
    if (l.soon) {
      return `<span class="bn-link" aria-disabled="true">${l.label}<span class="bn-soon">Soon</span></span>`;
    }
    const badge = l.key === "messages" ? `<span class="bn-msg-badge" hidden>0</span>` : "";
    return `<a class="bn-link${l.key === activeKey ? " is-active" : ""}" href="${l.href}">${l.label}${badge}</a>`;
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
          <img src="/assets/img/logo-mark.png" alt="" width="21" height="21">
        </span>
        ShopUno
      </a>

      <div class="bn-search">
        ${icon("search")}
        <input type="search" id="buyerSearchInput" placeholder="Search for anything…" autocomplete="off">
      </div>

      <div class="bn-links">${navLinksHtml(page)}</div>

      <div class="bn-divider" aria-hidden="true"></div>

      <div class="bn-actions">
        <a href="/buyer/cart.html" class="bn-cart" id="bnCartBtn" aria-label="View cart" title="Cart">
          ${icon("bag")}
          <span class="bn-cart-badge" id="bnCartBadge" hidden>0</span>
        </a>

        <div class="bn-account">
          <button type="button" class="bn-avatar-btn" id="bnAvatarBtn" aria-haspopup="true" aria-expanded="false">
            <span class="bn-avatar" id="bnAvatar">${avatarHtml(user)}</span>
            ${icon("chevron")}
          </button>
          <div class="bn-dropdown" id="bnDropdown">
            <div class="bn-dropdown-who" id="bnDropdownWho">
              <strong id="bnDropdownName">${user ? `${user.first_name} ${user.last_name}` : "Buyer"}</strong>
              <span id="bnDropdownEmail">${user?.email || ""}</span>
            </div>
            <a class="bn-dropdown-item" href="/buyer/orders.html">${icon("bag", 'width="14" height="14"')} My orders</a>
            <a class="bn-dropdown-item" href="/buyer/account.html" id="bnAccountLink">${icon("user", 'width="14" height="14"')} Account settings</a>
            ${user?.dual_access ? `<button type="button" class="bn-dropdown-item" id="bnSwitchViewBtn">${icon("swap", 'width="14" height="14"')} Switch to Seller view</button>` : ""}
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

    <footer class="buyer-footer">
      <div class="wrap bf-row">
        <a href="/buyer/index.html" class="bf-mark">
          <span class="bn-seal" aria-hidden="true">
            <img src="/assets/img/logo-mark.png" alt="" width="18" height="18">
          </span>
          ShopUno
        </a>
        <nav class="bf-links">
          <a href="#">Help center</a>
          <a href="#">Returns &amp; refunds</a>
          <a href="/buyer/account.html#seller">Sell on ShopUno</a>
          <a href="#">Terms &amp; privacy</a>
        </nav>
        <div class="bf-meta">
          <span class="bf-pay-mark">Cash on delivery</span>
          <span class="bf-copy">© ${new Date().getFullYear()} ShopUno</span>
        </div>
      </div>
    </footer>
  `;

  document.getElementById("bnLogoutBtn").addEventListener("click", () => logout());
  // Same token works for both views (seller endpoints only check the
  // account's stored `role`, which doesn't change here) — no re-login,
  // just remember the choice and hop over to the seller console.
  document.getElementById("bnSwitchViewBtn")?.addEventListener("click", () => {
    setActiveView("seller");
    window.location.href = "/seller/dashboard.html";
  });
  setupAccountDropdown();
  setupMobileDrawer();
  refreshCartBadge();
  refreshMessagesBadge();

  if (onSearch) {
    const debouncedSearch = debounce((v) => onSearch(v), 350);
    ["buyerSearchInput", "buyerSearchInputMobile"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", (e) => debouncedSearch(e.target.value));
    });
  }

  return document.querySelector("#buyerContent .wrap");
}

/** Re-renders the nav's avatar, name, and email from whatever's currently
 * in storage. Exported so pages that change these (account settings' name/
 * email/avatar edits) can call it right after saving instead of needing a
 * full page reload — same pattern as refreshCartBadge. Silently no-ops if
 * the shell isn't mounted (e.g. called too early) or the user is missing
 * a piece of data, same "don't block the page over a nice-to-have" spirit. */
export function refreshAccountSummary() {
  const avatarEl = document.getElementById("bnAvatar");
  const nameEl = document.getElementById("bnDropdownName");
  const emailEl = document.getElementById("bnDropdownEmail");
  if (!avatarEl || !nameEl || !emailEl) return;

  const user = getUser();
  avatarEl.innerHTML = avatarHtml(user);
  nameEl.textContent = user ? `${user.first_name} ${user.last_name}` : "Buyer";
  emailEl.textContent = user?.email || "";
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

/** Fetches the buyer's conversations and updates the nav's "Messages" pill
 * with the total unread count across every thread. Exported so the messages
 * page can call it right after opening a thread (which marks it read)
 * without waiting for a full reload — same nice-to-have spirit as the cart
 * badge above. */
export async function refreshMessagesBadge() {
  const badges = document.querySelectorAll(".bn-msg-badge");
  if (!badges.length) return;
  try {
    const res = await api.get("/conversations");
    const conversations = res?.data || [];
    const count = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    badges.forEach((badge) => {
      if (count > 0) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    });
  } catch {
    // Same as the cart badge: a stale count is fine, don't block the page.
  }
}