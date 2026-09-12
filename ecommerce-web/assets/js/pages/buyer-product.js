// assets/js/pages/buyer-product.js
// Product detail page (buyer/product.html?id=<product id>) — its own full
// page rather than a quick-view modal, so a product can be linked to,
// bookmarked, and shared directly (same idea as buyer-seller-shop.js's
// own page for a shop). Reached from a product card on the browse page,
// a "View item" link on a message thread, or the shop page's own grid.

import { api } from "../api.js";
import { API_BASE_URL } from "../config.js";
import { initShell, refreshCartBadge } from "../partials/buyer-shell.js";
import { getUser } from "../auth.js";
import { escapeHtml, money, toast, normalizePaginated, formatDate, openImageLightbox } from "../lib/ui.js";
import { messageUser } from "../lib/messaging.js";

// GET /products/{id} returns image `path`s relative to the storage disk,
// not full URLs — API_BASE_URL is "<origin>/api", so stripping "/api"
// gives the app origin to prefix "/storage/..." onto. Already-absolute
// paths (http/https) pass through untouched.
const APP_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

const STAR_PATH = "M12 2.5l2.9 6.06 6.6.77-4.9 4.55 1.28 6.62L12 17.3l-5.88 3.2 1.28-6.62-4.9-4.55 6.6-.77L12 2.5z";
function starSvg() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="${STAR_PATH}"/></svg>`;
}
function chatIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 21l1.5-5a8.5 8.5 0 1 1 16.5-4.5Z"/></svg>`;
}
function backIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
}
function shieldIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/></svg>`;
}
function truckIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/></svg>`;
}
function cashIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>`;
}

function zoomIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;
}

/** Full five-star row + rating count, where there's room to show the
 * shape of the rating, not just the number — same treatment the old
 * quick-view modal used, and the shop page's own permit header. */
function ratingRowHtml(seller) {
  const avg = seller?.average_rating;
  const count = seller?.ratings_count ?? 0;
  if (!avg || !count) return `<div class="qv-rating is-empty">New seller — no ratings yet</div>`;
  const rounded = Math.round(avg);
  return `
    <div class="qv-rating">
      <span class="qv-rating-stars">
        ${[1, 2, 3, 4, 5].map((n) => `<span class="qv-rating-star${n <= rounded ? " is-filled" : ""}">${starSvg()}</span>`).join("")}
      </span>
      <span class="qv-rating-text"><strong>${avg}</strong> · ${count} rating${count === 1 ? "" : "s"}</span>
    </div>
  `;
}

/**
 * Renders a price, optionally with a struck-through original price and a
 * "-X%" chip when originalPrice is given and is actually higher.
 * originalPrice should be `null`/omitted whenever there's no live
 * discount, so callers don't need a separate "is this discounted" check.
 */
function priceRowHtml(price, originalPrice) {
  if (originalPrice == null || originalPrice <= price) return money(price);
  const pct = Math.round((1 - price / originalPrice) * 100);
  return `${money(price)} <span class="price-tag-orig">${money(originalPrice)}</span> <span class="price-tag-pct">-${pct}%</span>`;
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

const productId = new URLSearchParams(location.search).get("id");

const content = initShell({ page: "browse" });

if (!productId) {
  content.innerHTML = errorState("This product link is missing an id.");
} else {
  content.innerHTML = skeletonHtml();
  loadProduct();
}

async function loadProduct() {
  try {
    const res = await api.get(`/products/${productId}`);
    const product = res?.product;
    if (!product) throw new Error("Product not found.");
    renderProduct(product);
  } catch (err) {
    content.innerHTML = errorState(err.message || "This product couldn't be found.");
  }
}

function renderProduct(product) {
  document.title = `${product.name} · ShopUno`;

  const images = Array.isArray(product.images) ? product.images : [];
  const options = Array.isArray(product.options) ? product.options : [];
  const variations = Array.isArray(product.variations) ? product.variations : [];

  // options[0]'s picked value maps to a variation's option_value_1_id,
  // options[1]'s (if there is one) to option_value_2_id — same order the
  // seller's Options tab generates combinations in. A product with only
  // one option group (or none) just has an empty/short `options` array;
  // everything below already degrades to that case naturally.
  const selection = {}; // option id -> selected option-value id
  options.forEach((opt) => { selection[opt.id] = (opt.values || [])[0]?.id ?? null; });

  function variationFor(sel) {
    if (options.length === 0) return null;
    const v1 = sel[options[0].id];
    const v2 = options[1] ? sel[options[1].id] : null;
    return variations.find((v) => v.option_value_1_id === v1 && (options[1] ? v.option_value_2_id === v2 : v.option_value_2_id == null)) || null;
  }

  // The naive "first value of every group" combo might be out of stock
  // (e.g. Small in the first color happens to be sold out) — walk the
  // combinations once up front to land on a buyable one by default,
  // same courtesy Shopee's own picker gives you.
  if (options.length && (variationFor(selection)?.stock ?? 0) <= 0) {
    const group2Values = options[1] ? options[1].values || [] : [null];
    outer:
    for (const v1 of options[0].values || []) {
      for (const v2 of group2Values) {
        const trial = { ...selection, [options[0].id]: v1.id };
        if (options[1] && v2) trial[options[1].id] = v2.id;
        const match = variationFor(trial);
        if (match && match.stock > 0) {
          Object.assign(selection, trial);
          break outer;
        }
      }
    }
  }

  let qty = 1;
  const seller = product.seller || {};
  // A dual-access (buyer+seller) account browsing its own listing from the
  // buyer side has no one to message — hide the button rather than show
  // one that silently no-ops when clicked (see messageUser's self-message
  // guard in lib/messaging.js).
  const isOwnListing = Boolean(seller.user_id) && Number(getUser()?.id) === Number(seller.user_id);
  const canMessageSeller = Boolean(seller.user_id) && !isOwnListing;
  const sellerInitial = escapeHtml((seller.business_name || "?").slice(0, 1).toUpperCase());
  // Rating/count already come through on the product endpoint's nested
  // seller object (see ratingRowHtml below), so the Top Rated seal can
  // render immediately — no need to wait on enrichShopCard's extra
  // /sellers/{id} fetch just for this. Same threshold as the shop page.
  const isTopRatedSeller = (seller.average_rating ?? 0) >= 4.5 && (seller.ratings_count ?? 0) >= 5;
  // The nested `seller` object on GET /products/{id} only carries the
  // fields the price/rating UI needs (id, business_name, user_id,
  // average_rating, ratings_count) — no logo_url/banner_url. Those only
  // come back from GET /sellers/{id} (see buyer-seller-shop.js), so the
  // shop card below renders with initials first and swaps in the real
  // photo once enrichShopCard's fetch resolves.
  const initialPhotoUrl = seller.logo_url || seller.banner_url || null;

  content.innerHTML = `
    <a href="#" id="pdpBackLink" class="shop-back-link">${backIcon()} Back to browsing</a>

    <nav class="pdp-crumb" aria-label="Breadcrumb">
      <a href="/buyer/index.html">Browse</a>
      ${product.category?.name ? `<span class="pdp-crumb-sep">/</span>${product.category?.id ? `<a href="/buyer/index.html?category=${product.category.id}">${escapeHtml(product.category.name)}</a>` : `<span>${escapeHtml(product.category.name)}</span>`}` : ""}
      <span class="pdp-crumb-sep">/</span>
      <span class="pdp-crumb-current">${escapeHtml(product.name)}</span>
    </nav>

    <div class="pdp-layout">
      <div class="pdp-gallery">
        <div class="qv-gallery-main pdp-main" id="pdpMain">
          ${images.length ? `<img src="${escapeHtml(resolveImage(images[0]))}" alt="${escapeHtml(product.name)}">` : `<span>${escapeHtml((product.name || "?").slice(0, 1).toUpperCase())}</span>`}
          ${images.length ? `<span class="pdp-zoom-hint">${zoomIcon()} Click to zoom</span>` : ""}
        </div>
        ${images.length > 1 ? `
          <div class="qv-thumbs pdp-thumbs" id="pdpThumbs">
            ${images.map((img, i) => `<button type="button" class="qv-thumb${i === 0 ? " is-active" : ""}" data-src="${escapeHtml(resolveImage(img))}"><img src="${escapeHtml(resolveImage(img))}" alt=""></button>`).join("")}
          </div>` : ""}
      </div>

      <div class="pdp-info">
        <div class="qv-seller-row">
          ${seller.id
            ? `<a class="qv-seller" href="/buyer/seller.html?id=${seller.id}">${escapeHtml(seller.business_name || "ShopUno seller")}</a>`
            : `<div class="qv-seller">${escapeHtml(seller.business_name || "ShopUno seller")}</div>`}
          ${canMessageSeller ? `
            <button type="button" class="qv-msg-seller-btn" id="pdpMsgSellerBtn">
              ${chatIcon()} Message
            </button>` : ""}
        </div>
        <h1 class="qv-name pdp-name">${escapeHtml(product.name)}</h1>
        ${ratingRowHtml(seller)}
        <div class="qv-price pdp-price" id="pdpPrice">${priceRowHtml(product.price ?? product.base_price, product.discount?.is_live ? product.base_price : null)}</div>

        <div id="pdpVariations"></div>

        <div class="qv-qty-row">
          <div class="qv-stepper">
            <button type="button" id="pdpQtyMinus" aria-label="Decrease quantity">−</button>
            <span id="pdpQtyValue">1</span>
            <button type="button" id="pdpQtyPlus" aria-label="Increase quantity">+</button>
          </div>
          <span class="qv-stock-note" id="pdpStockNote"></span>
        </div>

        <div class="field-error" id="pdpError" hidden></div>

        <div class="pdp-actions">
          <button type="button" class="btn btn-outline" id="pdpAddBtn">
            <span class="btn-label">Add to cart</span>
            <span class="spinner is-dark"></span>
          </button>
          <button type="button" class="btn btn-primary" id="pdpBuyBtn">
            <span class="btn-label">Buy now</span>
            <span class="spinner"></span>
          </button>
        </div>

        <div class="pdp-trust-row">
          <span>${shieldIcon()} Buyer protection</span>
          <span>${truckIcon()} Nationwide delivery</span>
          <span>${cashIcon()} Cash on delivery</span>
        </div>
      </div>
    </div>

    <section class="shop-section pdp-desc-section">
      <div class="pdp-desc-card">
        <h2 class="shop-section-title">Description</h2>
        <p class="pdp-desc">${escapeHtml(product.description || "No description provided by the seller yet.")}</p>
      </div>
    </section>

    <section class="shop-section pdp-shop-section">
      <div class="pdp-shop-card" id="pdpShopCard">
        ${seller.id
          ? `<a class="pdp-shop-avatar" id="pdpShopAvatar" href="/buyer/seller.html?id=${seller.id}" ${initialPhotoUrl ? `style="background-image:url('${escapeHtml(initialPhotoUrl)}')"` : ""}>${!initialPhotoUrl ? sellerInitial : ""}</a>`
          : `<span class="pdp-shop-avatar" id="pdpShopAvatar" ${initialPhotoUrl ? `style="background-image:url('${escapeHtml(initialPhotoUrl)}')"` : ""}>${!initialPhotoUrl ? sellerInitial : ""}</span>`}
        <div class="pdp-shop-body">
          ${seller.id
            ? `<a class="pdp-shop-name" href="/buyer/seller.html?id=${seller.id}">${escapeHtml(seller.business_name || "ShopUno seller")}</a>`
            : `<div class="pdp-shop-name">${escapeHtml(seller.business_name || "ShopUno seller")}</div>`}
          ${ratingRowHtml(seller)}
          <div class="pdp-shop-stats" id="pdpShopStats" hidden></div>
        </div>
        <div class="pdp-shop-actions">
          ${canMessageSeller ? `<button type="button" class="btn btn-outline" id="pdpShopMsgBtn">${chatIcon()} Message</button>` : ""}
          ${seller.id ? `<a class="btn btn-outline" href="/buyer/seller.html?id=${seller.id}">Visit shop</a>` : ""}
        </div>
        ${isTopRatedSeller ? `<span class="pdp-shop-seal" title="Highly rated seller">Top<br>Rated</span>` : ""}
      </div>
    </section>

    <section class="shop-section" id="pdpMoreSection" hidden>
      <div class="shop-section-head">
        <h2 class="shop-section-title">More from this shop</h2>
      </div>
      <div class="product-grid" id="pdpMoreGrid">${Array(4).fill(skeletonCard()).join("")}</div>
    </section>
  `;

  // The back link mimics a real "back" when the buyer arrived from
  // elsewhere in the app, and otherwise falls back to Browse — a bare
  // href to index.html would lose their scroll position/filters for the
  // common case of clicking a card and then bouncing straight back.
  document.getElementById("pdpBackLink").addEventListener("click", (e) => {
    e.preventDefault();
    if (document.referrer && new URL(document.referrer).origin === location.origin && window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "/buyer/index.html";
    }
  });

  const messageThisSeller = () => {
    // Read the buyer's current pick at click-time (not whatever it was when
    // the page first rendered) — currentVariation() closes over the same
    // live `selection` the pills below write into, so switching Style/Size
    // and then hitting Message reflects that latest choice.
    const v = currentVariation();
    const variationLabel = options.length && v ? v.label : "";
    messageUser({
      recipientId: seller.user_id,
      recipientName: seller.business_name || "this seller",
      productId: product.id,
      productVariationId: options.length && v ? v.id : null,
      productName: product.name,
      productImage: images.length ? resolveImage(images[0]) : "",
      variationLabel,
      contextLabel: `About "${product.name}"${variationLabel ? ` — ${variationLabel}` : ""}`,
      redirectTo: "/buyer/messages.html",
    });
  };
  document.getElementById("pdpMsgSellerBtn")?.addEventListener("click", messageThisSeller);
  document.getElementById("pdpShopMsgBtn")?.addEventListener("click", messageThisSeller);

  // image thumbs
  content.querySelectorAll(".qv-thumb").forEach((t) => {
    t.addEventListener("click", () => {
      content.querySelectorAll(".qv-thumb").forEach((x) => x.classList.remove("is-active"));
      t.classList.add("is-active");
      document.getElementById("pdpMain").innerHTML = `<img src="${t.dataset.src}" alt="${escapeHtml(product.name)}">` + (images.length ? `<span class="pdp-zoom-hint">${zoomIcon()} Click to zoom</span>` : "");
    });
  });

  // Click (or the "Click to zoom" hint) opens the currently-shown image
  // full-screen — whatever's live in the <img> at click time, so this
  // stays correct through thumbnail switches and variation-driven image
  // changes without needing its own separate state to track.
  document.getElementById("pdpMain")?.addEventListener("click", () => {
    const img = document.querySelector("#pdpMain img");
    if (img) openImageLightbox(img.src, product.name);
  });

  function currentVariation() {
    return variationFor(selection);
  }

  // Whether picking `valueId` for `opt` would still land on an in-stock
  // combination, given what's currently picked in the *other* group —
  // this is what greys out e.g. a size that's sold out in the
  // currently-selected color, exactly like Shopee's own picker.
  function valueIsAvailable(opt, valueId) {
    const trial = { ...selection, [opt.id]: valueId };
    const match = variationFor(trial);
    return !match || match.stock > 0; // no matching row at all shouldn't block picking it
  }

  // Renders both option-group pill rows from scratch — simplest way to
  // keep every pill's selected/disabled state correct after any change,
  // since picking a value in one group can affect availability in the
  // other (see valueIsAvailable above).
  function renderOptionPills() {
    const container = document.getElementById("pdpVariations");
    if (!options.length) { container.innerHTML = ""; return; }

    container.innerHTML = options.map((opt) => `
      <div class="qv-variation-group" data-option-id="${opt.id}">
        <div class="qv-variation-label">${escapeHtml(opt.name)}</div>
        <div class="qv-variation-options">
          ${(opt.values || []).map((v) => {
            const isSelected = selection[opt.id] === v.id;
            const isAvailable = valueIsAvailable(opt, v.id);
            return `
              <button type="button" class="qv-variation-pill${isSelected ? " is-selected" : ""}"
                data-option-id="${opt.id}" data-value-id="${v.id}"
                ${isAvailable ? "" : "disabled"}>
                ${v.image ? `<img src="${escapeHtml(resolveImage(v.image))}" alt="" class="qv-pill-thumb">` : ""}
                ${escapeHtml(v.value)}
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `).join("");

    container.querySelectorAll(".qv-variation-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        selection[pill.dataset.optionId] = Number(pill.dataset.valueId);
        qty = 1;
        renderOptionPills();
        updateGalleryForVariation();
        updateAvailability();
      });
    });
  }

  // If the selected combination (or its first option's value, for a
  // single-option product) has its own photo, show that as the main
  // image — otherwise leave the gallery showing the product's cover.
  function updateGalleryForVariation() {
    const v = currentVariation();
    if (!v || !v.image) return;
    const src = resolveImage(v.image);
    document.getElementById("pdpMain").innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(product.name)}">` + `<span class="pdp-zoom-hint">${zoomIcon()} Click to zoom</span>`;
    content.querySelectorAll(".qv-thumb").forEach((t) => t.classList.toggle("is-active", t.dataset.src === src));
  }

  function updateAvailability() {
    const v = currentVariation();
    // A product with option groups but no fully-matching combination yet
    // (shouldn't normally happen — every combo is auto-generated — but a
    // deleted/edge-case row shouldn't crash the picker) reads as 0 stock
    // rather than silently falling back to the product's own stock,
    // which would be the wrong number for a specific pick.
    const stock = options.length ? (v ? v.stock : 0) : product.stock;
    // Read the already-discounted price/original_price straight off the
    // variation (see ProductResource) rather than recomputing base_price
    // + price_adjustment here — that number wouldn't reflect a live
    // product discount, which applies to the combination's real price,
    // not just the plain base_price.
    const price = v ? v.price : (product.price ?? Number(product.base_price));
    const originalPrice = v
      ? (v.original_price > v.price ? v.original_price : null)
      : (product.discount?.is_live ? Number(product.base_price) : null);
    document.getElementById("pdpPrice").innerHTML = priceRowHtml(price, originalPrice);

    const note = document.getElementById("pdpStockNote");
    const addBtn = document.getElementById("pdpAddBtn");
    const buyBtn = document.getElementById("pdpBuyBtn");
    if (stock <= 0) {
      note.textContent = "Out of stock";
      note.classList.add("is-low");
      addBtn.disabled = true;
      buyBtn.disabled = true;
    } else {
      note.classList.toggle("is-low", stock <= 5);
      note.textContent = stock <= 5 ? `Only ${stock} left` : `${stock} in stock`;
      addBtn.disabled = false;
      buyBtn.disabled = false;
      qty = Math.min(qty, stock);
    }
    document.getElementById("pdpQtyValue").textContent = qty;
    document.getElementById("pdpQtyMinus").disabled = qty <= 1;
    document.getElementById("pdpQtyPlus").disabled = qty >= stock;
  }

  document.getElementById("pdpQtyMinus").addEventListener("click", () => { qty = Math.max(1, qty - 1); updateAvailability(); });
  document.getElementById("pdpQtyPlus").addEventListener("click", () => {
    const v = currentVariation();
    const stock = options.length ? (v ? v.stock : 0) : product.stock;
    qty = Math.min(stock, qty + 1);
    updateAvailability();
  });

  async function addToCart({ redirectToCart }) {
    const addBtn = document.getElementById("pdpAddBtn");
    const buyBtn = document.getElementById("pdpBuyBtn");
    const errorBox = document.getElementById("pdpError");
    errorBox.hidden = true;
    const btn = redirectToCart ? buyBtn : addBtn;
    btn.classList.add("is-loading");
    addBtn.disabled = true;
    buyBtn.disabled = true;
    try {
      const v = currentVariation();
      await api.post("/cart/items", {
        product_id: product.id,
        product_variation_id: v ? v.id : null,
        quantity: qty,
      });
      refreshCartBadge();
      if (redirectToCart) {
        window.location.href = "/buyer/cart.html";
        return;
      }
      toast(`Added ${qty} × ${product.name} to cart.`, "success");
    } catch (err) {
      errorBox.textContent = err.message || "Couldn't add that to your cart.";
      errorBox.hidden = false;
    } finally {
      btn.classList.remove("is-loading");
      updateAvailability(); // restores correct disabled state for both buttons
    }
  }

  document.getElementById("pdpAddBtn").addEventListener("click", () => addToCart({ redirectToCart: false }));
  document.getElementById("pdpBuyBtn").addEventListener("click", () => addToCart({ redirectToCart: true }));

  renderOptionPills();
  updateGalleryForVariation();
  updateAvailability();

  if (seller.id) {
    loadMoreFromShop(seller.id, product.id);
    enrichShopCard(seller.id, initialPhotoUrl);
  }
}

