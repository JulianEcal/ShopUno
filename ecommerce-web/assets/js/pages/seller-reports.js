// assets/js/pages/seller-reports.js
// Seller's own sales & earnings report — GET /seller/reports/sales?from=&to=,
// scoped server-side to the authenticated seller (same "billable" and
// "collected" definitions the admin ledger uses, see the backend controller).
//
// This page fetches the selected range AND the immediately-preceding range
// of equal length, purely client-side, so every headline number can show a
// "vs previous period" delta — the backend only needs to answer one range at
// a time, this just asks it twice.
//
// The trend chart, status split and top-products leaderboard are hand-built
// SVG/DOM (no charting dependency) so they can follow the console's own
// "workbench" visual language instead of a generic library's defaults.

import { api } from "../api.js";
import { initShell } from "../partials/seller-shell.js";
import { escapeHtml, formatDate, money, toast } from "../lib/ui.js";

const content = initShell({ page: "reports", title: "Reports", eyebrow: "Seller console" });

const STATUS_LABEL = {
  to_ship: "To ship",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

// Mirrors the badge color families in seller.css (--thrive / --warn /
// --accent / --danger) so the status split reads consistently with the
// badges used everywhere else in the console.
const STATUS_VAR = {
  delivered: "--thrive",
  out_for_delivery: "--accent",
  in_transit: "--accent",
  to_ship: "--warn",
  cancelled: "--danger",
};

const MS_DAY = 86400000;
const toISO = (d) => d.toISOString().slice(0, 10);
const fromISO = (s) => new Date(`${s}T00:00:00`);

const PRESETS = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "custom", label: "Custom" },
];

const today = new Date();
const state = {
  preset: "30d",
  from: toISO(new Date(today.getTime() - 29 * MS_DAY)),
  to: toISO(today),
};

content.innerHTML = `
  <div class="panel rpt-controls">
    <div class="panel-header">
      <div>
        <h3>Sales &amp; earnings</h3>
        <p>
          How a placed order turns into money in your pocket.
          <button type="button" class="rpt-info-btn" title="Cash-on-delivery aware: &quot;sales&quot; is what's been placed, &quot;collected&quot; is cash actually in hand.">
            ${icon('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>', 13)}
          </button>
        </p>
      </div>
      <button type="button" class="btn btn-sm btn-outline" id="exportBtn">
        ${icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>')}
        Export CSV
      </button>
    </div>
    <div class="panel-body">
      <div class="range-row">
        <div class="range-pills" id="rangePills"></div>
        <div class="range-custom" id="rangeCustom" hidden>
          <input type="date" id="fFrom" value="${state.from}">
          <span>–</span>
          <input type="date" id="fTo" value="${state.to}">
          <button type="button" class="btn btn-sm btn-primary" id="applyCustom">Apply</button>
        </div>
        <span class="range-caption" id="rangeCaption"></span>
      </div>
    </div>
  </div>

  <div class="rpt-hero-row">
    <div class="rpt-hero" id="rptHero">
      <div class="rpt-hero-top">
        <div>
          <div class="rpt-hero-label">Net earnings</div>
          <div class="rpt-hero-value" id="heroValue">—</div>
        </div>
        <span class="rpt-delta" id="heroDelta" hidden></span>
      </div>
      <div class="rpt-hero-sub" id="heroSub">Collected revenue after platform commission</div>
      <svg class="rpt-spark" id="heroSpark" viewBox="0 0 300 56" preserveAspectRatio="none"></svg>
    </div>
    <div class="rpt-flow-card">
      <div class="rpt-flow-top">
        <span class="rpt-flow-title">Where it comes from</span>
        <span class="rpt-flow-orders" id="flowOrders">0 orders</span>
      </div>
      <div class="rpt-flow" id="rptFlow"></div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Sales trend</h3>
        <p id="trendSub">Daily placed sales vs. cash actually collected.</p>
      </div>
      <div class="rpt-legend">
        <span class="rpt-legend-item"><i style="background:var(--accent)"></i>Sales</span>
        <span class="rpt-legend-item"><i style="background:var(--thrive)"></i>Collected</span>
      </div>
    </div>
    <div class="panel-body">
      <div class="chart-wrap" id="chartWrap"></div>
    </div>
  </div>

  <div class="rpt-split-grid">
    <div class="panel">
      <div class="panel-header">
        <div>
          <h3>Orders by status</h3>
          <p>Where every order in this range ended up.</p>
        </div>
      </div>
      <div class="panel-body" id="statusPanel"></div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <div>
          <h3>Top products</h3>
          <p>Ranked by revenue in the selected range.</p>
        </div>
      </div>
      <div class="panel-body is-flush" id="topProductsPanel"></div>
    </div>
  </div>
`;

