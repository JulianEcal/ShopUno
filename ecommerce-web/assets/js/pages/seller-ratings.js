// assets/js/pages/seller-ratings.js
// Seller's customer feedback: GET /seller/ratings — paginated reviews left
// by buyers after delivery (see buyer-orders.js's ratingBoxHtml for where
// these come from), plus the running average the backend computes across
// ALL of a seller's ratings (Seller::averageRating(), returned as a sibling
// of the page of items — not something this page can recompute itself from
// one paginated page, so it's read straight off the response each load).
// Read-only: nothing here is editable or actionable, it's just "what buyers
// are saying about your shop."

import { api } from "../api.js";
import { initShell } from "../partials/seller-shell.js";
import { escapeHtml, formatDate, normalizePaginated } from "../lib/ui.js";

const content = initShell({ page: "ratings", title: "Ratings", eyebrow: "Seller console" });

const STAR_PATH = '<path d="M12 2.5l2.9 6.06 6.6.77-4.9 4.55 1.28 6.62L12 17.3l-5.88 3.2 1.28-6.62-4.9-4.55 6.6-.77L12 2.5z"/>';

function starsHtml(score, size = "sm") {
  return `
    <span class="rr-stars rr-stars-${size}" aria-label="${score} out of 5 stars">
      ${[1, 2, 3, 4, 5].map((n) => `
        <span class="rr-star${n <= score ? " is-filled" : ""}">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">${STAR_PATH}</svg>
        </span>
      `).join("")}
    </span>
  `;
}

content.innerHTML = `
  <div class="stat-grid" id="ratingSummary">
    <div class="stat-card">
      <div class="stat-label">Average rating</div>
      <div class="stat-value">—</div>
      <div class="stat-sub">Loading…</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total reviews</div>
      <div class="stat-value">—</div>
      <div class="stat-sub">&nbsp;</div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Customer feedback</h3>
        <p>What buyers are saying after their orders are delivered.</p>
      </div>
    </div>
    <div class="panel-body is-flush">
      <div class="rr-list" id="rrList">
        <div class="empty-state">Loading reviews…</div>
      </div>
    </div>
    <div class="pagination" id="pagination" hidden></div>
  </div>
`;

const state = { page: 1 };

load();

async function load() {
  const list = document.getElementById("rrList");
  list.innerHTML = `<div class="empty-state">Loading reviews…</div>`;

  try {
    const json = await api.get(`/seller/ratings?page=${state.page}`);
    const { items, meta } = normalizePaginated(json);
    renderSummary(json.average_rating, meta?.total ?? items.length);
    renderList(items);
    renderPagination(meta);
  } catch (err) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(err.message || "Couldn't load your reviews.")}</div>`;
  }
}

function renderSummary(averageRating, total) {
  const grid = document.getElementById("ratingSummary");
  const hasReviews = total > 0;
  grid.innerHTML = `
    <div class="stat-card${hasReviews ? " is-good" : ""}">
      <div class="stat-label">Average rating</div>
      <div class="stat-value">${hasReviews && averageRating != null ? Number(averageRating).toFixed(1) : "—"}</div>
      <div class="stat-sub">${hasReviews ? starsHtml(Math.round(averageRating || 0), "xs") : "No reviews yet"}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total reviews</div>
      <div class="stat-value">${total}</div>
      <div class="stat-sub">From delivered orders</div>
    </div>
  `;
}

function renderList(items) {
  const list = document.getElementById("rrList");
  if (!items.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">No reviews yet</div>
        Ratings show up here once buyers rate a delivered order.
      </div>
    `;
    return;
  }

  list.innerHTML = items
    .map((r) => `
      <div class="rr-row">
        <div class="rr-row-head">
          ${starsHtml(r.score)}
          <span class="rr-from">${escapeHtml(r.from || "A buyer")}</span>
          <a class="rr-order" href="orders.html?view=${r.order_id}">Order #${String(r.order_id).padStart(5, "0")}</a>
          <span class="rr-time">${formatDate(r.created_at)}</span>
        </div>
        ${r.feedback
          ? `<p class="rr-feedback">${escapeHtml(r.feedback)}</p>`
          : `<p class="rr-feedback is-empty">No written feedback.</p>`}
      </div>
    `)
    .join("");
}

function renderPagination(meta) {
  const el = document.getElementById("pagination");
  if (!meta || !meta.last_page || meta.last_page <= 1) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `
    <span>Page ${meta.current_page} of ${meta.last_page} · ${meta.total ?? ""} total</span>
    <div class="page-controls">
      <button class="btn btn-sm btn-outline" id="prevPage" ${meta.current_page <= 1 ? "disabled" : ""}>Previous</button>
      <button class="btn btn-sm btn-outline" id="nextPage" ${meta.current_page >= meta.last_page ? "disabled" : ""}>Next</button>
    </div>
  `;
  document.getElementById("prevPage")?.addEventListener("click", () => { state.page = Math.max(1, state.page - 1); load(); });
  document.getElementById("nextPage")?.addEventListener("click", () => { state.page += 1; load(); });
}