/** The product endpoint's nested seller object is deliberately light —
 * the shop card renders from it immediately so the page isn't blocked
 * on a second request, then this fills in the seller's actual logo
 * (falling back to their banner) plus join date / product count once
 * GET /sellers/{id} resolves, same source of truth as the shop page. */
async function enrichShopCard(sellerId, alreadyHavePhoto) {
  try {
    const res = await api.get(`/sellers/${sellerId}`);
    const full = res?.seller;
    if (!full) return;

    if (!alreadyHavePhoto) {
      const photoUrl = full.logo_url || full.banner_url;
      if (photoUrl) {
        const avatar = document.getElementById("pdpShopAvatar");
        if (avatar) {
          avatar.style.backgroundImage = `url('${photoUrl.replace(/'/g, "%27")}')`;
          avatar.textContent = "";
        }
      }
    }

    const stats = [];
    if (typeof full.products_count === "number") stats.push(`${full.products_count.toLocaleString()} product${full.products_count === 1 ? "" : "s"}`);
    if (full.joined_at) stats.push(`Joined ${formatDate(full.joined_at)}`);
    const statsEl = document.getElementById("pdpShopStats");
    if (statsEl && stats.length) {
      statsEl.textContent = stats.join(" · ");
      statsEl.hidden = false;
    }
  } catch {
    // Enrichment is a nice-to-have — the initials/basic card already
    // rendered, so a failed fetch here just leaves it as-is.
  }
}