renderPills();
document.getElementById("applyCustom").addEventListener("click", applyCustomRange);
document.getElementById("exportBtn").addEventListener("click", exportCsv);

let lastReport = null;
let lastPrev = null;

load();

function icon(path, size = 15) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function renderPills() {
  const wrap = document.getElementById("rangePills");
  wrap.innerHTML = PRESETS.map(
    (p) => `<button type="button" class="range-pill${p.key === state.preset ? " is-active" : ""}" data-preset="${p.key}">${p.label}</button>`
  ).join("");
  wrap.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => selectPreset(btn.dataset.preset));
  });
  document.getElementById("rangeCustom").hidden = state.preset !== "custom";
}

function selectPreset(key) {
  state.preset = key;
  if (key !== "custom") {
    const preset = PRESETS.find((p) => p.key === key);
    const end = new Date();
    const start = new Date(end.getTime() - (preset.days - 1) * MS_DAY);
    state.from = toISO(start);
    state.to = toISO(end);
    document.getElementById("fFrom").value = state.from;
    document.getElementById("fTo").value = state.to;
  }
  renderPills();
  if (key !== "custom") load();
}

function applyCustomRange() {
  const from = document.getElementById("fFrom").value;
  const to = document.getElementById("fTo").value;
  if (!from || !to || from > to) {
    toast("Pick a valid date range.", "error");
    return;
  }
  state.from = from;
  state.to = to;
  load();
}

async function load() {
  setLoading();
  const days = Math.round((fromISO(state.to) - fromISO(state.from)) / MS_DAY) + 1;
  const prevTo = toISO(new Date(fromISO(state.from).getTime() - MS_DAY));
  const prevFrom = toISO(new Date(fromISO(state.from).getTime() - days * MS_DAY));

  try {
    const [current, previous] = await Promise.all([
      api.get(`/seller/reports/sales?from=${state.from}&to=${state.to}`),
      api.get(`/seller/reports/sales?from=${prevFrom}&to=${prevTo}`).catch(() => null),
    ]);
    lastReport = current;
    lastPrev = previous;
    document.getElementById("rangeCaption").textContent =
      `${formatDate(current.range?.from)} – ${formatDate(current.range?.to)} · ${days} day${days === 1 ? "" : "s"}`;
    renderHero(current, previous);
    renderKpis(current, previous);
    renderTrend(current.daily || []);
    renderStatus(current.by_status || {}, current.total_orders || 0);
    renderTopProducts(current.top_products || []);
  } catch (err) {
    toast(err.message || "Failed to load your report.", "error");
    setError();
  }
}

function setLoading() {
  document.getElementById("heroValue").textContent = "—";
  document.getElementById("kpiGrid").innerHTML = skeletonCards(4);
  document.getElementById("chartWrap").innerHTML = `<div class="empty-state">Loading trend…</div>`;
  document.getElementById("statusPanel").innerHTML = `<div class="empty-state">Loading…</div>`;
  document.getElementById("topProductsPanel").innerHTML = `<div class="empty-state">Loading…</div>`;
}

