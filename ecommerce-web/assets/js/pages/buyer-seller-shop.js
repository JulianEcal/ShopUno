// assets/js/pages/buyer-seller-shop.js
// Public shop page (buyer/seller.html?id=<seller id>) — a seller's banner,
// description, aggregate rating, product grid, and reviews. Reached by
// clicking a seller's name on a product card or on a product's own page
// (see buyer-catalog.js / buyer-product.js). Product clicks here hand off
// to that product's own page (buyer/product.html?id=) instead of
// duplicating the gallery/variation/add-to-cart flow here.

import { api } from "../api.js";
import { API_BASE_URL } from "../config.js";
import { initShell } from "../partials/buyer-shell.js";
import { getUser } from "../auth.js";
import { escapeHtml, money, toast, normalizePaginated, formatDate, debounce } from "../lib/ui.js";
import { messageUser } from "../lib/messaging.js";

const APP_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

const STAR_PATH = "M12 2.5l2.9 6.06 6.6.77-4.9 4.55 1.28 6.62L12 17.3l-5.88 3.2 1.28-6.62-4.9-4.55 6.6-.77L12 2.5z";
function starSvg() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="${STAR_PATH}"/></svg>`;
}
function chatIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 21l1.5-5a8.5 8.5 0 1 1 16.5-4.5Z"/></svg>`;
}
function shareIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.6" x2="15.4" y2="6.4"/><line x1="8.6" y1="13.4" x2="15.4" y2="17.6"/></svg>`;
}
function backIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
}
function searchIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
}

/** Which shop a buyer is looking at should be obvious at a glance — in the
 * browser tab, and via a stable accent color once the permit header (photo,
 * name) has scrolled out of view. The accent is picked deterministically
 * from the seller's id so the same shop always gets the same color, drawn
 * from the app's existing palette rather than an arbitrary hue. */
const SHOP_ACCENTS = [
  { photo: "linear-gradient(150deg, var(--gold-deep), var(--chili-deep))", line: "var(--chili-deep)" },
  { photo: "linear-gradient(150deg, var(--teal-deep), var(--gold-deep))", line: "var(--teal-deep)" },
  { photo: "linear-gradient(150deg, var(--chili-deep), var(--teal-deep))", line: "var(--chili-deep)" },
  { photo: "linear-gradient(150deg, var(--gold-deep), var(--teal-deep))", line: "var(--gold-deep)" },
];
function shopAccentFor(seller) {
  const seed = String(seller.id ?? seller.business_name ?? "shop");
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return SHOP_ACCENTS[hash % SHOP_ACCENTS.length];
}

/** Best-effort average color pulled from the seller's own photo, so the
 * sticky chip's color feels tied to that specific shop rather than a
 * generic app palette. Resolves null (never rejects) on any failure —
 * missing image, load error, or a CORS-tainted canvas — so callers can
 * just fall back to the hash-based accent above with no special handling. */
function extractPhotoAccent(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 2500);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 200) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
        resolve(n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null);
      } catch {
        resolve(null); // tainted canvas — silently keep the hash-based fallback
      }
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}
function darken([r, g, b], factor) {
  return [r, g, b].map((c) => Math.min(255, Math.max(0, Math.round(c * factor))));
}
function relLuminance([r, g, b]) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const sellerId = new URLSearchParams(location.search).get("id");

const content = initShell({ page: null });

if (!sellerId) {
  content.innerHTML = errorState("This shop link is missing a seller.");
} else {
  content.innerHTML = skeletonHtml();
  loadShop();
}

const productState = {
  page: 1, lastPage: 1, loading: false, items: [],
  sort: "relevance", inStockOnly: false, search: "",
};
const reviewState = { page: 1, lastPage: 1, loading: false, items: [] };

async function loadShop() {
  try {
    const res = await api.get(`/sellers/${sellerId}`);
    const seller = res?.seller;
    if (!seller) throw new Error("Shop not found.");
    renderShop(seller);
    loadProducts({ replace: true });
    loadReviews({ replace: true });
  } catch (err) {
    content.innerHTML = errorState(err.message || "This shop couldn't be found.");
  }
}

