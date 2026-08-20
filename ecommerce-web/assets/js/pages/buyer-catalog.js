// assets/js/pages/buyer-catalog.js
// Buyer landing page (buyer/index.html) — the storefront's main "browse"
// screen. Category chips + the nav search box filter GET /products;
// clicking a card (or its quick-add button) opens a quick-view modal that
// fetches the full GET /products/{id} (images + variations aren't eager
// loaded on the list endpoint) and adds to cart from there.

import { api } from "../api.js";
import { API_BASE_URL } from "../config.js";
import { initShell, refreshCartBadge } from "../partials/buyer-shell.js";
import { escapeHtml, money, toast, openModal, closeModal, normalizePaginated } from "../lib/ui.js";
import { getUser } from "../auth.js";

// GET /products returns image `path`s relative to the storage disk (see
// ProductImage/config/filesystems.php), not full URLs — API_BASE_URL is
// "<origin>/api", so stripping "/api" gives the app origin to prefix
// "/storage/..." onto. Already-absolute paths (http/https) pass through.
const APP_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");

const state = {
  category: null, // selected category id, or null for "All"
  search: "",
  page: 1,
  lastPage: 1,
  loading: false,
};

const content = initShell({
  page: "browse",
  onSearch: (query) => {
    state.search = query.trim();
    state.page = 1;
    loadProducts({ replace: true });
  },
});

content.innerHTML = `
  <section class="welcome-banner">
    <div>
      <span class="eyebrow"><span class="stamp"></span>${greeting()}</span>
      <h1>What are you <em>shopping</em> for today?</h1>
      <p class="welcome-sub">Browse everything on ShopUno — fresh stalls, everyday goods, and specialty finds, all from one cart.</p>
    </div>
    <div class="welcome-stub">
      <div class="welcome-stub-item">
        <strong id="statCategories">—</strong>
        <span>Categories</span>
      </div>
      <div class="welcome-stub-item">
        <strong id="statProducts">—</strong>
        <span>Products</span>
      </div>
    </div>
  </section>

  <nav class="cat-scroller" id="catScroller" aria-label="Filter by category">
    <div class="cat-chip-skel"></div>
    <div class="cat-chip-skel"></div>
    <div class="cat-chip-skel"></div>
    <div class="cat-chip-skel"></div>
  </nav>

  <div class="section-head">
    <div>
      <h2 id="gridTitle">All products</h2>
      <p id="gridCount"></p>
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
`;

