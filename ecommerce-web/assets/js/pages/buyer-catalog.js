// assets/js/pages/buyer-catalog.js
// Buyer landing page (buyer/index.html) — the storefront's main "browse"
// screen. Category chips + the nav search box filter GET /products;
// clicking a card (or its quick-add button) opens that product's own page
// (buyer/product.html?id=) — see that page for the image gallery,
// variation picker, and add-to-cart flow.

import { api } from "../api.js";
import { API_BASE_URL } from "../config.js";
import { initShell } from "../partials/buyer-shell.js";
import { escapeHtml, money, toast, normalizePaginated, debounce } from "../lib/ui.js";
import { getUser } from "../auth.js";

// GET /products returns image `path`s relative to the storage disk (see
// ProductImage/config/filesystems.php), not full URLs — API_BASE_URL is
// "<origin>/api", so stripping "/api" gives the app origin to prefix
// "/storage/..." onto. Already-absolute paths (http/https) pass through.
const APP_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

const ICONS = {
  all: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/>',
  badge: '<circle cx="12" cy="8" r="5"/><path d="M9 12.5 6 21l6-3 6 3-3-8.5"/>',
  truck: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
  return: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  gridLg: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  gridSm: '<rect x="3" y="3" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="3" width="4.5" height="4.5" rx="1"/><rect x="16.5" y="3" width="4.5" height="4.5" rx="1"/><rect x="3" y="9.75" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1"/><rect x="16.5" y="9.75" width="4.5" height="4.5" rx="1"/><rect x="3" y="16.5" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="16.5" width="4.5" height="4.5" rx="1"/><rect x="16.5" y="16.5" width="4.5" height="4.5" rx="1"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 21l1.5-5a8.5 8.5 0 1 1 16.5-4.5Z"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
}

