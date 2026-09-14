import { API_BASE_URL } from "./config.js";

const TOKEN_KEY = "admin_token";
const USER_KEY = "admin_user";
const ACTIVE_VIEW_KEY = "active_view";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  // Wipe the dual-access buyer/seller view choice too, so the next person
  // to sign in on this browser (or this same account re-logging-in) isn't
  // silently dropped into whatever view the last session left behind.
  localStorage.removeItem(ACTIVE_VIEW_KEY);
}
export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Malformed/stale value (half-finished login, manual edit, old schema).
    // Treat as logged-out rather than crashing every page's initial render.
    localStorage.removeItem(USER_KEY);
    return null;
  }
}
export function setStoredUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

async function request(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // FormData (used for endpoints that upload a real file, e.g. registration's
  // ID upload) must NOT get a manual Content-Type — the browser sets
  // multipart/form-data with the correct boundary itself. Everything else is
  // sent as JSON, same as before.
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  if (!isFormData && body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });

  if (response.status === 401) {
    clearToken();
    if (!location.pathname.endsWith("login.html")) {
      sessionStorage.setItem("logout_reason", "Your session expired after 1 hour. Please log in again.");
      location.href = "/login.html";
    }
    throw new ApiError("Session expired. Please log in again.", 401, null);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    // Laravel's default validation message is a blob like "The base price
    // field is required. (and 1 more error)" — every field-specific
    // message in `errors` is already clean on its own (see the seller
    // FormRequest classes' messages()), so prefer the first one of those
    // over the summary line whenever it's present. Falls back to
    // data.message for non-validation errors (403s, business-rule 422s
    // thrown via ValidationException::withMessages, etc).
    const firstFieldError = data?.errors ? Object.values(data.errors)[0]?.[0] : null;
    throw new ApiError(firstFieldError || data?.message || "Something went wrong.", response.status, data?.errors || null, data);
  }

  return data;
}

// Documents (ID uploads, business permits, etc.) are served from a
// protected route — the same one every other admin request hits — so an
// admin's browser needs to send the same Authorization header to view them.
// A plain <img src="…"> or <a href="…" target="_blank"> can't attach that
// header, which is exactly why those links used to render the raw
// `{"message":"Unauthenticated."}` JSON instead of the file. Fetching the
// file ourselves (with the header) and handing the viewer a blob: URL fixes
// that without needing any change on the backend.
export async function fetchAuthedFile(url) {
  const absolute = /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url}`;
  const token = getToken();
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(absolute, { headers });

  if (response.status === 401) {
    clearToken();
    if (!location.pathname.endsWith("login.html")) {
      sessionStorage.setItem("logout_reason", "Your session expired after 1 hour. Please log in again.");
      location.href = "/login.html";
    }
    throw new ApiError("Session expired. Please log in again.", 401, null);
  }
  if (!response.ok) {
    throw new ApiError("This file couldn't be loaded.", response.status, null);
  }

  const blob = await response.blob();
  return { blob, contentType: response.headers.get("Content-Type") || blob.type || "" };
}

export class ApiError extends Error {
  constructor(message, status, fieldErrors, raw = null) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.raw = raw; // full JSON body, e.g. { retry_after } on a 429
  }
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  delete: (path) => request(path, { method: "DELETE" }),
};