// assets/js/pages/landing.js
// Public landing page (index.html). Everything here hits endpoints that are
// public in routes/api.php — no token needed:
//   GET /categories, GET /products, GET /announcements
// If the person is already logged in we just swap the nav's Sign In button
// for a quick link into their dashboard; we don't gate anything on this page.

import { api } from "../api.js";
import { API_BASE_URL } from "../config.js";
import { isLoggedIn, getUser } from "../auth.js";
import { escapeHtml, normalizePaginated } from "../lib/ui.js";

const APP_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

function resolveImage(img) {
  if (!img) return "";
  // Product images from the API come back as objects ({ id, url, sort_order })
  // with a ready-to-use absolute url. Older/legacy call sites may still pass
  // a plain string path, so both are supported here.
  if (typeof img === "object") return img.url || "";
  if (/^https?:\/\//i.test(img)) return img;
  return `${APP_ORIGIN}/storage/${img.replace(/^\/?storage\//, "")}`;
}

const DASHBOARD_BY_ROLE = {
  admin: "/admin/dashboard.html",
  seller: "/seller/dashboard.html",
  courier: "/courier/dashboard.html",
  buyer: "/buyer/index.html",
};

function initNavAuthState() {
  const authSlot = document.getElementById("navAuthSlot");
  const mobileActions = document.querySelector(".fn-mobile-actions");
  if (!isLoggedIn()) return; // default markup already shows Sign In

  const user = getUser();
  const href = DASHBOARD_BY_ROLE[user?.role] || "/buyer/index.html";
  const dashboardLink = `<a href="${href}" class="fn-btn is-primary">Go to dashboard</a>`;
  if (authSlot) authSlot.innerHTML = dashboardLink;
  if (mobileActions) mobileActions.innerHTML = dashboardLink;
}

function initMobileNav() {
  const burger = document.getElementById("fnBurger");
  const menu = document.getElementById("fnMobileMenu");
  const nav = document.getElementById("floatnav");
  if (!burger || !menu) return;

  const close = () => {
    menu.hidden = true;
    burger.setAttribute("aria-expanded", "false");
    nav?.classList.remove("is-menu-open");
  };
  const open = () => {
    menu.hidden = false;
    burger.setAttribute("aria-expanded", "true");
    nav?.classList.add("is-menu-open");
  };

  burger.addEventListener("click", () => {
    if (menu.hidden) open();
    else close();
  });
  menu.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) close();
  });
}

function initScrollNav() {
  const nav = document.getElementById("floatnav");
  if (!nav) return;
  const update = () => nav.classList.toggle("is-scrolled", window.scrollY > 24);
  update();
  window.addEventListener("scroll", update, { passive: true });
}

function initReveal() {
  const els = document.querySelectorAll("[data-reveal]");
  els.forEach((el) => {
    const delay = el.getAttribute("data-reveal-delay");
    if (delay) el.style.setProperty("--reveal-delay", `${delay}ms`);
  });
  if (!("IntersectionObserver" in window) || els.length === 0) {
    els.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  els.forEach((el) => io.observe(el));
}

// Gentle parallax drift on the hero ticket stack — a few px of movement,
// not a full scroll-jacking effect. Skipped entirely for reduced-motion.
function initHeroParallax() {
  const collage = document.querySelector(".collage");
  const cards = document.querySelectorAll(".ticket-card");
  if (!collage || cards.length === 0) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let ticking = false;
  const update = () => {
    ticking = false;
    const rect = collage.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    const progress = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
    cards.forEach((card, i) => {
      const depth = (i + 1) * 6;
      card.style.setProperty("--parallax", `${(progress - 0.5) * depth}px`);
    });
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true }
  );
  update();
}

async function loadCategories() {
  const nav = document.getElementById("catScroller");
  if (!nav) return;
  try {
    const res = await api.get("/categories");
    const categories = res?.data || [];
    if (categories.length === 0) {
      nav.innerHTML = `<p class="state-msg">No categories yet — check back soon.</p>`;
      return;
    }
    nav.innerHTML = categories
      .map((cat, i) => {
        const index = String(i + 1).padStart(2, "0");
        return `
          <a class="cat-tag" href="/login.html" title="Sign in to browse ${escapeHtml(cat.name)}">
            <span class="cat-index">${index}</span>
            <span class="cat-name">${escapeHtml(cat.name)}</span>
          </a>
        `;
      })
      .join("");

    const statCategories = document.getElementById("statCategories");
    if (statCategories) statCategories.textContent = categories.length;
  } catch (err) {
    nav.innerHTML = `<p class="state-msg">Couldn't load categories right now.</p>`;
  }
}