// Same five-point glyph as the order-rating stars (buyer-orders.js) so a
// rating means visually the same thing everywhere in the app.
const STAR_PATH = "M12 2.5l2.9 6.06 6.6.77-4.9 4.55 1.28 6.62L12 17.3l-5.88 3.2 1.28-6.62-4.9-4.55 6.6-.77L12 2.5z";
function starSvg() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="${STAR_PATH}"/></svg>`;
}

/** Compact "★ 4.8 (23)" badge for a product card. Sellers with no ratings
 * yet get a plain "New seller" note instead of a misleading blank space
 * or a "0.0" that reads like a bad score. */
function ratingBadgeHtml(seller) {
  const avg = seller?.average_rating;
  const count = seller?.ratings_count ?? 0;
  if (!avg || !count) return `<span class="rating-badge is-empty">New seller</span>`;
  return `
    <span class="rating-badge" title="${avg} average from ${count} rating${count === 1 ? "" : "s"}">
      ${starSvg()}<strong>${avg}</strong><span class="rating-count">(${count})</span>
    </span>
  `;
}

const state = {
  category: null, // selected category id, or null for "All"
  search: "",
  page: 1,
  lastPage: 1,
  loading: false,
  sort: "relevance",
  inStockOnly: false,
  priceMin: null,
  priceMax: null,
  allProducts: [], // everything loaded so far (across "show more" pages), for client-side sort/re-render
};

// A category link elsewhere in the app (e.g. a product's breadcrumb, see
// buyer-product.js) can deep-link straight into that category instead of
// the default "All" view — read it once up front so the very first
// request already filters, rather than loading everything and
// re-filtering after. loadCategories() below reflects this in the chip
// row once the category list itself has loaded.
const initialCategory = new URLSearchParams(location.search).get("category");
if (initialCategory) state.category = initialCategory;

const content = initShell({
  page: "browse",
  onSearch: (query) => {
    state.search = query.trim();
    state.page = 1;
    loadProducts({ replace: true });
  },
});

content.innerHTML = `
  <section class="hero-browse">
    <div class="hero-browse-top">
      <div class="hero-browse-copy">
        <span class="eyebrow"><span class="stamp"></span>${greeting()}</span>
        <h1>Everything you need, <em>one cart away</em>.</h1>
        <p class="welcome-sub">ShopUno brings verified sellers, everyday goods, and specialty finds together on one marketplace — with one secure checkout.</p>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><strong id="statProducts">—</strong><span>Products</span></div>
        <div class="hero-stat"><strong id="statCategories">—</strong><span>Categories</span></div>
        <div class="hero-stat"><strong>24/7</strong><span>Support</span></div>
      </div>
    </div>
    <div class="trust-strip">
      <div class="trust-item">
        <span class="ti-icon">${icon("shield")}</span>
        <div><strong>Secure checkout</strong><span>Encrypted payments</span></div>
      </div>
      <div class="trust-item">
        <span class="ti-icon">${icon("badge")}</span>
        <div><strong>Verified sellers</strong><span>Reviewed &amp; approved</span></div>
      </div>
      <div class="trust-item">
        <span class="ti-icon">${icon("truck")}</span>
        <div><strong>Nationwide delivery</strong><span>Tracked, door to door</span></div>
      </div>
      <div class="trust-item">
        <span class="ti-icon">${icon("return")}</span>
        <div><strong>Buyer protection</strong><span>Easy returns policy</span></div>
      </div>
    </div>
  </section>

  <div class="catalog-layout">
    <aside class="browse-sidebar" aria-label="Browse categories and filters">
      <div class="sidebar-block">
        <h3 class="sidebar-heading">Categories</h3>
        <div class="cat-rail" id="catScroller">
          <div class="cat-chip-skel"></div>
          <div class="cat-chip-skel"></div>
          <div class="cat-chip-skel"></div>
          <div class="cat-chip-skel"></div>
        </div>
      </div>

      <div class="sidebar-block sidebar-filters">
        <h3 class="sidebar-heading">Sort by</h3>
        <div class="filter-radio-group" id="sortRadioGroup">
          <label class="filter-radio"><input type="radio" name="sortOpt" value="relevance" checked><span>Relevance</span></label>
          <label class="filter-radio"><input type="radio" name="sortOpt" value="price_asc"><span>Price: Low to high</span></label>
          <label class="filter-radio"><input type="radio" name="sortOpt" value="price_desc"><span>Price: High to low</span></label>
          <label class="filter-radio"><input type="radio" name="sortOpt" value="name_asc"><span>Name: A–Z</span></label>
        </div>
      </div>

      <div class="sidebar-block sidebar-filters">
        <h3 class="sidebar-heading">Availability</h3>
        <label class="stock-filter">
          <input type="checkbox" id="inStockOnly">
          <span>In stock only</span>
        </label>
      </div>

      <div class="sidebar-block sidebar-filters">
        <h3 class="sidebar-heading">Price range</h3>
        <div class="price-range-row">
          <label class="price-input"><span>₱</span><input type="number" id="priceMin" min="0" placeholder="Min" inputmode="numeric"></label>
          <span class="price-sep">–</span>
          <label class="price-input"><span>₱</span><input type="number" id="priceMax" min="0" placeholder="Max" inputmode="numeric"></label>
        </div>
      </div>

      <button type="button" class="clear-filters-btn" id="clearFiltersBtn" hidden>Clear all filters</button>
    </aside>

    <div class="catalog-main">
      <div class="section-head">
        <div>
          <h2 id="gridTitle">All products</h2>
        </div>
      </div>

      <div class="catalog-toolbar">
        <span class="catalog-toolbar-count" id="gridCount"></span>
        <div class="catalog-toolbar-actions">
          <div class="view-toggle" id="viewToggle" role="group" aria-label="Grid density">
            <button type="button" data-view="comfortable" class="is-active" title="Comfortable view" aria-label="Comfortable view">${icon("gridLg")}</button>
            <button type="button" data-view="compact" title="Compact view" aria-label="Compact view">${icon("gridSm")}</button>
          </div>
        </div>
      </div>

      <div class="product-grid" id="productGrid">
        ${Array(8).fill(skeletonCard()).join("")}
      </div>

      <div class="load-more-row" id="loadMoreRow" hidden>
        <button type="button" class="btn-load-more" id="loadMoreBtn">
          <span class="btn-label">Show more</span>
          <span class="spinner is-dark"></span>
        </button>
      </div>
    </div>
  </div>
