// assets/js/pages/seller-dashboard.js
import { api } from "../api.js";
import { getUser } from "../auth.js";
import { initShell } from "../partials/seller-shell.js";
import { escapeHtml, money, timeAgo, toast } from "../lib/ui.js";

const content = initShell({ page: "dashboard", title: "Dashboard", eyebrow: "Seller console" });

// The topbar's live "shop floor" chips are hidden on this page (the stat
// grid below already covers those same numbers, bigger and with more
// context — see seller.css). Left on its own that leaves the topbar's
// right side looking like empty space rather than a deliberate choice,
// so a plain, non-numeric date line fills it instead of just leaving a gap.
const topbarLeft = document.querySelector(".topbar-left");
if (topbarLeft) {
  const cluster = document.createElement("div");
  cluster.className = "dash-topbar-cluster";
  cluster.innerHTML = `
    <span class="dash-topbar-status"><span class="dash-topbar-status-dot"></span>Shop open</span>
    <span class="dash-topbar-divider"></span>
    <span class="dash-topbar-date">${svgIcon('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>')}${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
  `;
  topbarLeft.appendChild(cluster);
}

content.innerHTML = `
  <div id="setupCard"></div>
  <div id="attentionStrip"></div>
  <div class="stat-grid dash-overview-grid" id="overviewStrip"></div>
  <div class="dash-quickstrip" id="quickActions"></div>

  <div class="dash-grid">
    <div class="dash-col dash-col-side">
      <div id="statGrid"></div>
    </div>

    <div class="dash-col dash-col-main">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title-group">
            <span class="panel-title-icon tone-gold">${svgIcon('<path d="M3 3v18h18"/><path d="M18.7 8 12 14.7 8.7 11.4 3 17.1"/>')}</span>
            <div>
              <h3>Sales trend</h3>
              <p id="trendSub">Placed sales over the last 14 days.</p>
            </div>
          </div>
          <a class="btn btn-sm btn-outline" href="reports.html">Full report</a>
        </div>
        <div class="panel-body">
          <div class="chart-wrap" id="trendChartWrap">
            <div class="empty-state">Loading trend…</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div class="panel-title-group">
            <span class="panel-title-icon tone-amber">${svgIcon('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>')}</span>
            <div>
              <h3>Top products</h3>
              <p>Best sellers over the last 30 days.</p>
            </div>
          </div>
          <a class="btn btn-sm btn-outline" href="reports.html">Full report</a>
        </div>
        <div class="panel-body is-flush" id="topProductsPanel">
          <div class="empty-state">Loading top products…</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div class="panel-title-group">
            <span class="panel-title-icon tone-green">${svgIcon('<path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/>')}</span>
            <div>
              <h3>Recent activity</h3>
              <p>New orders and ratings from the last little while.</p>
            </div>
          </div>
        </div>
        <div class="panel-body is-flush">
          <div class="activity-list" id="activityList">
            <div class="empty-state">Loading recent activity…</div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const ATTENTION_LABELS = {
  pending_orders: (n) => (n === 1 ? "order awaiting shipment" : "orders awaiting shipment"),
  low_stock_products: (n) => (n === 1 ? "product running low" : "products running low"),
  flagged_products: (n) => (n === 1 ? "flagged product" : "flagged products"),
  draft_products: (n) => (n === 1 ? "unpublished draft" : "unpublished drafts"),
};

const ATTENTION_LINK = {
  pending_orders: "orders.html?status=to_ship",
  low_stock_products: "products.html?filter=low_stock",
  flagged_products: "products.html?filter=flagged",
  draft_products: "products.html?filter=draft",
};

const STAT_ICONS = {
  orders_today: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  orders_this_week: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  in_progress_orders: '<path d="M16.5 9.4 7.5 4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>',
  total_products: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  low_stock_products: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>',
  flagged_products: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  average_rating: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  revenue: '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
};

const ACTIVITY_ICON = {
  order: '<path d="M16.5 9.4 7.5 4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>',
  rating: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
};

const QUICK_ACTIONS = [
  {
    href: "products.html?new=1",
    title: "Add a product",
    sub: "List something new in your shop",
    icon: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    tone: "gold",
    primary: true,
  },
  {
    href: "orders.html?status=to_ship",
    title: "Ship pending orders",
    sub: "Get today's orders out the door",
    icon: '<path d="M16.5 9.4 7.5 4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>',
    tone: "amber",
  },
  {
    href: "vouchers.html?new=1",
    title: "Create a voucher",
    sub: "Run a discount to boost sales",
    icon: '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2.5 12.5V4a1.5 1.5 0 0 1 1.5-1.5h8.5l8.09 8.09a2 2 0 0 1 0 2.82Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    tone: "green",
  },
];

function svgIcon(path) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

/** Renders a small "+12% vs last week"-style trend pill, but only when
 * the API actually gives us something to compare against (an optional
 * `<key>_prev` field alongside the current count). Without a real prior
 * value to diff against, this returns nothing rather than fabricate a
 * number — showing a seller a made-up trend on their own sales data
 * would be worse than showing no trend at all. */
function trendHtml(current, previous) {
  if (previous == null || !Number.isFinite(Number(previous)) || Number(previous) === 0) return "";
  const delta = ((Number(current) - Number(previous)) / Number(previous)) * 100;
  const rounded = Math.round(delta);
  if (rounded === 0) return `<span class="stat-trend is-flat">No change</span>`;
  const up = rounded > 0;
  return `<span class="stat-trend ${up ? "is-up" : "is-down"}">${up ? "▲" : "▼"} ${Math.abs(rounded)}% vs last week</span>`;
}

const SETUP_DISMISS_KEY = "seller_setup_dismissed";

renderQuickActions();
load();

async function load() {
  try {
    const data = await api.get("/seller/dashboard");
    renderSetupCard(data.counts || {});
    renderAttention(data.needs_attention || {});
    renderOverview(data.counts || {}, data.revenue || {});
    renderStats(data.counts || {});
    renderTrendChart(data.sales_trend || []);
    renderTopProducts(data.top_products || []);
    renderActivity(data.recent_activity || []);
  } catch (err) {
    toast(err.message || "Failed to load your dashboard.", "error");
    document.getElementById("overviewStrip").innerHTML = `<div class="empty-state">Couldn't load the dashboard. Try refreshing.</div>`;
    document.getElementById("statGrid").innerHTML = "";
    document.getElementById("trendChartWrap").innerHTML = `<div class="empty-state">Couldn't load the sales trend.</div>`;
    document.getElementById("topProductsPanel").innerHTML = `<div class="empty-state">Couldn't load top products.</div>`;
  }
}