/* ---------------- more from this shop ---------------- */

async function loadMoreFromShop(sellerId, excludeProductId) {
  const section = document.getElementById("pdpMoreSection");
  const grid = document.getElementById("pdpMoreGrid");
  try {
    const res = await api.get(`/products?seller_id=${sellerId}&page=1`);
    const { items } = normalizePaginated(res);
    const others = items.filter((p) => String(p.id) !== String(excludeProductId)).slice(0, 6);
    if (!others.length) return; // nothing else worth showing — leave the section hidden

    grid.innerHTML = others.map((p) => moreProductCard(p)).join("");
    grid.querySelectorAll(".product-card").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const id = el.dataset.productId;
        if (id) window.location.href = `/buyer/product.html?id=${id}`;
      });
    });
    section.hidden = false;
  } catch {
    // "More from this shop" is a nice-to-have — a failed fetch just
    // leaves the section hidden rather than showing a broken grid.
  }
}

function moreProductCard(p) {
  const image = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null;
  const thumb = image
    ? `<img src="${escapeHtml(resolveImage(image))}" alt="${escapeHtml(p.name)}">`
    : `<span>${escapeHtml((p.name || "?").slice(0, 1).toUpperCase())}</span>`;
  const stock = (p.stock ?? 0) <= 0 ? { cls: "is-low", label: "Out of stock" } : (p.stock ?? 0) <= 5 ? { cls: "is-low", label: `Only ${p.stock} left` } : null;

  return `
    <a href="#" class="product-card" data-product-id="${p.id}">
      <div class="product-thumb">
        ${thumb}
        ${p.discount?.is_live ? `<span class="product-discount-tag">-${p.discount.percent_off}%</span>` : ""}
      </div>
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

/* ---------------- states ---------------- */

function skeletonCard() {
  return `<div class="product-card-skel"><div class="sk-thumb"></div><div class="sk-line w60"></div><div class="sk-line w40"></div></div>`;
}

function skeletonHtml() {
  return `
    <div class="shop-back-link is-skel"></div>
    <div class="pdp-layout">
      <div class="pdp-gallery"><div class="sk-thumb" style="border-radius:14px;aspect-ratio:1/1;height:auto;"></div></div>
      <div class="pdp-info">
        <div class="sk-line w40" style="height:11px;width:140px;"></div>
        <div class="sk-line w60" style="height:24px;width:80%;margin-top:12px;"></div>
        <div class="sk-line w40" style="height:14px;width:160px;margin-top:14px;"></div>
        <div class="sk-line w40" style="height:22px;width:120px;margin-top:14px;"></div>
        <div class="sk-line w60" style="height:60px;margin-top:16px;"></div>
      </div>
    </div>
  `;
}

function errorState(message) {
  return `
    <div class="state-card">
      <span class="state-seal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>
      </span>
      <h3>Couldn't load this product</h3>
      <p>${escapeHtml(message || "Something went wrong. Please try again in a moment.")}</p>
      <a href="/buyer/index.html" class="btn btn-outline">Back to browsing</a>
    </div>
  `;
}
