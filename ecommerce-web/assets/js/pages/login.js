// assets/js/pages/login.js
// Page-specific logic for the shared sign-in / sign-up screen (login.html).
// Sign-in handles all 4 roles (buyer, seller, courier, admin) and redirects
// based on the `role` field the backend returns. Sign-up is buyer-only —
// every new account starts as a Buyer and applies for Seller/Courier access
// later from inside the app — and is driven by the step wizard in
// signup-wizard.js.

import { login } from "../auth.js";
import { initSignupWizard } from "./signup-wizard.js";

// Where each role lands after a successful login/registration.
const ROLE_REDIRECTS = {
  admin: "admin/dashboard.html",
  seller: "seller/dashboard.html",
  buyer: "buyer/index.html",
  courier: "courier/dashboard.html",
};

const container = document.getElementById("authContainer");

/* ---------------- panel toggle (sign in <-> sign up) ---------------- */
document.querySelectorAll("[data-toggle]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const goTo = btn.dataset.toggle; // "signin" | "signup"
    container.classList.toggle("right-panel-active", goTo === "signup");
  });
});

/* ---------------- show / hide password ---------------- */
document.querySelectorAll(".toggle-password").forEach((btn) => {
  const input = document.getElementById(btn.dataset.target);
  btn.addEventListener("click", () => {
    const willShow = input.type === "password";
    input.type = willShow ? "text" : "password";
    btn.setAttribute("aria-label", willShow ? "Hide password" : "Show password");
    btn.classList.toggle("is-visible", willShow);
  });
});

/* ---------------- shared helpers ---------------- */
function showError(box, message) {
  box.textContent = message;
  box.hidden = false;
}
function clearError(box) {
  box.textContent = "";
  box.hidden = true;
}
function setLoading(btn, isLoading) {
  btn.classList.toggle("is-loading", isLoading);
  btn.disabled = isLoading;
}
function redirectForRole(role, errorBox) {
  const destination = ROLE_REDIRECTS[role];
  if (!destination) {
    showError(errorBox, `Signed in, but no page is set up yet for role "${role}".`);
    return false;
  }
  window.location.href = destination;
  return true;
}

/* ---------------- sign in ---------------- */
const loginForm = document.getElementById("loginForm");
const loginEmail = document.getElementById("email");
const loginPassword = document.getElementById("password");
const loginError = document.getElementById("loginError");
const loginSubmit = document.getElementById("loginSubmit");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError(loginError);

  const email = loginEmail.value.trim();
  const password = loginPassword.value;

  if (!email || !password) {
    showError(loginError, "Please enter both your email and password.");
    return;
  }

  setLoading(loginSubmit, true);
  try {
    const user = await login(email, password);
    if (!redirectForRole(user.role, loginError)) setLoading(loginSubmit, false);
  } catch (err) {
    showError(loginError, err.message || "Login failed. Please check your credentials and try again.");
    setLoading(loginSubmit, false);
  }
});

/* ---------------- sign up (4-step buyer wizard) ---------------- */
initSignupWizard();