function renderShop(seller) {
  const avg = seller.average_rating;
  const count = seller.ratings_count || 0;
  const rounded = avg ? Math.round(avg) : 0;
  const isTopRated = avg >= 4.5 && count >= 5;
  const initial = escapeHtml((seller.business_name || "?").slice(0, 1).toUpperCase());
  // The shop's own logo_url — separate from the seller's personal
  // avatar_path — is the identity photo here; banner_url is only a
  // fallback for shops that set a banner but never a dedicated logo.
  const photoUrl = seller.logo_url || seller.banner_url;
  // A dual-access (buyer+seller) account viewing its own shop from the
  // buyer side has no one to message — hide the button rather than show
  // one that silently no-ops when clicked (see messageUser's self-message
  // guard in lib/messaging.js).
  const isOwnShop = Boolean(seller.user_id) && Number(getUser()?.id) === Number(seller.user_id);
  const canMessageSeller = Boolean(seller.user_id) && !isOwnShop;

  document.title = `${seller.business_name || "Shop"} · ShopUno`;

  const accent = shopAccentFor(seller);
  content.style.setProperty("--shop-accent-photo", accent.photo);
  content.style.setProperty("--shop-accent-line", accent.line);
  content.style.setProperty("--shop-chip-bg", accent.line);
  if (photoUrl) {
    extractPhotoAccent(photoUrl).then((rgb) => {
      if (!rgb) return; // keep the hash-based fallback already applied
      let deep = darken(rgb, 0.5);
      if (relLuminance(deep) > 0.45) deep = darken(deep, 0.6); // stay dark enough for white text
      content.style.setProperty("--shop-chip-bg", `rgb(${deep[0]}, ${deep[1]}, ${deep[2]})`);
    });
  }

  content.innerHTML = `
    <a href="/buyer/index.html" class="shop-back-link">${backIcon()} Back to browsing</a>

    <div class="shop-permit">
      <div class="shop-permit-id">
        <div class="shop-permit-photo" ${photoUrl ? `style="background-image:url('${escapeHtml(photoUrl)}')"` : ""}>
          ${!photoUrl ? `<span>${initial}</span>` : ""}
        </div>

        <div class="shop-permit-text">
          <span class="eyebrow"><span class="stamp"></span>${seller.line_of_business ? escapeHtml(seller.line_of_business) + " seller" : "ShopUno seller"}</span>
          <h1 class="shop-permit-name">${escapeHtml(seller.business_name || "ShopUno seller")}</h1>
          <div class="shop-permit-rating">
            ${avg && count
              ? `<span class="shop-rating-stars">${[1, 2, 3, 4, 5].map((n) => `<span class="${n <= rounded ? "is-filled" : ""}">${starSvg()}</span>`).join("")}</span><strong>${avg}</strong> · ${count} rating${count === 1 ? "" : "s"}`
              : `<span class="is-empty">New seller — no ratings yet</span>`}
          </div>
          ${seller.shop_description ? `<p class="shop-permit-desc">${escapeHtml(seller.shop_description)}</p>` : ""}
        </div>

        ${isTopRated ? `<span class="shop-permit-seal" title="Highly rated seller">Top<br>Rated</span>` : ""}
      </div>

      <div class="shop-permit-stub">
        <div class="shop-permit-stats">
          <div class="pstat"><strong>${(seller.products_count ?? 0).toLocaleString()}</strong><span>Product${seller.products_count === 1 ? "" : "s"}</span></div>
          <div class="pstat"><strong>${count.toLocaleString()}</strong><span>Rating${count === 1 ? "" : "s"}</span></div>
          ${seller.joined_at ? `<div class="pstat"><strong>${formatDate(seller.joined_at)}</strong><span>Joined</span></div>` : ""}
        </div>
        <div class="shop-permit-actions">
          ${canMessageSeller ? `
            <button type="button" class="btn btn-primary" id="shopMsgBtn">
              ${chatIcon()} Message seller
            </button>` : ""}
          <button type="button" class="btn btn-outline" id="shopShareBtn">${shareIcon()} Copy link</button>
        </div>
      </div>
    </div>

    <nav class="shop-tabs" id="shopTabs">
      <a href="#shopProductsSection" class="shop-tab is-active" data-tab="products">Products</a>
      <a href="#shopReviewsSection" class="shop-tab" data-tab="reviews">Reviews</a>
    </nav>

    <section class="shop-section" id="shopProductsSection">
      <div class="shop-section-head">
        <h2 class="shop-section-title">Products</h2>
        <span class="shop-section-count" id="shopProductsCount"></span>
      </div>
      <div class="shop-toolbar">
        <div class="shop-toolbar-search">
          ${searchIcon()}
          <input type="search" id="shopProductSearch" placeholder="Search this shop's products…" autocomplete="off">
        </div>
        <div class="shop-toolbar-filters">
          <select id="shopSortSelect" aria-label="Sort products">
            <option value="relevance">Sort: Featured</option>
            <option value="price_asc">Price: Low to high</option>
            <option value="price_desc">Price: High to low</option>
            <option value="name_asc">Name: A–Z</option>
          </select>
          <label class="stock-filter"><input type="checkbox" id="shopInStockOnly"><span>In stock only</span></label>
        </div>
      </div>
      <div class="product-grid" id="shopProductGrid">${Array(8).fill(skeletonCard()).join("")}</div>
      <div class="load-more-row" id="shopProductsLoadMoreRow" hidden>
        <button type="button" class="btn-load-more" id="shopProductsLoadMoreBtn">
          <span class="btn-label">Show more</span>
          <span class="spinner is-dark"></span>
        </button>
      </div>
    </section>

    <section class="shop-section" id="shopReviewsSection">
      <div class="shop-section-head">
        <h2 class="shop-section-title">Ratings &amp; reviews</h2>
        ${avg && count ? `<span class="shop-section-count">${avg} average · ${count} rating${count === 1 ? "" : "s"}</span>` : ""}
      </div>
      <div id="shopReviewList" class="shop-review-list"></div>
      <div class="load-more-row" id="shopReviewsLoadMoreRow" hidden>
        <button type="button" class="btn-load-more" id="shopReviewsLoadMoreBtn">
          <span class="btn-label">Show more</span>
          <span class="spinner is-dark"></span>
        </button>
      </div>
    </section>
  `;

  const messageThisSeller = () => {
    messageUser({
      recipientId: seller.user_id,
      recipientName: seller.business_name || "this seller",
      contextLabel: `About their shop, ${seller.business_name || ""}`.trim(),
      redirectTo: "/buyer/messages.html",
    });
  };

  document.getElementById("shopMsgBtn")?.addEventListener("click", messageThisSeller);

  document.getElementById("shopShareBtn").addEventListener("click", async () => {
    const shareData = { title: seller.business_name || "ShopUno seller", url: window.location.href };
    if (navigator.share && navigator.canShare?.(shareData) !== false) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if (err?.name !== "AbortError") toast("Couldn't open the share sheet.", "error");
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Shop link copied to clipboard.", "success");
    } catch {
      toast("Couldn't copy the link — copy it from the address bar instead.", "error");
    }
  });

  document.getElementById("shopProductsLoadMoreBtn").addEventListener("click", () => {
    productState.page += 1;
    loadProducts({ replace: false });
  });
  document.getElementById("shopReviewsLoadMoreBtn").addEventListener("click", () => {
    reviewState.page += 1;
    loadReviews({ replace: false });
  });

  document.getElementById("shopSortSelect").addEventListener("change", (e) => {
    productState.sort = e.target.value;
    renderProductGrid();
  });
  document.getElementById("shopInStockOnly").addEventListener("change", (e) => {
    productState.inStockOnly = e.target.checked;
    renderProductGrid();
  });
  const searchInput = document.getElementById("shopProductSearch");
  searchInput.addEventListener("input", debounce(() => {
    productState.search = searchInput.value.trim();
    productState.page = 1;
    loadProducts({ replace: true });
  }, 400));

  setupProductHoverPreview();
  setupTabScrollSpy();
  setupStickyMobileBar(seller, messageThisSeller);
}