/** A single, unified "state of the shop right now" strip — replaces what
 * used to be two overlapping sources of the same numbers (a stat-card row
 * in the side column *and* a Today/This-week strip inside the chart
 * panel). One row, one job: here's where things stand today.
 *
 * Each card gets its own permanent color+icon identity so the four are
 * legible at a glance without reading the labels: revenue gets the
 * console's "positive activity" green; orders today is the bold "signal"
 * card (deepening further once there's something to show) — gold's the
 * one color reserved for a card that goes fully solid, so it sits on
 * whichever metric is meant to read as the day's headline number. Orders
 * this week — a plain reference count, neither good nor bad — gets a
 * calm neutral slate so it doesn't borrow a tone it hasn't earned.
 * Awaiting shipment is the one card whose color is conditional: it turns
 * warm only when there's actually something pending, because that's a
 * real, actionable state, not just a number. */
function renderOverview(counts, revenue) {
  const el = document.getElementById("overviewStrip");
  if (!el) return;
  const revenueToday = revenue.today ?? 0;
  const pending = counts.pending_orders ?? 0;

  el.innerHTML = `
    <div class="stat-card is-tone-go">
      <div class="stat-label">Revenue today ${statIcon("revenue")}</div>
      <div class="stat-value">${money(revenueToday)}</div>
      <div class="stat-sub">${money(revenue.this_week ?? 0)} this week</div>
      ${trendHtml(revenue.this_week ?? 0, revenue.this_week_prev)}
    </div>
    <div class="stat-card is-signal${(counts.orders_today ?? 0) > 0 ? " is-active" : ""}">
      <div class="stat-label">Orders today ${statIcon("orders_today")}</div>
      <div class="stat-value">${counts.orders_today ?? 0}</div>
      <div class="stat-sub">Placed since midnight</div>
    </div>
    <div class="stat-card is-tone-slate">
      <div class="stat-label">Orders this week ${statIcon("orders_this_week")}</div>
      <div class="stat-value">${counts.orders_this_week ?? 0}</div>
      <div class="stat-sub">Since start of week</div>
      ${trendHtml(counts.orders_this_week ?? 0, counts.orders_this_week_prev)}
    </div>
    <a class="stat-card${pending > 0 ? " is-warm" : ""}" href="orders.html?status=to_ship">
      <div class="stat-label">Awaiting shipment ${statIcon("in_progress_orders")}</div>
      <div class="stat-value">${pending}</div>
      <div class="stat-sub">${counts.in_progress_orders ? `<b>${counts.in_progress_orders}</b> more already in transit` : "Nothing else in transit"}</div>
    </a>
  `;
}

