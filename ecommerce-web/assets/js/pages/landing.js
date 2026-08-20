// assets/js/pages/landing.js
// Public landing page (index.html). Everything here hits endpoints that are
// public in routes/api.php — no token needed:
//   GET /categories, GET /products, GET /announcements
// If the person is already logged in we just swap the nav's Sign In button
// for a quick link into their dashboard; we don't gate anything on this page.

import { api } from "../api.js";
import { isLoggedIn, getUser } from "../auth.js";
import { escapeHtml } from "../lib/ui.js";

const DASHBOARD_BY_ROLE = {
  admin: "/admin/dashboard.html",
  seller: "/seller/dashboard.html",
  courier: "/courier/dashboard.html",
  buyer: "/buyer/index.html",
};

function initNavAuthState() {
  const authSlot = document.getElementById("navAuthSlot");
  if (!authSlot) return;
  if (!isLoggedIn()) return; // default markup already shows Sign In

  const user = getUser();
  const href = DASHBOARD_BY_ROLE[user?.role] || "/buyer/index.html";
  authSlot.innerHTML = `<a href="${href}" class="fn-btn is-primary">Go to dashboard</a>`;
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

const CATEGORY_ICONS = ["🛍️", "🥬", "📱", "🏠", "💄", "🧸", "🚲", "🍜", "👗", "🔧"];

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
        const icon = CATEGORY_ICONS[i % CATEGORY_ICONS.length];
        return `
          <a class="cat-chip" href="/login.html" title="Sign in to browse ${escapeHtml(cat.name)}">
            <span class="cat-dot">${icon}</span>
            ${escapeHtml(cat.name)}
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
    // GET /products wraps a paginator inside { data: ... }, so the actual
    // product list is res.data.data, and the pagination meta (with the
    // real total count) is res.data.meta (see ProductController@index).
    const products = res?.data?.data || [];
    const total = res?.data?.meta?.total;

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
        const thumb = image
          ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(p.name)}" style="width:100%;height:100%;object-fit:cover;">`
          : `<span>${escapeHtml(p.name?.slice(0, 1) || "?")}</span>`;
        return `
          <a class="product-card" href="/login.html">
            <div class="product-thumb">${thumb}</div>
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

initNavAuthState();
initScrollNav();
initReveal();
loadCategories();
loadProducts();
loadAnnouncements();
