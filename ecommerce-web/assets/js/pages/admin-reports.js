// assets/js/pages/admin-reports.js
import { api } from "../api.js";
import { initShell } from "../partials/admin-shell.js";
import { escapeHtml, formatDate, money, toast } from "../lib/ui.js";

const content = initShell({ page: "reports", title: "Reports", eyebrow: "Platform" });

const today = new Date();
const thirtyDaysAgo = new Date(Date.now() - 29 * 86400000);
const toISODate = (d) => d.toISOString().slice(0, 10);

content.innerHTML = `
  <div class="panel">
    <div class="panel-header">
      <div>
        <h3>Sales &amp; commission</h3>
        <p>Defaults to the last 30 days. All figures are cash-on-delivery aware — placed vs. collected.</p>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-sm btn-primary" id="tabSales">Sales</button>
        <button class="btn btn-sm btn-outline" id="tabCommission">Commission</button>
      </div>
    </div>
    <div class="filter-bar">
      <label for="fFrom">From</label>
      <input type="date" id="fFrom" value="${toISODate(thirtyDaysAgo)}">
      <label for="fTo">To</label>
      <input type="date" id="fTo" value="${toISODate(today)}">
      <button class="btn btn-sm btn-outline" id="applyRange">Apply</button>
    </div>
    <div class="panel-body">
      <div class="stat-grid" id="summaryGrid" style="margin-bottom:0;"></div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-header">
      <div>
        <h3 id="tableTitle">Sales by seller</h3>
        <p id="tableSub">Order counts and revenue per seller for the selected range.</p>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data-table" id="sellerTable">
        <thead id="sellerThead"></thead>
        <tbody id="sellerTbody">
          <tr><td colspan="4" class="table-loading">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  </div>
`;

const state = { mode: "sales", from: toISODate(thirtyDaysAgo), to: toISODate(today) };

document.getElementById("tabSales").addEventListener("click", () => switchMode("sales"));
document.getElementById("tabCommission").addEventListener("click", () => switchMode("commission"));
document.getElementById("applyRange").addEventListener("click", () => {
  state.from = document.getElementById("fFrom").value || state.from;
  state.to = document.getElementById("fTo").value || state.to;
  load();
});

function switchMode(mode) {
  state.mode = mode;
  document.getElementById("tabSales").className = `btn btn-sm ${mode === "sales" ? "btn-primary" : "btn-outline"}`;
  document.getElementById("tabCommission").className = `btn btn-sm ${mode === "commission" ? "btn-primary" : "btn-outline"}`;
  document.getElementById("tableTitle").textContent = mode === "sales" ? "Sales by seller" : "Commission by seller";
  document.getElementById("tableSub").textContent = mode === "sales"
    ? "Order counts and revenue per seller for the selected range."
    : "Platform commission owed per seller for the selected range.";
  load();
}

load();

async function load() {
  const tbody = document.getElementById("sellerTbody");
  tbody.innerHTML = `<tr><td colspan="4" class="table-loading">Loading…</td></tr>`;

  const params = new URLSearchParams({ from: state.from, to: state.to });
  const endpoint = state.mode === "sales" ? "/admin/reports/sales" : "/admin/reports/commission";

  try {
    const data = await api.get(`${endpoint}?${params.toString()}`);
    renderSummary(data);
    renderSellerTable(data.by_seller || []);
  } catch (err) {
    toast(err.message || "Failed to load report.", "error");
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">Couldn't load this report.</td></tr>`;
  }
}

function renderSummary(data) {
  const grid = document.getElementById("summaryGrid");
  if (state.mode === "sales") {
    grid.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Total orders</div>
        <div class="stat-value">${data.total_orders ?? 0}</div>
        <div class="stat-breakdown"><span>${formatDate(data.range?.from)} – ${formatDate(data.range?.to)}</span></div>
      </div>
      <div class="stat-card is-good">
        <div class="stat-label">Total sales (placed)</div>
        <div class="stat-value" style="font-size:26px;">${money(data.total_sales)}</div>
        <div class="stat-breakdown"><span>All billable orders</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total collected</div>
        <div class="stat-value" style="font-size:26px;">${money(data.total_collected)}</div>
        <div class="stat-breakdown"><span>Cash in hand — delivered &amp; paid</span></div>
      </div>
    `;
  } else {
    grid.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Commission rate</div>
        <div class="stat-value">${((data.commission_rate || 0) * 100).toFixed(0)}%</div>
        <div class="stat-breakdown"><span>${formatDate(data.range?.from)} – ${formatDate(data.range?.to)}</span></div>
      </div>
      <div class="stat-card is-good">
        <div class="stat-label">Total commission (placed)</div>
        <div class="stat-value" style="font-size:26px;">${money(data.total_commission)}</div>
        <div class="stat-breakdown"><span>On ${money(data.total_sales)} in sales</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Commission collected</div>
        <div class="stat-value" style="font-size:26px;">${money(data.total_commission_collected)}</div>
        <div class="stat-breakdown"><span>On orders delivered &amp; paid</span></div>
      </div>
    `;
  }
}

function renderSellerTable(rows) {
  const thead = document.getElementById("sellerThead");
  const tbody = document.getElementById("sellerTbody");

  if (state.mode === "sales") {
    thead.innerHTML = `<tr><th>Seller</th><th>Orders</th><th>Total sales</th></tr>`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="table-empty">No orders in this range.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((r) => `
        <tr>
          <td class="cell-name">${escapeHtml(r.business_name)}</td>
          <td>${r.order_count}</td>
          <td class="mono">${money(r.total_sales)}</td>
        </tr>`)
      .join("");
  } else {
    thead.innerHTML = `<tr><th>Seller</th><th>Orders</th><th>Total sales</th><th>Commission</th></tr>`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="table-empty">No orders in this range.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((r) => `
        <tr>
          <td class="cell-name">${escapeHtml(r.business_name)}</td>
          <td>${r.order_count}</td>
          <td class="mono">${money(r.total_sales)}</td>
          <td class="mono">${money(r.commission_amount)}</td>
        </tr>`)
      .join("");
  }
}