function setError() {
  document.getElementById("chartWrap").innerHTML = `<div class="empty-state">Couldn't load this report. Try again.</div>`;
}

function skeletonCards(n) {
  return Array.from({ length: n }, () => `
    <div class="stat-card">
      <div class="stat-label"><span class="skel-bar" style="width:60%;"></span></div>
      <div class="stat-value"><span class="skel-bar" style="width:45%; height:22px;"></span></div>
      <div class="stat-sub"><span class="skel-bar" style="width:70%;"></span></div>
    </div>
  `).join("");
}

/* ---------------- Deltas ---------------- */

function pctDelta(curr, prev) {
  if (prev == null || !isFinite(prev) || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

/** Returns the inner markup + modifier class for a delta chip, or null if
 * there's no meaningful comparison to make (e.g. previous period was zero). */
function computeDelta(curr, prev, { positiveIsGood = true } = {}) {
  const pct = pctDelta(curr, prev);
  if (pct === null) return null;
  const isUp = pct > 0.05;
  const isDown = pct < -0.05;
  const good = isUp ? positiveIsGood : isDown ? !positiveIsGood : null;
  const cls = good === null ? "is-flat" : good ? "is-up" : "is-down";
  const arrow = isUp ? "▲" : isDown ? "▼" : "•";
  return { cls, inner: `${arrow} ${Math.abs(pct).toFixed(1)}%` };
}

/** Small inline chip for the KPI cards — just the arrow + percentage. */
function deltaHtml(curr, prev, opts) {
  const d = computeDelta(curr, prev, opts);
  if (!d) return "";
  return `<span class="rpt-delta-inline ${d.cls}">${d.inner} <span class="text-muted">vs prior period</span></span>`;
}

// Compact version for the money-flow strip, where four steps share one
// row — "vs prior period" on every step would be louder than the numbers
// themselves, so only the delta figure shows; the range picker above
// already establishes what it's being compared against.
function deltaHtmlShort(curr, prev, opts) {
  const d = computeDelta(curr, prev, opts);
  if (!d) return "";
  return `<span class="rpt-delta-inline ${d.cls}">${d.inner}</span>`;
}

/* ---------------- Hero ---------------- */

function renderHero(data, prev) {
  document.getElementById("heroValue").textContent = money(data.net_earnings);
  const deltaEl = document.getElementById("heroDelta");
  const delta = prev ? computeDelta(data.net_earnings, prev.net_earnings) : null;
  if (delta) {
    deltaEl.className = `rpt-delta ${delta.cls}`;
    deltaEl.innerHTML = `${delta.inner} <span class="rpt-delta-sub">vs prior period</span>`;
    deltaEl.hidden = false;
  } else {
    deltaEl.hidden = true;
  }
  document.getElementById("heroSub").textContent =
    `${money(data.total_collected)} collected − ${money(data.commission_owed)} commission (${((data.commission_rate || 0) * 100).toFixed(0)}%)`;

  renderSparkline(document.getElementById("heroSpark"), (data.daily || []).map((d) => d.sales));
}

function renderSparkline(svg, values) {
  if (!svg) return;
  if (!values.length || values.every((v) => v === 0)) {
    svg.innerHTML = "";
    return;
  }
  const W = 300, H = 56, PAD = 4;
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const n = values.length;
  const pt = (i, v) => {
    const x = n === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (n - 1);
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return [x, y];
  };
  const pts = values.map((v, i) => pt(i, v));
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  svg.innerHTML = `
    <path d="${area}" fill="rgba(234,122,65,0.18)" stroke="none"></path>
    <path d="${line}" fill="none" stroke="var(--accent-bright)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
  `;
}

/* ---------------- money flow ----------------
   "Total sales", "total collected", "commission owed" and "net earnings"
   aren't four independent facts — they're one chain (placed -> collected
   -> minus commission -> net), so they're rendered as a single connected
   strip instead of four same-weight cards that made you re-derive the
   relationship yourself. "Total orders" isn't part of that money chain,
   so it moves to a small label above the strip instead of taking a
   whole card. */

function renderKpis(data, prev) {
  document.getElementById("flowOrders").textContent =
    `${data.total_orders ?? 0} order${(data.total_orders ?? 0) === 1 ? "" : "s"}`;

  const steps = [
    {
      label: "Placed",
      value: money(data.total_sales),
      delta: prev ? deltaHtmlShort(data.total_sales, prev.total_sales) : "",
      cls: "",
    },
    {
      label: "Collected",
      value: money(data.total_collected),
      delta: prev ? deltaHtmlShort(data.total_collected, prev.total_collected) : "",
      cls: "is-good",
      op: "arrow",
    },
    {
      label: "Commission",
      value: `−${money(data.commission_owed)}`,
      delta: prev ? deltaHtmlShort(data.commission_owed, prev.commission_owed, { positiveIsGood: false }) : "",
      cls: "is-warm",
      op: "minus",
    },
    {
      label: "Net earnings",
      value: money(data.net_earnings),
      delta: prev ? deltaHtmlShort(data.net_earnings, prev.net_earnings) : "",
      cls: "is-signal",
      op: "equals",
    },
  ];

  document.getElementById("rptFlow").innerHTML = steps.map((s) => `
    ${s.op ? `<span class="rpt-flow-op" aria-hidden="true">${s.op === "arrow" ? "&rarr;" : s.op === "minus" ? "&minus;" : "="}</span>` : ""}
    <div class="rpt-flow-step ${s.cls}">
      <div class="rpt-flow-label">${escapeHtml(s.label)}</div>
      <div class="rpt-flow-value">${s.value}</div>
      <div class="rpt-flow-delta">${s.delta || "&nbsp;"}</div>
    </div>
  `).join("");
}

/* ---------------- Trend chart ---------------- */

function renderTrend(daily) {
  const wrap = document.getElementById("chartWrap");
  const sub = document.getElementById("trendSub");

  if (!daily.length || daily.every((d) => d.sales === 0 && d.collected === 0)) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-title">No sales in this range</div>Nothing was placed between these dates.</div>`;
    return;
  }

  if (daily.length < 2) {
    sub.textContent = "Pick a wider range to see a day-by-day trend.";
    const d = daily[0];
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="empty-title">${escapeHtml(formatDayLabel(d.date))}</div>
        ${money(d.sales)} in sales · ${money(d.collected)} collected · ${d.orders} order${d.orders === 1 ? "" : "s"}
      </div>`;
    return;
  }

  sub.textContent = "Daily placed sales vs. cash actually collected.";

  const W = 1000, H = 300, PAD_L = 54, PAD_R = 14, PAD_T = 14, PAD_B = 34;
  const n = daily.length;
  const sales = daily.map((d) => d.sales);
  const collected = daily.map((d) => d.collected);
  const maxVal = Math.max(...sales, ...collected, 1) * 1.12;

  const xAt = (i) => (n === 1 ? (PAD_L + (W - PAD_R)) / 2 : PAD_L + (i * (W - PAD_L - PAD_R)) / (n - 1));
  const yAt = (v) => H - PAD_B - (v / maxVal) * (H - PAD_T - PAD_B);

  const buildLine = (vals) => vals.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  const salesLine = buildLine(sales);
  const salesArea = `${salesLine} L${xAt(n - 1).toFixed(1)},${(H - PAD_B).toFixed(1)} L${xAt(0).toFixed(1)},${(H - PAD_B).toFixed(1)} Z`;
  const collectedLine = buildLine(collected);

  // 4 horizontal gridlines + y-axis labels
  const gridCount = 4;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, i) => {
    const v = (maxVal / gridCount) * i;
    const y = yAt(v);
    // Skip the baseline's own label — the chart floor already reads as
    // zero, and the label would otherwise crowd the first x-axis tick.
    const label = i === 0 ? "" : `<text x="${PAD_L - 8}" y="${(y + 3).toFixed(1)}" class="chart-axis-y" text-anchor="end">${compactMoney(v)}</text>`;
    return `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" class="chart-grid"></line>${label}`;
  }).join("");

  // Sparse x-axis date labels (~6 ticks max)
  const tickEvery = Math.max(1, Math.ceil(n / 6));
  const xLabels = daily.map((d, i) => {
    if (i % tickEvery !== 0 && i !== n - 1) return "";
    return `<text x="${xAt(i).toFixed(1)}" y="${H - 10}" class="chart-axis-x" text-anchor="middle">${shortDate(d.date)}</text>`;
  }).join("");

  wrap.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${gridLines}
      <path d="${salesArea}" class="chart-area"></path>
      <path d="${salesLine}" class="chart-line chart-line-sales"></path>
      <path d="${collectedLine}" class="chart-line chart-line-collected"></path>
      ${xLabels}
      <line class="chart-crosshair" id="crosshair" x1="0" y1="${PAD_T}" x2="0" y2="${H - PAD_B}" hidden></line>
      <circle class="chart-dot chart-dot-sales" id="dotSales" r="4" hidden></circle>
      <circle class="chart-dot chart-dot-collected" id="dotCollected" r="4" hidden></circle>
      <rect class="chart-overlay" x="${PAD_L}" y="0" width="${W - PAD_L - PAD_R}" height="${H}" fill="transparent"></rect>
    </svg>
    <div class="chart-tooltip" id="chartTooltip" hidden></div>
  `;

  const svg = wrap.querySelector(".chart-svg");
  const overlay = wrap.querySelector(".chart-overlay");
  const tooltip = document.getElementById("chartTooltip");
  const crosshair = document.getElementById("crosshair");
  const dotSales = document.getElementById("dotSales");
  const dotCollected = document.getElementById("dotCollected");

  function handleMove(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const relX = clientX - rect.left;
    const scaleX = W / rect.width;
    const vbX = relX * scaleX;
    let idx = Math.round(((vbX - PAD_L) / (W - PAD_L - PAD_R)) * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));

    const px = xAt(idx);
    const pySales = yAt(sales[idx]);
    const pyCollected = yAt(collected[idx]);

    crosshair.setAttribute("x1", px);
    crosshair.setAttribute("x2", px);
    crosshair.hidden = false;
    dotSales.setAttribute("cx", px);
    dotSales.setAttribute("cy", pySales);
    dotSales.hidden = false;
    dotCollected.setAttribute("cx", px);
    dotCollected.setAttribute("cy", pyCollected);
    dotCollected.hidden = false;

    const wrapRect = wrap.getBoundingClientRect();
    const pxScreen = rect.left - wrapRect.left + px / scaleX;
    tooltip.hidden = false;
    tooltip.style.left = `${pxScreen}px`;
    const flip = pxScreen > wrapRect.width - 160;
    tooltip.style.transform = flip ? "translateX(-100%)" : "translateX(0)";
    tooltip.innerHTML = `
      <div class="chart-tooltip-date">${escapeHtml(formatDayLabel(daily[idx].date))}</div>
      <div class="chart-tooltip-row"><i style="background:var(--accent)"></i>Sales <b>${money(sales[idx])}</b></div>
      <div class="chart-tooltip-row"><i style="background:var(--thrive)"></i>Collected <b>${money(collected[idx])}</b></div>
      <div class="chart-tooltip-row chart-tooltip-orders">${daily[idx].orders} order${daily[idx].orders === 1 ? "" : "s"}</div>
    `;
  }

  overlay.addEventListener("mousemove", (e) => handleMove(e.clientX, e.clientY));
  overlay.addEventListener("mouseleave", () => {
    tooltip.hidden = true;
    crosshair.hidden = true;
    dotSales.hidden = true;
    dotCollected.hidden = true;
  });
  overlay.addEventListener("touchmove", (e) => {
    if (e.touches[0]) handleMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
}

function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// formatDate() from lib/ui.js parses date-only strings ("2026-08-01") as UTC
// midnight, which can render as the previous day in negative-UTC timezones.
// The chart deals exclusively in date-only strings, so it uses this
// timezone-safe variant instead for anything shown inside the chart itself.
function formatDayLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function compactMoney(v) {
  if (v >= 1000) return "₱" + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k";
  return "₱" + Math.round(v);
}

/* ---------------- Status split ---------------- */

function renderStatus(byStatus, total) {
  const panel = document.getElementById("statusPanel");
  const order = ["to_ship", "in_transit", "out_for_delivery", "delivered", "cancelled"];
  const entries = order
    .map((key) => [key, byStatus[key] || 0])
    .filter(([, count]) => count > 0);

  if (!total || !entries.length) {
    panel.innerHTML = `<div class="empty-state">No orders in this range.</div>`;
    return;
  }

  const segments = entries.map(([key, count]) => {
    const pct = (count / total) * 100;
    return `<span class="status-seg" style="width:${pct.toFixed(2)}%; background:var(${STATUS_VAR[key] || "--slate"})" title="${STATUS_LABEL[key]}: ${count}"></span>`;
  }).join("");

  const rows = entries.map(([key, count]) => {
    const pct = (count / total) * 100;
    return `
      <div class="status-row">
        <span class="status-row-dot" style="background:var(${STATUS_VAR[key] || "--slate"})"></span>
        <span class="status-name">${escapeHtml(STATUS_LABEL[key] || key)}</span>
        <span class="status-count">${count}</span>
        <span class="status-pct">${pct.toFixed(0)}%</span>
      </div>`;
  }).join("");

  panel.innerHTML = `
    <div class="status-bar">${segments}</div>
    <div class="status-rows">${rows}</div>
  `;
}

/* ---------------- Top products leaderboard ---------------- */

function renderTopProducts(items) {
  const panel = document.getElementById("topProductsPanel");
  if (!items.length) {
    panel.innerHTML = `<div class="empty-state"><div class="empty-title">No product sales yet</div>Top sellers for this range will show up here.</div>`;
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

/* ---------------- CSV export ---------------- */

function exportCsv() {
  if (!lastReport) {
    toast("Nothing to export yet.", "error");
    return;
  }
  const lines = [];
  lines.push("ShopUno Seller Sales Report");
  lines.push(`Range,${lastReport.range?.from},${lastReport.range?.to}`);
  lines.push("");
  lines.push("Summary");
  lines.push("Metric,Value");
  lines.push(`Total orders,${lastReport.total_orders ?? 0}`);
  lines.push(`Total sales (placed),${lastReport.total_sales ?? 0}`);
  lines.push(`Total collected,${lastReport.total_collected ?? 0}`);
  lines.push(`Commission rate,${((lastReport.commission_rate || 0) * 100).toFixed(0)}%`);
  lines.push(`Commission owed,${lastReport.commission_owed ?? 0}`);
  lines.push(`Net earnings,${lastReport.net_earnings ?? 0}`);
  lines.push("");
  lines.push("Daily breakdown");
  lines.push("Date,Orders,Sales,Collected");
  (lastReport.daily || []).forEach((d) => {
    lines.push(`${d.date},${d.orders},${d.sales},${d.collected}`);
  });
  lines.push("");
  lines.push("Top products");
  lines.push("Product,Qty sold,Revenue");
  (lastReport.top_products || []).forEach((p) => {
    lines.push(`"${String(p.product_name || "").replace(/"/g, '""')}",${p.qty_sold},${p.revenue}`);
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shopuno-sales-report_${lastReport.range?.from}_to_${lastReport.range?.to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