`;

document.getElementById("loadMoreBtn").addEventListener("click", () => {
  state.page += 1;
  loadProducts({ replace: false });
});

document.getElementById("sortRadioGroup").addEventListener("change", (e) => {
  if (e.target.name !== "sortOpt") return;
  state.sort = e.target.value;
  renderGrid();
  updateClearFiltersVisibility();
});

document.getElementById("inStockOnly").addEventListener("change", (e) => {
  state.inStockOnly = e.target.checked;
  renderGrid();
  updateClearFiltersVisibility();
});

const priceMinInput = document.getElementById("priceMin");
const priceMaxInput = document.getElementById("priceMax");
const applyPriceFilter = debounce(() => {
  const min = priceMinInput.value.trim();
  const max = priceMaxInput.value.trim();
  state.priceMin = min === "" ? null : Math.max(0, Number(min));
  state.priceMax = max === "" ? null : Math.max(0, Number(max));
  renderGrid();
  updateClearFiltersVisibility();
}, 400);
priceMinInput.addEventListener("input", applyPriceFilter);
priceMaxInput.addEventListener("input", applyPriceFilter);

document.getElementById("clearFiltersBtn").addEventListener("click", () => {
  state.sort = "relevance";
  state.inStockOnly = false;
  state.priceMin = null;
  state.priceMax = null;
  document.getElementById("sortRadioGroup").querySelector('input[value="relevance"]').checked = true;
  document.getElementById("inStockOnly").checked = false;
  priceMinInput.value = "";
  priceMaxInput.value = "";
  const allChip = document.querySelector('.cat-chip[data-cat=""]');
  if (allChip && !allChip.classList.contains("is-active")) {
    allChip.click(); // resets category + reloads products
  } else {
    renderGrid();
  }
  updateClearFiltersVisibility();
});

function updateClearFiltersVisibility() {
  const active =
    state.sort !== "relevance" ||
    state.inStockOnly ||
    state.priceMin != null ||
    state.priceMax != null ||
    !!state.category;
  document.getElementById("clearFiltersBtn").hidden = !active;
}

document.getElementById("viewToggle").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (!btn) return;
  document.querySelectorAll("#viewToggle button").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  document.getElementById("productGrid").classList.toggle("is-compact", btn.dataset.view === "compact");
});

function greeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const user = getUser();
  return user?.first_name ? `${part}, ${user.first_name}` : part;
}

function skeletonCard() {
  return `
    <div class="product-card-skel">
      <div class="sk-thumb"></div>
      <div class="sk-line w60"></div>
      <div class="sk-line w40"></div>
    </div>
  `;
}

/* ---------------- categories ---------------- */

const CATEGORY_TONES = ["gold", "teal", "chili"]; // cycles through brand accent colors

async function loadCategories() {
  const scroller = document.getElementById("catScroller");
  try {
    const res = await api.get("/categories");
    const categories = res?.data || [];
    document.getElementById("statCategories").textContent = categories.length;

    const chips = [
      `<button type="button" class="cat-chip is-active" data-cat="">
        <span class="cat-dot">${icon("all")}</span>All
      </button>`,
      ...categories.map((cat, i) => `
        <button type="button" class="cat-chip cat-chip--${CATEGORY_TONES[i % CATEGORY_TONES.length]}" data-cat="${cat.id}" data-name="${escapeHtml(cat.name)}">
          <span class="cat-dot">${escapeHtml((cat.name || "?").trim().slice(0, 1).toUpperCase())}</span>${escapeHtml(cat.name)}
        </button>
      `),
    ];
    scroller.innerHTML = chips.join("");

    // Reflect a category carried in via ?category=<id> (see
    // initialCategory above) — swap the active chip and title over from
    // the "All" default the markup above always starts with.
    if (state.category) {
      const preselected = scroller.querySelector(`.cat-chip[data-cat="${state.category}"]`);
      if (preselected) {
        scroller.querySelectorAll(".cat-chip").forEach((c) => c.classList.remove("is-active"));
        preselected.classList.add("is-active");
        document.getElementById("gridTitle").textContent = preselected.dataset.name;
      } else {
        state.category = null; // an id that no longer exists — fall back to "All" rather than filtering on nothing
      }
      updateClearFiltersVisibility();
    }

    scroller.querySelectorAll(".cat-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        scroller.querySelectorAll(".cat-chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        state.category = chip.dataset.cat || null;
        state.page = 1;
        document.getElementById("gridTitle").textContent = state.category
          ? chip.dataset.name
          : "All products";
        loadProducts({ replace: true });
        updateClearFiltersVisibility();
      });
    });
  } catch {
    scroller.innerHTML = `<p class="state-msg">Couldn't load categories right now.</p>`;
  }
}

