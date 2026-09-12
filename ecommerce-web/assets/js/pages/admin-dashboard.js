// assets/js/pages/admin-dashboard.js
import { api } from "../api.js";
import { initShell } from "../partials/admin-shell.js";
import { escapeHtml, timeAgo, toast } from "../lib/ui.js";

const content = initShell({ page: "dashboard", title: "Dashboard", eyebrow: "Overview" });

content.innerHTML = `
  <div id="attentionStrip"></div>
  <div class="stat-grid" id="statGrid"></div>
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Recent activity</h3>
        <p>The last 10 moderation, compliance, and complaint events across the platform.</p>
      </div>
    </div>
    <div class="panel-body is-flush">
      <div class="activity-list" id="activityList">
        <div class="empty-state">Loading recent activity…</div>
      </div>
    </div>
  </div>
`;

const LABELS = {
  pending_registrations: "pending registration",
  pending_seller_applications: "pending seller application",
  open_complaints: "open complaint",
  flagged_products: "flagged product",
};

// Bespoke line-icon set (matches the sidebar's visual language) instead
// of emoji, so the feed reads as designed rather than borrowed.
const ACTIVITY_ICON = {
  moderation: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  compliance: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  complaint: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  seller_application: '<path d="M3.5 9 5 4h14l1.5 5"/><path d="M4.5 9v9.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 20v-6h5v6"/>',
};

// One icon per stat card, drawn from the same line-icon set as the sidebar
// so the grid can be scanned at a glance instead of read.
const STAT_ICONS = {
  pending_registrations: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  pending_seller_applications: '<path d="M3.5 9 5 4h14l1.5 5"/><path d="M4.5 9v9.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M9.5 20v-6h5v6"/>',
  active_users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  suspended: '<circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/>',
  flagged_products: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  open_complaints: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  orders_today: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  orders_week: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
};

function statIcon(name) {
  return `<span class="stat-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${STAT_ICONS[name] || ""}</svg>
  </span>`;
}

// Where clicking a stat card or attention chip should take the admin —
// straight to the filtered queue that explains the number, instead of
// making them navigate the rail themselves.
const ATTENTION_LINK = {
  pending_registrations: "registrations.html",
  pending_seller_applications: "registrations.html?role=seller",
  open_complaints: "complaints.html",
  flagged_products: "compliance.html",
};

load();

async function load() {
  try {
    const data = await api.get("/admin/dashboard");
    renderAttention(data.needs_attention || {});
    renderStats(data.counts || {});
    renderActivity(data.recent_activity || []);
  } catch (err) {
    toast(err.message || "Failed to load dashboard.", "error");
    document.getElementById("statGrid").innerHTML = `<div class="empty-state">Couldn't load the dashboard. Try refreshing.</div>`;
  }
}

