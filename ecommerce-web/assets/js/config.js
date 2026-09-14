// Auto-detects which environment the page itself is loaded from, so you
// can freely test at http://localhost:5500 (talks straight to your local
// Laravel on :8000 — no Cloudflare involved) or at https://shopuno.shop
// (the tunnel — same domain your groupmates and any outside tester hit)
// without ever hand-editing this file back and forth again.
const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);

export const API_BASE_URL = isLocal
  ? "http://127.0.0.1:8000/api"
  : "https://api.shopuno.shop/api";