/** A slim bar pinned to the bottom of the screen once the permit header
 * (photo, shop name, "Message seller" button) has scrolled out of view.
 * On mobile it's a full-width bar; on desktop it's a smaller floating
 * pill (see CSS) — either way, it keeps the shop's identity and the
 * message action on screen instead of making the buyer scroll back up,
 * and doubles as a reminder of which shop they're in while browsing a
 * long product grid or review list. */
function setupStickyMobileBar(seller, onMessage) {
  document.getElementById("shopStickyBar")?.remove();
  // Same "no one to message on your own shop" rule as the header button —
  // see canMessageSeller in renderShop.
  if (!seller.user_id || Number(getUser()?.id) === Number(seller.user_id)) return;

  const photoUrl = seller.logo_url || seller.banner_url;
  const initial = escapeHtml((seller.business_name || "?").slice(0, 1).toUpperCase());
  const avg = seller.average_rating;
  const isTopRated = avg >= 4.5 && (seller.ratings_count || 0) >= 5;
  const bar = document.createElement("div");
  bar.className = "shop-sticky-bar";
  bar.id = "shopStickyBar";
  bar.innerHTML = `
    <span class="shop-sticky-avatar" ${photoUrl ? `style="background-image:url('${escapeHtml(photoUrl)}')"` : ""}>${!photoUrl ? initial : ""}</span>
    <span class="shop-sticky-body">
      <span class="shop-sticky-name">${escapeHtml(seller.business_name || "ShopUno seller")}</span>
      ${isTopRated ? `<span class="shop-sticky-badge">Top Rated</span>` : ""}
    </span>
    <button type="button" class="btn btn-primary" id="shopStickyMsgBtn">${chatIcon()} Chat</button>
  `;
  document.body.appendChild(bar);
  bar.querySelector("#shopStickyMsgBtn").addEventListener("click", onMessage);

  const header = document.querySelector(".shop-permit");
  if (header && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      ([entry]) => bar.classList.toggle("is-visible", !entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(header);
  }
}

/** Smooth-scrolls to a section on click, and keeps the tab highlighted as
 * whichever section the person is looking at while scrolling — the same
 * "always know where you are" courtesy as the sidebar category chips on
 * the main browse page. */
function setupTabScrollSpy() {
  const tabs = Array.from(document.querySelectorAll(".shop-tab"));
  const sections = tabs
    .map((tab) => document.querySelector(tab.getAttribute("href")))
    .filter(Boolean);

  tabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelector(tab.getAttribute("href"))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const setActive = (id) => {
    tabs.forEach((tab) => tab.classList.toggle("is-active", tab.getAttribute("href") === `#${id}`));
  };

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) setActive(visible[0].target.id);
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 }
    );
    sections.forEach((s) => observer.observe(s));
  }
}