function renderAttention(attention) {
  const strip = document.getElementById("attentionStrip");
  const entries = Object.entries(attention);
  if (entries.length === 0) {
    strip.className = "attention-empty";
    strip.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      Nothing needs your attention right now — all clear.
    `;
    return;
  }
  strip.className = "attention-strip";
  strip.innerHTML = entries
    .map(([key, count]) => {
      const href = ATTENTION_LINK[key];
      const tag = href ? "a" : "div";
      return `
      <${tag} class="attention-chip"${href ? ` href="${href}"` : ""}>
        <span class="dot"></span>
        <span class="count">${count}</span>
        <span>${escapeHtml(LABELS[key] || key.replace(/_/g, " "))}${count === 1 ? "" : "s"}</span>
      </${tag}>`;
    })
    .join("");
}

/** Renders a small stacked-bar breakdown (used inside the hero tile) —
 * three role counts as proportional bars instead of plain numbers. */
function roleBars(breakdown) {
  const rows = [
    { name: "Buyers", value: breakdown.buyer ?? 0 },
    { name: "Sellers", value: breakdown.seller ?? 0 },
    { name: "Couriers", value: breakdown.courier ?? 0 },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));
  return `
    <div class="stat-bars">
      ${rows
        .map(
          (r) => `
        <div class="stat-bar-row">
          <span class="bar-name mono">${r.name}</span>
          <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${Math.round((r.value / max) * 100)}%"></span></span>
          <span class="bar-count mono">${r.value}</span>
        </div>`
        )
        .join("")}
    </div>
  `;
}

function renderStats(counts) {
  const grid = document.getElementById("statGrid");
  const rb = counts.pending_registrations || {};
  const au = counts.active_users || {};

  grid.innerHTML = `
    <div class="stat-card is-hero">
      <div class="stat-label">Active users ${statIcon("active_users")}</div>
      <div class="stat-value">${au.total ?? 0}</div>
      ${roleBars(au)}
    </div>
    <a class="stat-card${(rb.total || 0) > 0 ? " is-warm" : ""}" href="${ATTENTION_LINK.pending_registrations}">
      <div class="stat-label">Pending registrations ${statIcon("pending_registrations")}</div>
      <div class="stat-value">${rb.total ?? 0}</div>
      <div class="stat-breakdown">
        <span><b>${rb.logistics ?? 0}</b> logistics</span>
        <span><b>${rb.courier ?? 0}</b> couriers</span>
        <span><b>${rb.buyer ?? 0}</b> buyers</span>
      </div>
    </a>
    <a class="stat-card${(counts.pending_seller_applications || 0) > 0 ? " is-warm" : ""}" href="${ATTENTION_LINK.pending_seller_applications}">
      <div class="stat-label">Pending seller applications ${statIcon("pending_seller_applications")}</div>
      <div class="stat-value">${counts.pending_seller_applications ?? 0}</div>
      <div class="stat-breakdown"><span>Buyers applying to sell</span></div>
    </a>
    <div class="stat-card${(counts.suspended_or_deactivated || 0) > 0 ? " is-alert" : ""}">
      <div class="stat-label">Suspended / deactivated ${statIcon("suspended")}</div>
      <div class="stat-value">${counts.suspended_or_deactivated ?? 0}</div>
      <div class="stat-breakdown"><span>Across all roles</span></div>
    </div>
    <a class="stat-card${(counts.flagged_products || 0) > 0 ? " is-warm" : ""}" href="${ATTENTION_LINK.flagged_products}">
      <div class="stat-label">Flagged products ${statIcon("flagged_products")}</div>
      <div class="stat-value">${counts.flagged_products ?? 0}</div>
      <div class="stat-breakdown"><span>Currently under review</span></div>
    </a>
    <a class="stat-card${(counts.open_complaints || 0) > 0 ? " is-alert" : ""}" href="${ATTENTION_LINK.open_complaints}">
      <div class="stat-label">Open complaints ${statIcon("open_complaints")}</div>
      <div class="stat-value">${counts.open_complaints ?? 0}</div>
      <div class="stat-breakdown"><span><b>${counts.complaints_under_review ?? 0}</b> under review</span></div>
    </a>
    <div class="stat-card">
      <div class="stat-label">Orders today ${statIcon("orders_today")}</div>
      <div class="stat-value">${counts.orders_today ?? 0}</div>
      <div class="stat-breakdown"><span>Placed since midnight</span></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Orders this week ${statIcon("orders_week")}</div>
      <div class="stat-value">${counts.orders_this_week ?? 0}</div>
      <div class="stat-breakdown"><span>Since start of week</span></div>
    </div>
  `;
}

function activityIcon(type) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ACTIVITY_ICON[type] || '<circle cx="12" cy="12" r="3"/>'}</svg>`;
}

function renderActivity(items) {
  const list = document.getElementById("activityList");
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-title">Quiet so far</div>No moderation, compliance, or complaint activity yet.</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (item) => `
      <div class="activity-row">
        <div class="activity-icon type-${escapeHtml(item.type)}">${activityIcon(item.type)}</div>
        <div class="activity-body">
          <div class="activity-summary">${escapeHtml(item.summary)}</div>
          ${item.note ? `<div class="activity-note">“${escapeHtml(item.note)}”</div>` : ""}
          <div class="activity-time">${timeAgo(item.created_at)}</div>
        </div>
      </div>`
    )
    .join("");
}
