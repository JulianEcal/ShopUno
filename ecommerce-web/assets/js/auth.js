import { api, setToken, clearToken, getToken, getStoredUser, setStoredUser } from "./api.js";

// Shared sign-in for all 4 roles (buyer/seller/courier/admin) — login.html's
// login.js picks the right redirect based on the returned user.role. There's
// no separate admin-only login screen, so this must NOT reject non-admin
// accounts.
export async function login(email, password) {
  const data = await api.post("/login", { email, password });
  setToken(data.token);
  setStoredUser(data.user);
  return data.user;
}

// The backend has no single generic /register route — it splits registration
// by role: POST /register/buyer, /register/seller, /register/courier. This
// wizard only ever creates buyers ("every account starts as a Buyer"), so it
// always posts to /register/buyer.
//
// `formData` must be a FormData instance, not a plain object: the backend
// requires `upload_id` as a real uploaded file (multipart), not a base64
// string in JSON. See assets/js/pages/signup-wizard.js for how it's built.
// New accounts come back with status "pending" — they can't log in until an
// admin approves them from Registrations, so there is no token/user to store
// yet in the normal case.
export async function register(formData) {
  const data = await api.post("/register/buyer", formData);
  if (data?.token) setToken(data.token);
  if (data?.user) setStoredUser(data.user);
  return data?.user || null;
}

export function isLoggedIn() {
  return Boolean(getToken());
}

export function getUser() {
  return getStoredUser();
}

export async function logout() {
  try {
    await api.post("/logout");
  } finally {
    clearToken();
    location.href = "/login.html";
  }
}

export function requireAuth() {
  if (!getToken()) {
    location.href = "/login.html";
  }
}