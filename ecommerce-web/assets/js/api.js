import { API_BASE_URL } from "./config.js";

const TOKEN_KEY = "admin_token";
const USER_KEY = "admin_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
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
      location.href = "/login.html";
    }
    throw new ApiError("Session expired. Please log in again.", 401, null);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    throw new ApiError(data?.message || "Something went wrong.", response.status, data?.errors || null);
  }

  return data;
}

export class ApiError extends Error {
  constructor(message, status, fieldErrors) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  delete: (path) => request(path, { method: "DELETE" }),
};