/* ---------------- products ---------------- */

async function loadProducts({ replace }) {
  if (state.loading) return;
  state.loading = true;

  const grid = document.getElementById("productGrid");
  const loadMoreRow = document.getElementById("loadMoreRow");
  const loadMoreBtn = document.getElementById("loadMoreBtn");

  if (replace) {
    grid.innerHTML = Array(8).fill(skeletonCard()).join("");
  } else {
    loadMoreBtn.classList.add("is-loading");
    loadMoreBtn.disabled = true;
  }

  try {
    const params = new URLSearchParams();
    if (state.category) params.set("category", state.category);
    if (state.search) params.set("search", state.search);
    params.set("page", state.page);

const res = await api.get(`/products?${params.toString()}`);
const { items: products, meta } = normalizePaginated(res);
state.lastPage = meta?.last_page || 1;

document.getElementById("statProducts").textContent =
  typeof meta?.total === "number" ? meta.total.toLocaleString() : products.length.toLocaleString();
document.getElementById("gridCount").textContent =
  typeof meta?.total === "number"
    ? `${meta.total.toLocaleString()} item${meta.total === 1 ? "" : "s"}`
    : `${products.length.toLocaleString()} item${products.length === 1 ? "" : "s"}`;

    if (products.length === 0 && state.page === 1) {
      state.allProducts = [];
      grid.innerHTML = emptyState();
      loadMoreRow.hidden = true;
      return;
    }

    // Only the very first product of an unfiltered "All products" load
    // gets the featured flag — not on load-more appends, and not while a
    // search/category filter narrows the results (a filtered result set
    // shouldn't have an arbitrary "featured" pick). The flag travels with
    // the product object so it survives client-side re-sorting.
    const withFlags = products.map((p, i) => ({
      ...p,
      _featured: replace && i === 0 && !state.search && !state.category,
    }));
    state.allProducts = replace ? withFlags : [...state.allProducts, ...withFlags];

    renderGrid();
    loadMoreRow.hidden = state.page >= state.lastPage;
  } catch (err) {
    if (replace) {
      grid.innerHTML = errorState(err.message);
      document.getElementById("retryLoadBtn")?.addEventListener("click", () => loadProducts({ replace: true }));
      loadMoreRow.hidden = true;
    } else {
      toast(err.message || "Couldn't load more products.", "error");
      state.page -= 1;
    }
  } finally {
    state.loading = false;
    loadMoreBtn.classList.remove("is-loading");
    loadMoreBtn.disabled = false;
  }
}

/** Rebuilds the grid from state.allProducts, applying the current sort.
 * Sorting is client-side across whatever has been loaded so far (initial
 * page + any "show more" pages) — there's no server-side sort param, and
 * re-fetching on every sort change would just refetch the same page 1. */