function formatPrice(value) {
  const num = Number(value) || 0;
  return `₱${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadProducts() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;
  try {
    const res = await api.get("/products");
    const { items: products, meta } = normalizePaginated(res);
    const total = meta?.total;

    const statProducts = document.getElementById("statProducts");
    if (statProducts) statProducts.textContent = typeof total === "number" ? total.toLocaleString() : products.length;

    if (products.length === 0) {
      grid.innerHTML = `<p class="state-msg">No products listed yet — sellers are still setting up shop.</p>`;
      return;
    }
    grid.innerHTML = products
      .slice(0, 8)
      .map((p) => {
        const image = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null;
        const initial = escapeHtml(p.name?.slice(0, 1) || "?");
        // Demo/seeded products can point at a third-party image URL that's
        // occasionally unreachable (rate-limited, momentarily down, etc).
        // Rather than show the browser's broken-image icon + alt text, swap
        // straight to the same letter placeholder used for imageless
        // products the moment the <img> fails to load.
        const thumb = image
          ? `<img src="${escapeHtml(resolveImage(image))}" alt="${escapeHtml(p.name)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'${initial}'}))">`
          : `<span>${initial}</span>`;
        return `
          <a class="product-card" href="/login.html">
            <div class="product-thumb">
              ${thumb}
              <button type="button" class="product-wish" data-wish aria-label="Save to wishlist — sign in to keep it">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20.5s-7.5-4.6-10-9.3C.6 8 2 4.5 5.4 4c2-.3 3.8.6 4.9 2.3l1.7 2.5 1.7-2.5C14.8 4.6 16.6 3.7 18.6 4c3.4.5 4.8 4 3.4 7.2-2.5 4.7-10 9.3-10 9.3Z"/></svg>
              </button>
            </div>
            <div class="product-body">
              <div class="product-seller">${escapeHtml(p.seller?.business_name || "ShopUno seller")}</div>
              <div class="product-name">${escapeHtml(p.name)}</div>
              <div class="product-price">${formatPrice(p.base_price)}</div>
            </div>
          </a>
        `;
      })
      .join("");
  } catch (err) {
    grid.innerHTML = `<p class="state-msg">Couldn't load products right now. Please try again shortly.</p>`;
  }
}

function formatAnnouncementDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function truncate(text, max = 140) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

async function loadAnnouncements() {
  const section = document.getElementById("announceSection");
  const list = document.getElementById("announceList");
  if (!section || !list) return;
  try {
    const res = await api.get("/announcements");
    const announcements = res?.data || [];
    if (announcements.length === 0) {
      section.hidden = true;
      return;
    }
    list.innerHTML = announcements
      .slice(0, 3)
      .map(
        (a) => `
          <div class="announce-card">
            <div class="announce-date">${escapeHtml(formatAnnouncementDate(a.created_at))}</div>
            <div class="announce-title">${escapeHtml(a.title)}</div>
            <div class="announce-body">${escapeHtml(truncate(a.body))}</div>
          </div>
        `
      )
      .join("");
  } catch (err) {
    section.hidden = true;
  }
}

// Wishlist hearts are a local, honest delight — nothing persists (no
// account yet), so a click just gives a satisfying toggle instead of
// pretending to save anything server-side. The click never falls through
// to the card's own link.
function initWishlistTaps() {
  const grid = document.getElementById("productGrid");
  if (!grid) return;
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-wish]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    btn.classList.toggle("is-active");
  });
}

function initFooterSignup() {
  const form = document.getElementById("footerSignup");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = form.querySelector("#footerEmail");
    const row = form.querySelector(".footer-signup-row");
    if (!input || !row || !input.value) return;
    row.innerHTML = `<span style="font-size:13px;color:var(--paper-dim);opacity:.85;">Thanks — we'll email ${escapeHtml(input.value)} when new stalls open nearby.</span>`;
  });
}

initNavAuthState();
initMobileNav();
initScrollNav();
initReveal();
initHeroParallax();
initWishlistTaps();
initFooterSignup();
loadCategories();
loadProducts();
loadAnnouncements();