/** A short, dismissible setup checklist for sellers who haven't finished
 * the basics yet — a shop logo, a line of business, and a first listing.
 * Disappears for good once every item is done, or as soon as the seller
 * dismisses it (remembered in localStorage; it isn't worth a backend
 * round-trip for a one-time nudge). */
function renderSetupCard(counts) {
  const card = document.getElementById("setupCard");
  if (localStorage.getItem(SETUP_DISMISS_KEY) === "1") { card.innerHTML = ""; return; }

  const user = getUser();
  const items = [
    {
      done: !!user?.seller?.logo_url,
      title: "Add a shop logo",
      sub: "Helps buyers recognize your shop at a glance",
      cta: "Add logo",
      href: "account.html",
    },
    {
      done: !!user?.seller?.line_of_business,
      title: "Describe your line of business",
      sub: "Shown on your shop plate and used for category suggestions",
      cta: "Add details",
      href: "account.html",
    },
    {
      // Counts as done only once something is actually live — a draft
      // sitting unpublished isn't "selling" yet, even though it counts
      // toward total_products.
      done: ((counts.total_products || 0) - (counts.draft_products || 0)) > 0,
      title: "List your first product",
      sub: "Your shop needs at least one published listing to start selling",
      cta: "Add product",
      href: "products.html?new=1",
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) { card.innerHTML = ""; return; }

  card.innerHTML = `
    <div class="setup-card">
      <div class="setup-card-head">
        <span class="setup-card-icon">${svgIcon('<path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>')}</span>
        <div class="setup-card-titles">
          <h3>Finish setting up your shop</h3>
          <p>${doneCount} of ${items.length} done — just a couple things left.</p>
        </div>
        <button type="button" class="setup-dismiss" id="setupDismissBtn">Dismiss</button>
      </div>
      <div class="setup-progress"><div class="setup-progress-bar" style="width:${(doneCount / items.length) * 100}%"></div></div>
      <div class="setup-items">
        ${items.map((i) => `
          <div class="setup-item${i.done ? " is-done" : ""}">
            <span class="setup-item-check">${i.done ? svgIcon('<polyline points="20 6 9 17 4 12"/>') : ""}</span>
            <span class="setup-item-body">
              <span class="setup-item-title">${escapeHtml(i.title)}</span>
              <span class="setup-item-sub">${escapeHtml(i.sub)}</span>
            </span>
            ${i.done ? "" : `<a class="btn btn-sm btn-outline setup-item-cta" href="${i.href}">${escapeHtml(i.cta)}</a>`}
          </div>
        `).join("")}
      </div>
    </div>
  `;
  document.getElementById("setupDismissBtn").addEventListener("click", () => {
    localStorage.setItem(SETUP_DISMISS_KEY, "1");
    card.innerHTML = "";
  });
}

function renderAttention(attention) {
  const strip = document.getElementById("attentionStrip");
  const entries = Object.entries(attention);
  if (entries.length === 0) {
    strip.className = "attention-empty";
    strip.innerHTML = `
      ${svgIcon('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>')}
      Nothing needs your attention right now — the shop's running smoothly.
    `;
    return;
  }
  strip.className = "attention-banner";
  const chips = entries
    .map(([key, count]) => {
      const href = ATTENTION_LINK[key];
      const tag = href ? "a" : "div";
      const label = ATTENTION_LABELS[key] ? ATTENTION_LABELS[key](count) : key.replace(/_/g, " ");
      return `
      <${tag} class="attention-chip"${href ? ` href="${href}"` : ""}>
        <span class="dot"></span>
        <span class="count">${count}</span>
        <span>${escapeHtml(label)}</span>
      </${tag}>`;
    })
    .join("");
  strip.innerHTML = `
    <span class="attention-banner-icon">${svgIcon('<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>')}</span>
    <div class="attention-banner-body">
      <div class="attention-banner-title">Needs your attention</div>
      <div class="attention-chip-row">${chips}</div>
    </div>
  `;
}

function statIcon(name) {
  return `<span class="stat-icon">${svgIcon(STAT_ICONS[name] || "")}</span>`;
}

function renderStats(counts) {
  const grid = document.getElementById("statGrid");
  grid.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title-group">
          <span class="panel-title-icon tone-gold">${svgIcon('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>')}</span>
          <div>
            <h3>Shop health</h3>
            <p>Catalog and reputation, at a glance.</p>
          </div>
        </div>
      </div>
      <div class="panel-body is-flush">
        <div class="health-list">
          <a class="health-row" href="products.html">
            <span class="health-icon">${svgIcon(STAT_ICONS.total_products)}</span>
            <span class="health-body">
              <span class="health-title">Total products</span>
              <span class="health-sub">Not archived — live and drafts</span>
            </span>
            <span class="health-value">${counts.total_products ?? 0}</span>
          </a>
          <a class="health-row is-info" href="products.html?filter=draft">
            <span class="health-icon">${svgIcon(STAT_ICONS.total_products)}</span>
            <span class="health-body">
              <span class="health-title">Drafts</span>
              <span class="health-sub">Not published yet — finish and publish anytime</span>
            </span>
            <span class="health-value">${counts.draft_products ?? 0}</span>
          </a>
          <a class="health-row${(counts.low_stock_products ?? 0) > 0 ? " is-warm" : ""}" href="products.html?filter=low_stock">
            <span class="health-icon">${svgIcon(STAT_ICONS.low_stock_products)}</span>
            <span class="health-body">
              <span class="health-title">Low stock</span>
              <span class="health-sub">5 units or fewer left</span>
            </span>
            <span class="health-value">${counts.low_stock_products ?? 0}</span>
          </a>
          <a class="health-row${(counts.flagged_products ?? 0) > 0 ? " is-alert" : ""}" href="products.html?filter=flagged">
            <span class="health-icon">${svgIcon(STAT_ICONS.flagged_products)}</span>
            <span class="health-body">
              <span class="health-title">Flagged products</span>
              <span class="health-sub">Under compliance review</span>
            </span>
            <span class="health-value">${counts.flagged_products ?? 0}</span>
          </a>
          <a class="health-row is-good" href="ratings.html">
            <span class="health-icon">${svgIcon(STAT_ICONS.average_rating)}</span>
            <span class="health-body">
              <span class="health-title">Average rating</span>
              <span class="health-sub">Across all reviews — tap to see what buyers are saying</span>
            </span>
            <span class="health-value">${counts.average_rating != null ? counts.average_rating : "—"}</span>
          </a>
        </div>
        <div class="health-list-foot">
          <a href="products.html">View full catalog ${svgIcon('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>')}</a>
        </div>
      </div>
    </div>
  `;
}

/** A condensed one-line strip rather than the old full "Quick actions"
 * panel — on this wider layout the sales chart does the heavy lifting,
 * so these just need to stay reachable, not take up a whole card. */
function renderQuickActions() {
  document.getElementById("quickActions").innerHTML = QUICK_ACTIONS.map(
    (a) => `
    <a class="dash-quick-item${a.primary ? " is-primary" : ` tone-${a.tone}`}" href="${a.href}">
      <span class="dq-icon tone-${a.tone}">${svgIcon(a.icon)}</span>
      <span class="dq-label">${escapeHtml(a.title)}</span>
    </a>`
  ).join("");
}

/* ---------------- Sales trend chart ---------------- */

function renderTrendChart(daily) {
  const wrap = document.getElementById("trendChartWrap");
  const sub = document.getElementById("trendSub");

  if (!daily.length || daily.every((d) => d.sales === 0)) {
    wrap.innerHTML = `
      <div class="chart-empty-wrap">
        <svg class="chart-svg chart-svg-ghost" viewBox="0 0 1000 220" preserveAspectRatio="none" style="height:220px">
          <line x1="54" y1="176" x2="986" y2="176" class="chart-grid"></line>
          <line x1="54" y1="122" x2="986" y2="122" class="chart-grid"></line>
          <line x1="54" y1="68" x2="986" y2="68" class="chart-grid"></line>
          <line x1="54" y1="14" x2="986" y2="14" class="chart-grid"></line>
          <path d="M54,180 L184,168 L314,172 L444,140 L574,150 L704,110 L834,120 L964,84 L964,190 L54,190 Z" class="chart-area chart-ghost-area"></path>
          <path d="M54,180 L184,168 L314,172 L444,140 L574,150 L704,110 L834,120 L964,84" class="chart-line chart-ghost-line"></path>
        </svg>
        <div class="chart-empty-overlay">
          <span class="chart-empty-icon">${svgIcon('<path d="M3 3v18h18"/><path d="M7 15l3-4 3 2 4-6"/>')}</span>
          <div class="empty-title">No sales yet</div>
          <p>Placed orders will chart here as they come in — this is what it'll look like.</p>
          <a class="btn btn-sm btn-primary chart-empty-cta" href="vouchers.html?new=1">Create a voucher to boost sales</a>
        </div>
      </div>`;
    return;
  }

  const totalSales = daily.reduce((sum, d) => sum + (d.sales || 0), 0);
  const totalOrders = daily.reduce((sum, d) => sum + (d.orders || 0), 0);
  sub.textContent = `${money(totalSales)} placed across ${totalOrders} order${totalOrders === 1 ? "" : "s"} in the last 14 days.`;

  const W = 1000, H = 220, PAD_L = 54, PAD_R = 14, PAD_T = 14, PAD_B = 30;
  const n = daily.length;
  const sales = daily.map((d) => d.sales || 0);
  const maxVal = Math.max(...sales, 1) * 1.12;

  const xAt = (i) => (n === 1 ? (PAD_L + (W - PAD_R)) / 2 : PAD_L + (i * (W - PAD_L - PAD_R)) / (n - 1));
  const yAt = (v) => H - PAD_B - (v / maxVal) * (H - PAD_T - PAD_B);

  const line = sales.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  const area = `${line} L${xAt(n - 1).toFixed(1)},${(H - PAD_B).toFixed(1)} L${xAt(0).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;

  const gridCount = 3;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const v = (maxVal / gridCount) * i;
    const y = yAt(v);
    const label = i === 0 ? "" : `<text x="${PAD_L - 8}" y="${(y + 3).toFixed(1)}" class="chart-axis-y" text-anchor="end">${compactMoney(v)}</text>`;
    return `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" class="chart-grid"></line>${label}`;
  }).join("");

  const tickEvery = Math.max(1, Math.ceil(n / 6));
  const xLabels = daily.map((d, i) => {
    if (i % tickEvery !== 0 && i !== n - 1) return "";
    return `<text x="${xAt(i).toFixed(1)}" y="${H - 8}" class="chart-axis-x" text-anchor="middle">${shortDate(d.date)}</text>`;
  }).join("");

  wrap.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:220px">
      ${gridLines}
      <path d="${area}" class="chart-area"></path>
      <path d="${line}" class="chart-line chart-line-sales"></path>
      ${xLabels}
    </svg>
  `;
}

function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function compactMoney(v) {
  if (v >= 1000) return "₱" + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k";
  return "₱" + Math.round(v);
}

/* ---------------- Top products ---------------- */

/** Same leaderboard treatment (rank chip + revenue bar) as the Reports
 * page's "Top products" list, just fed from the dashboard's own rolling
 * 30-day window instead of the picker's custom range. */
function renderTopProducts(items) {
  const panel = document.getElementById("topProductsPanel");
  if (!items.length) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-title">No product sales yet</div>Best sellers from the last 30 days will show up here.</div>`;
    return;
  }
  const maxRevenue = Math.max(...items.map((i) => i.revenue), 1);
  panel.innerHTML = `
    <div class="lb-list">
      ${items.map((item, i) => `
        <div class="lb-row">
          <span class="lb-rank${i < 3 ? ` lb-rank-${i + 1}` : ""}">${i + 1}</span>
          <div class="lb-body">
            <div class="lb-top">
              <span class="lb-name">${escapeHtml(item.product_name || "Deleted product")}</span>
              <span class="lb-revenue mono">${money(item.revenue)}</span>
            </div>
            <div class="lb-bar-track">
              <div class="lb-bar-fill" style="width:${Math.max(4, (item.revenue / maxRevenue) * 100)}%"></div>
            </div>
            <div class="lb-sub">${item.qty_sold} sold</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderActivity(items) {
  const list = document.getElementById("activityList");
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-title">Quiet so far</div>New orders and ratings will show up here.</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (item) => `
      <div class="activity-row">
        <div class="activity-icon type-${escapeHtml(item.type)}">${svgIcon(ACTIVITY_ICON[item.type] || '<circle cx="12" cy="12" r="3"/>')}</div>
        <div class="activity-body">
          <div class="activity-summary">${escapeHtml(item.summary)}</div>
          <div class="activity-time">${timeAgo(item.created_at)}</div>
        </div>
      </div>`
    )
    .join("");
}