document.getElementById("loadMoreBtn").addEventListener("click", () => {
  state.page += 1;
  loadProducts({ replace: false });
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

const CATEGORY_ICONS = ["🛍️", "🥬", "📱", "🏠", "💄", "🧸", "🚲", "🍜", "👗", "🔧"];

async function loadCategories() {
  const scroller = document.getElementById("catScroller");
  try {
    const res = await api.get("/categories");
    const categories = res?.data || [];
    document.getElementById("statCategories").textContent = categories.length;

    const chips = [
      `<button type="button" class="cat-chip is-active" data-cat="">
        <span class="cat-dot">🛒</span>All
      </button>`,
      ...categories.map((cat, i) => `
        <button type="button" class="cat-chip" data-cat="${cat.id}">
          <span class="cat-dot">${CATEGORY_ICONS[i % CATEGORY_ICONS.length]}</span>${escapeHtml(cat.name)}
        </button>
      `),
    ];
    scroller.innerHTML = chips.join("");

    scroller.querySelectorAll(".cat-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        scroller.querySelectorAll(".cat-chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        state.category = chip.dataset.cat || null;
        state.page = 1;
        document.getElementById("gridTitle").textContent = state.category
          ? chip.textContent.trim()
          : "All products";
        loadProducts({ replace: true });
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

    if (replace) grid.innerHTML = "";

    if (products.length === 0 && state.page === 1) {
      grid.innerHTML = emptyState();
      loadMoreRow.hidden = true;
      return;
    }

    grid.insertAdjacentHTML("beforeend", products.map(productCard).join(""));
    grid.querySelectorAll(".product-card, .product-quickadd").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const id = el.closest("[data-product-id]")?.dataset.productId;
        if (id) openQuickView(id);
      });
    });

    loadMoreRow.hidden = state.page >= state.lastPage;
  } catch (err) {
    if (replace) {
      grid.innerHTML = errorState(err.message);
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

function stockBadge(stock) {
  if (stock <= 0) return { cls: "out_of_stock", label: "Out of stock" };
  if (stock <= 5) return { cls: "low_stock", label: `Only ${stock} left` };
  return null;
}

function productCard(p) {
  const image = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null;
  const thumb = image
    ? `<img src="${escapeHtml(resolveImage(image))}" alt="${escapeHtml(p.name)}">`
    : `<span>${escapeHtml((p.name || "?").slice(0, 1).toUpperCase())}</span>`;
  const stock = stockBadge(p.stock ?? 0);

  return `
    <a href="#" class="product-card" data-product-id="${p.id}">
      <div class="product-thumb">
        ${thumb}
        <span class="product-quickadd" title="Quick view &amp; add to cart">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </span>
      </div>
      <div class="product-body">
        <div class="product-seller">${escapeHtml(p.seller?.business_name || "ShopUno seller")}</div>
        <div class="product-name">${escapeHtml(p.name)}</div>
        <div class="product-price">${money(p.base_price)}</div>
        ${stock ? `<span class="product-stock${stock.cls === "out_of_stock" ? " is-low" : ""}">${stock.label}</span>` : ""}
      </div>
    </a>
  `;
}

function resolveImage(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${APP_ORIGIN}/storage/${path.replace(/^\/?storage\//, "")}`;
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
    </div>
  `;
}

/* ---------------- quick view + add to cart ---------------- */

async function openQuickView(productId) {
  openModal((box) => {
    box.innerHTML = `<div class="modal-body"><div class="qv-layout"><div><div class="sk-thumb" style="border-radius:14px;"></div></div><div><div class="sk-line w60"></div><div class="sk-line w40"></div></div></div></div>`;
  }, { wide: true });

  try {
    const res = await api.get(`/products/${productId}`);
    const product = res?.product;
    if (!product) throw new Error("Product not found.");
    renderQuickView(product);
  } catch (err) {
    closeModal();
    toast(err.message || "Couldn't load that product.", "error");
  }
}

function renderQuickView(product) {
  const images = Array.isArray(product.images) ? product.images : [];
  const variations = Array.isArray(product.variations) ? product.variations : [];

  // Group variations by type (e.g. "Size", "Color") so each renders as its
  // own pill row — a product with no variations just skips this entirely.
  const groups = variations.reduce((acc, v) => {
    (acc[v.variation_type] ||= []).push(v);
    return acc;
  }, {});

  const selection = {}; // variation_type -> selected variation id
  Object.keys(groups).forEach((type) => {
    const firstInStock = groups[type].find((v) => v.stock > 0) || groups[type][0];
    selection[type] = firstInStock?.id ?? null;
  });

  let qty = 1;

  openModal((box) => {
    box.innerHTML = `
      <div class="modal-header">
        <div></div>
        <button type="button" class="modal-close" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="qv-layout">
          <div>
            <div class="qv-gallery-main" id="qvMain">
              ${images.length ? `<img src="${escapeHtml(resolveImage(images[0]))}" alt="${escapeHtml(product.name)}">` : `<span>${escapeHtml((product.name || "?").slice(0, 1).toUpperCase())}</span>`}
            </div>
            ${images.length > 1 ? `
              <div class="qv-thumbs" id="qvThumbs">
                ${images.map((img, i) => `<button type="button" class="qv-thumb${i === 0 ? " is-active" : ""}" data-src="${escapeHtml(resolveImage(img))}"><img src="${escapeHtml(resolveImage(img))}" alt=""></button>`).join("")}
              </div>` : ""}
          </div>
          <div>
            <div class="qv-seller">${escapeHtml(product.seller?.business_name || "ShopUno seller")}</div>
            <div class="qv-name">${escapeHtml(product.name)}</div>
            <div class="qv-price" id="qvPrice">${money(product.base_price)}</div>
            <p class="qv-desc">${escapeHtml(product.description || "No description provided by the seller yet.")}</p>

            <div id="qvVariations">
              ${Object.entries(groups).map(([type, options]) => `
                <div class="qv-variation-group" data-type="${escapeHtml(type)}">
                  <div class="qv-variation-label">${escapeHtml(type)}</div>
                  <div class="qv-variation-options">
                    ${options.map((v) => `
                      <button type="button" class="qv-variation-pill${selection[type] === v.id ? " is-selected" : ""}"
                        data-type="${escapeHtml(type)}" data-id="${v.id}" data-stock="${v.stock}"
                        ${v.stock <= 0 ? "disabled" : ""}>
                        ${escapeHtml(v.value)}
                      </button>
                    `).join("")}
                  </div>
                </div>
              `).join("")}
            </div>

            <div class="qv-qty-row">
              <div class="qv-stepper">
                <button type="button" id="qvQtyMinus" aria-label="Decrease quantity">−</button>
                <span id="qvQtyValue">1</span>
                <button type="button" id="qvQtyPlus" aria-label="Increase quantity">+</button>
              </div>
              <span class="qv-stock-note" id="qvStockNote"></span>
            </div>

            <div class="field-error" id="qvError" hidden></div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-outline" data-close>Keep browsing</button>
        <button type="button" class="btn btn-primary" id="qvAddBtn">
          <span class="btn-label">Add to cart</span>
          <span class="spinner"></span>
        </button>
      </div>
    `;

    box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));

    // image thumbs
    box.querySelectorAll(".qv-thumb").forEach((t) => {
      t.addEventListener("click", () => {
        box.querySelectorAll(".qv-thumb").forEach((x) => x.classList.remove("is-active"));
        t.classList.add("is-active");
        box.querySelector("#qvMain").innerHTML = `<img src="${t.dataset.src}" alt="${escapeHtml(product.name)}">`;
      });
    });

    function currentVariation() {
      if (Object.keys(selection).length === 0) return null;
      // Only meaningful once every group has a selection; find the matching
      // variation object among the flat list by id (any one group's id is
      // enough since each variation row is its own type+value pair here).
      const anyType = Object.keys(selection)[0];
      const id = selection[anyType];
      return variations.find((v) => v.id === id) || null;
    }

    function updateAvailability() {
      const v = currentVariation();
      const stock = v ? v.stock : product.stock;
      const price = v ? Number(product.base_price) + Number(v.price_adjustment || 0) : Number(product.base_price);
      box.querySelector("#qvPrice").textContent = money(price);

      const note = box.querySelector("#qvStockNote");
      const addBtn = box.querySelector("#qvAddBtn");
      if (stock <= 0) {
        note.textContent = "Out of stock";
        note.classList.add("is-low");
        addBtn.disabled = true;
      } else {
        note.classList.toggle("is-low", stock <= 5);
        note.textContent = stock <= 5 ? `Only ${stock} left` : `${stock} in stock`;
        addBtn.disabled = false;
        qty = Math.min(qty, stock);
      }
      box.querySelector("#qvQtyValue").textContent = qty;
      box.querySelector("#qvQtyMinus").disabled = qty <= 1;
      box.querySelector("#qvQtyPlus").disabled = qty >= stock;
    }

    box.querySelectorAll(".qv-variation-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const type = pill.dataset.type;
        selection[type] = Number(pill.dataset.id);
        qty = 1;
        box.querySelectorAll(`.qv-variation-pill[data-type="${CSS.escape(type)}"]`).forEach((p) =>
          p.classList.toggle("is-selected", p === pill)
        );
        updateAvailability();
      });
    });

    box.querySelector("#qvQtyMinus").addEventListener("click", () => { qty = Math.max(1, qty - 1); updateAvailability(); });
    box.querySelector("#qvQtyPlus").addEventListener("click", () => {
      const v = currentVariation();
      const stock = v ? v.stock : product.stock;
      qty = Math.min(stock, qty + 1);
      updateAvailability();
    });

    box.querySelector("#qvAddBtn").addEventListener("click", async () => {
      const addBtn = box.querySelector("#qvAddBtn");
      const errorBox = box.querySelector("#qvError");
      errorBox.hidden = true;
      addBtn.classList.add("is-loading");
      addBtn.disabled = true;
      try {
        const v = currentVariation();
        await api.post("/cart/items", {
          product_id: product.id,
          product_variation_id: v ? v.id : null,
          quantity: qty,
        });
        toast(`Added ${qty} × ${product.name} to cart.`, "success");
        refreshCartBadge();
        closeModal();
      } catch (err) {
        errorBox.textContent = err.message || "Couldn't add that to your cart.";
        errorBox.hidden = false;
        addBtn.classList.remove("is-loading");
        addBtn.disabled = false;
      }
    });

    updateAvailability();
  }, { wide: true });
}

loadCategories();
loadProducts({ replace: true });