function renderGrid() {
  const grid = document.getElementById("productGrid");
  let list = [...state.allProducts];
  if (state.inStockOnly) list = list.filter((p) => (p.stock ?? 0) > 0);
  if (state.priceMin != null) list = list.filter((p) => Number(p.base_price) >= state.priceMin);
  if (state.priceMax != null) list = list.filter((p) => Number(p.base_price) <= state.priceMax);

  if (state.sort === "price_asc") list.sort((a, b) => Number(a.base_price) - Number(b.base_price));
  else if (state.sort === "price_desc") list.sort((a, b) => Number(b.base_price) - Number(a.base_price));
  else if (state.sort === "name_asc") list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // The bento "featured" treatment only makes sense in the default,
  // server-given order — once the buyer sorts or filters it should read
  // as a plain, predictable grid.
  const useFeatured =
    state.sort === "relevance" && !state.inStockOnly && state.priceMin == null && state.priceMax == null;

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="state-card">
        <span class="state-seal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <h3>Nothing matches that filter</h3>
        <p>Try turning off "In stock only", clearing the price range, or picking a different sort.</p>
      </div>`;
    return;
  }

  grid.innerHTML = list.map((p, i) => productCard(p, useFeatured && p._featured, i)).join("");
  grid.querySelectorAll(".product-card, .product-quickadd").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      // The seller name inside the card links to their shop page instead
      // of opening this product's quick view — can't nest a real <a> in
      // the card's own <a> (invalid HTML), so it's caught and routed here.
      const sellerLink = e.target.closest(".product-seller-link");
      if (sellerLink) {
        window.location.href = `/buyer/seller.html?id=${sellerLink.dataset.sellerId}`;
        return;
      }
      const id = el.closest("[data-product-id]")?.dataset.productId;
      if (id) window.location.href = `/buyer/product.html?id=${id}`;
    });
  });
}

function stockBadge(stock) {
  if (stock <= 0) return { cls: "out_of_stock", label: "Out of stock" };
  if (stock <= 5) return { cls: "low_stock", label: `Only ${stock} left` };
  return null;
}

function productCard(p, isFeatured = false, index = 0) {
  const image = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null;
  const thumb = image
    ? `<img src="${escapeHtml(resolveImage(image))}" alt="${escapeHtml(p.name)}">`
    : `<span>${escapeHtml((p.name || "?").slice(0, 1).toUpperCase())}</span>`;
  const stock = stockBadge(p.stock ?? 0);
  // Staggered entrance — capped so a long "show more" append doesn't
  // leave late cards waiting on a multi-second delay chain.
  const delay = Math.min(index, 11) * 30;

  return `
    <a href="#" class="product-card${isFeatured ? " is-featured" : ""}" data-product-id="${p.id}" style="animation-delay:${delay}ms">
      <div class="product-thumb">
        ${thumb}
        ${isFeatured ? `<span class="product-featured-tag">Featured</span>` : ""}
        ${p.discount?.is_live ? `<span class="product-discount-tag">-${p.discount.percent_off}%</span>` : ""}
        <span class="product-quickadd" title="Quick view &amp; add to cart">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </span>
      </div>
      <div class="product-body">
        <div class="product-seller-row">
          ${p.seller?.id
            ? `<span class="product-seller product-seller-link" data-seller-id="${p.seller.id}" role="link" tabindex="0">${escapeHtml(p.seller?.business_name || "ShopUno seller")}</span>`
            : `<span class="product-seller">${escapeHtml(p.seller?.business_name || "ShopUno seller")}</span>`}
          ${ratingBadgeHtml(p.seller)}
        </div>
        <div class="product-name">${escapeHtml(p.name)}</div>
        ${p.discount?.is_live
          ? `<div class="product-price-row">
               <span class="product-price" style="margin-top:0;">${money(p.price)}</span>
               <span class="price-tag-orig">${money(p.base_price)}</span>
             </div>`
          : `<div class="product-price">${money(p.base_price)}</div>`}
        ${stock ? `<span class="product-stock${stock.cls === "out_of_stock" ? " is-low" : ""}">${stock.label}</span>` : ""}
      </div>
    </a>
  `;
}

function resolveImage(img) {
  if (!img) return "";
  // Product images from the API come back as objects ({ id, url, sort_order })
  // with a ready-to-use absolute url. Older/legacy call sites may still pass
  // a plain string path, so both are supported here.
  if (typeof img === "object") return img.url || "";
  if (/^https?:\/\//i.test(img)) return img;
  return `${APP_ORIGIN}/storage/${img.replace(/^\/?storage\//, "")}`;
}

function emptyState() {
  return `
    <div class="state-card">
      <span class="state-seal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </span>
      <h3>No products found</h3>
      <p>Try a different search, or browse another category — new stalls are joining ShopUno all the time.</p>
    </div>
  `;
}

function errorState(message) {
  return `
    <div class="state-card">
      <span class="state-seal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>
      </span>
      <h3>Couldn't load products</h3>
      <p>${escapeHtml(message || "Something went wrong. Please try again in a moment.")}</p>
      <button type="button" class="btn btn-outline" id="retryLoadBtn">Try again</button>
    </div>
  `;
}

// Old bookmarks/links may still use the former quick-view deep link
// (?p=<product id>) — send those straight to the product's own page now
// instead of dead-ending on a browse page with nothing pre-opened.
const legacyDeepLinkId = new URLSearchParams(location.search).get("p");
if (legacyDeepLinkId) {
  window.location.replace(`/buyer/product.html?id=${encodeURIComponent(legacyDeepLinkId)}`);
} else {
  loadCategories();
  loadProducts({ replace: true });
}