/* ---------------- products ---------------- */

async function loadProducts({ replace }) {
  if (productState.loading) return;
  productState.loading = true;

  const grid = document.getElementById("shopProductGrid");
  const loadMoreRow = document.getElementById("shopProductsLoadMoreRow");
  const loadMoreBtn = document.getElementById("shopProductsLoadMoreBtn");
  if (!replace) {
    loadMoreBtn.classList.add("is-loading");
    loadMoreBtn.disabled = true;
  }

  try {
    const params = new URLSearchParams({ seller_id: sellerId, page: productState.page });
    if (productState.search) params.set("search", productState.search);
    const res = await api.get(`/products?${params.toString()}`);
    const { items, meta } = normalizePaginated(res);
    productState.lastPage = meta?.last_page || 1;
    productState.items = replace ? items : [...productState.items, ...items];

    const countEl = document.getElementById("shopProductsCount");
    if (countEl && typeof meta?.total === "number") {
      countEl.textContent = `${meta.total.toLocaleString()} item${meta.total === 1 ? "" : "s"}`;
    }

    if (productState.items.length === 0) {
      grid.innerHTML = productState.search
        ? `
        <div class="state-card">
          <span class="state-seal">${searchIcon()}</span>
          <h3>No matches</h3>
          <p>No products in this shop match "${escapeHtml(productState.search)}".</p>
        </div>`
        : `
        <div class="state-card">
          <span class="state-seal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
          <h3>No products yet</h3>
          <p>This shop hasn't listed anything yet — check back soon.</p>
        </div>`;
      loadMoreRow.hidden = true;
      return;
    }

    renderProductGrid();
    loadMoreRow.hidden = productState.page >= productState.lastPage;
  } catch (err) {
    if (replace) grid.innerHTML = errorCard(err.message || "Couldn't load this shop's products.");
    else toast(err.message || "Couldn't load more products.", "error");
  } finally {
    productState.loading = false;
    loadMoreBtn.classList.remove("is-loading");
    loadMoreBtn.disabled = false;
  }
}

