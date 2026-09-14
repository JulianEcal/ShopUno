import { api, setToken, clearToken, getToken, getStoredUser, setStoredUser } from "./api.js";

// Shared sign-in for all 4 roles (buyer/seller/courier/admin) — login.html's
// login.js picks the right redirect based on the returned user.role. There's
// no separate admin-only login screen, so this must NOT reject non-admin
// accounts.
export async function login(email, password) {
  const data = await api.post("/login", { email, password });
  setToken(data.token);
  setStoredUser(data.user);
  // Dual-access accounts (buyer+seller) haven't picked a side yet right
  // after login — login.js shows the picker and calls setActiveView()
  // once they do. Single-role accounts have nothing to pick, so their
  // view is just their role.
  if (!data.user.dual_access) setActiveView(data.user.role);
  return data.user;
}

// Which side of a dual-access (buyer+seller) account is currently "in use".
// Only meaningful when user.dual_access is true — everyone else's view is
// just their role. Stored separately from the user object so switching
// views never has to touch the token or re-fetch /me.
const ACTIVE_VIEW_KEY = "active_view";

export function getActiveView() {
  return localStorage.getItem(ACTIVE_VIEW_KEY);
}

export function setActiveView(view) {
  localStorage.setItem(ACTIVE_VIEW_KEY, view);
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
    // location.href is a navigation *request*, not an immediate stop — the
    // rest of the calling module (initShell building the page around a user
    // that doesn't exist) would otherwise keep running for the instant
    // before the browser actually navigates away. Throwing halts it here.
    throw new Error("Not authenticated");
  }
  startInactivityWatcher();
}

/* ---------------- inactivity timeout ----------------
   Complements the backend's fixed 60-minute token lifetime (see
   config/sanctum.php's 'expiration') with a second, independent trigger:
   signing out after 60 minutes of no clicks/typing/scrolling at all, even
   if that's well before the token's own hard cutoff. Whichever limit is
   hit first ends the session — this one covers "walked away from an
   open tab", the token expiration covers "left it open and came back
   after a day".

   Every protected page calls requireAuth() through its shell's initShell(),
   so hooking the watcher in there (rather than requiring every page to
   remember to set it up itself) means it's on everywhere a session
   actually exists, and nowhere else. The `started` guard just protects
   against double-registering listeners if requireAuth() were ever called
   more than once on the same page. */
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour — matches the backend's token lifetime
const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart"];
let inactivityTimer = null;
let watcherStarted = false;

function startInactivityWatcher() {
  if (watcherStarted) return;
  watcherStarted = true;

  const resetTimer = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      sessionStorage.setItem("logout_reason", "You were signed out after an hour of inactivity.");
      logout();
    }, INACTIVITY_TIMEOUT_MS);
  };

  ACTIVITY_EVENTS.forEach((evt) => document.addEventListener(evt, resetTimer, { passive: true }));
  resetTimer();
}