/** Re-renders the grid from everything loaded so far, applying the sort
 * and in-stock filter client-side — the API has no sort/availability
 * params, same reasoning as the main catalog page's own renderGrid(). Only
 * "Show more" hits the network; flipping a filter never does. */
function renderProductGrid() {
  const grid = document.getElementById("shopProductGrid");
  if (!grid) return;

  let list = productState.items.slice();
  if (productState.inStockOnly) list = list.filter((p) => p.stock > 0);

  if (productState.sort === "price_asc") list.sort((a, b) => Number(a.base_price) - Number(b.base_price));
  else if (productState.sort === "price_desc") list.sort((a, b) => Number(b.base_price) - Number(a.base_price));
  else if (productState.sort === "name_asc") list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="state-card">
        <span class="state-seal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
        <h3>No matches</h3>
        <p>Nothing in stock right now — try turning off "In stock only".</p>
      </div>`;
    return;
  }

  grid.innerHTML = list.map((p) => productCard(p)).join("");
  grid.querySelectorAll(".product-card").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const id = el.dataset.productId;
      if (id) window.location.href = `/buyer/product.html?id=${id}`;
    });
  });
}

/** Product cards with more than one photo scrub through them as the
 * pointer moves across the thumbnail — the image shown maps to how far
 * across the card the cursor is, with dots marking how many there are.
 * Delegated on the grid container so it survives every re-render (sort,
 * filter, "Show more") without rebinding per card. */
function setupProductHoverPreview() {
  const grid = document.getElementById("shopProductGrid");
  if (!grid || grid.dataset.hoverBound) return;
  grid.dataset.hoverBound = "1";

  grid.addEventListener("mousemove", (e) => {
    const thumb = e.target.closest(".product-thumb");
    if (!thumb || !thumb.dataset.images) return;
    const images = JSON.parse(thumb.dataset.images);
    if (images.length < 2) return;
    const rect = thumb.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let idx = Math.floor((x / rect.width) * images.length);
    idx = Math.max(0, Math.min(images.length - 1, idx));
    if (thumb.dataset.idx === String(idx)) return;
    thumb.dataset.idx = String(idx);
    const img = thumb.querySelector("img");
    if (img) img.src = images[idx];
    thumb.querySelectorAll(".thumb-dot").forEach((d, i) => d.classList.toggle("is-active", i === idx));
  });

  grid.addEventListener("mouseout", (e) => {
    const thumb = e.target.closest(".product-thumb");
    if (!thumb || !thumb.dataset.images) return;
    if (thumb.contains(e.relatedTarget)) return;
    const images = JSON.parse(thumb.dataset.images);
    thumb.dataset.idx = "0";
    const img = thumb.querySelector("img");
    if (img) img.src = images[0];
    thumb.querySelectorAll(".thumb-dot").forEach((d, i) => d.classList.toggle("is-active", i === 0));
  });
}

function productCard(p) {
  const allImages = Array.isArray(p.images) ? p.images.map(resolveImage).filter(Boolean) : [];
  const images = allImages.slice(0, 5); // cap the hover-scrub zones so dots stay easy to target
  const thumb = images.length > 0
    ? `<img src="${escapeHtml(images[0])}" alt="${escapeHtml(p.name)}">`
    : `<span>${escapeHtml((p.name || "?").slice(0, 1).toUpperCase())}</span>`;
  const dots = images.length > 1
    ? `<div class="thumb-dots">${images.map((_, i) => `<span class="thumb-dot${i === 0 ? " is-active" : ""}"></span>`).join("")}</div>`
    : "";
  const stock = p.stock <= 0 ? { cls: "is-low", label: "Out of stock" } : p.stock <= 5 ? { cls: "is-low", label: `Only ${p.stock} left` } : null;

  return `
    <a href="#" class="product-card" data-product-id="${p.id}">
      <div class="product-thumb" data-idx="0" ${images.length > 1 ? `data-images='${escapeHtml(JSON.stringify(images))}'` : ""}>${thumb}${dots}${p.discount?.is_live ? `<span class="product-discount-tag">-${p.discount.percent_off}%</span>` : ""}</div>
      <div class="product-body">
        <div class="product-name">${escapeHtml(p.name)}</div>
        ${p.discount?.is_live
          ? `<div class="product-price-row">
               <span class="product-price" style="margin-top:0;">${money(p.price)}</span>
               <span class="price-tag-orig">${money(p.base_price)}</span>
             </div>`
          : `<div class="product-price">${money(p.base_price)}</div>`}
        ${stock ? `<span class="product-stock ${stock.cls}">${stock.label}</span>` : ""}
      </div>
    </a>
  `;
}

function resolveImage(img) {
  if (!img) return "";
  if (typeof img === "object") return img.url || "";
  if (/^https?:\/\//i.test(img)) return img;
  return `${APP_ORIGIN}/storage/${img.replace(/^\/?storage\//, "")}`;
}

/* ---------------- reviews ---------------- */

async function loadReviews({ replace }) {
  if (reviewState.loading) return;
  reviewState.loading = true;

  const list = document.getElementById("shopReviewList");
  const loadMoreRow = document.getElementById("shopReviewsLoadMoreRow");
  const loadMoreBtn = document.getElementById("shopReviewsLoadMoreBtn");
  if (replace) list.innerHTML = `<div class="shop-review-skel"></div><div class="shop-review-skel"></div>`;
  else {
    loadMoreBtn.classList.add("is-loading");
    loadMoreBtn.disabled = true;
  }

  try {
    const res = await api.get(`/sellers/${sellerId}/ratings?page=${reviewState.page}`);
    const { items, meta } = normalizePaginated(res);
    reviewState.lastPage = meta?.last_page || 1;
    reviewState.items = replace ? items : [...reviewState.items, ...items];

    if (reviewState.items.length === 0) {
      list.innerHTML = `<p class="shop-review-empty">No reviews yet — be the first to buy and rate this seller.</p>`;
      loadMoreRow.hidden = true;
      return;
    }

    list.innerHTML = reviewState.items.map((r) => reviewRow(r)).join("");
    loadMoreRow.hidden = reviewState.page >= reviewState.lastPage;
  } catch (err) {
    if (replace) list.innerHTML = `<p class="shop-review-empty">Couldn't load reviews right now.</p>`;
    else toast(err.message || "Couldn't load more reviews.", "error");
  } finally {
    reviewState.loading = false;
    loadMoreBtn.classList.remove("is-loading");
    loadMoreBtn.disabled = false;
  }
}

function reviewRow(r) {
  const rounded = Math.round(r.score || 0);
  return `
    <div class="shop-review">
      <div class="shop-review-stars">
        ${[1, 2, 3, 4, 5].map((n) => `<span class="${n <= rounded ? "is-filled" : ""}">${starSvg()}</span>`).join("")}
      </div>
      ${r.feedback ? `<p class="shop-review-text">${escapeHtml(r.feedback)}</p>` : ""}
      <div class="shop-review-meta">${escapeHtml(r.from || "ShopUno buyer")} · ${formatDate(r.created_at)}</div>
    </div>
  `;
}

/* ---------------- states ---------------- */

function skeletonHtml() {
  return `
    <div class="shop-back-link is-skel"></div>
    <div class="shop-permit is-skel">
      <div class="shop-permit-id">
        <div class="shop-permit-photo is-skel"></div>
        <div class="shop-permit-text">
          <div class="sk-line w40" style="height:11px;width:120px;"></div>
          <div class="sk-line w60" style="height:22px;width:260px;margin-top:10px;"></div>
          <div class="sk-line w40" style="height:11px;width:180px;margin-top:12px;"></div>
        </div>
      </div>
      <div class="shop-permit-stub"></div>
    </div>
  `;
}

function skeletonCard() {
  return `<div class="product-card-skel"><div class="sk-thumb"></div><div class="sk-line w60"></div><div class="sk-line w40"></div></div>`;
}

function errorCard(message) {
  return `
    <div class="state-card">
      <span class="state-seal"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg></span>
      <h3>Couldn't load this</h3>
      <p>${escapeHtml(message)}</p>
    </div>`;
}

function errorState(message) {
  return errorCard(message);
}
