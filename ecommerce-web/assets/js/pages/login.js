// assets/js/pages/login.js
// Page-specific logic for the shared sign-in / sign-up screen (login.html).
// Sign-in handles all 4 roles (buyer, seller, courier, admin) and redirects
// based on the `role` field the backend returns. Sign-up is buyer-only —
// every new account starts as a Buyer and applies for Seller/Courier access
// later from inside the app — and is driven by the step wizard in
// signup-wizard.js.

import { login, setActiveView, getActiveView } from "../auth.js";
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

// Landed here because a session just ended (inactivity timeout or the
// backend's 1-hour token expiry) rather than because the person chose to
// sign out — see auth.js's inactivity watcher and api.js's 401 handling,
// both of which set this right before redirecting here. sessionStorage
// (not localStorage) so it's naturally gone once this tab's shown it, and
// never leaks into some *other* later visit.
const logoutReason = sessionStorage.getItem("logout_reason");
if (logoutReason) {
  showError(loginError, logoutReason);
  sessionStorage.removeItem("logout_reason");
}

/* ---- dual-access (buyer + seller) picker, shown in place of the form ---- */
const roleChoicePanel = document.getElementById("roleChoicePanel");
const roleChoiceGreeting = document.getElementById("roleChoiceGreeting");
const roleChoiceBuyerBtn = document.getElementById("roleChoiceBuyer");
const roleChoiceSellerBtn = document.getElementById("roleChoiceSeller");
const roleChoiceBackBtn = document.getElementById("roleChoiceBack");
const roleChoiceOptions = [roleChoiceBuyerBtn, roleChoiceSellerBtn];

function showRoleChoice(user) {
  roleChoiceGreeting.textContent = user?.first_name
    ? `Welcome back, ${user.first_name}.`
    : "How do you want to continue?";
  // Surface which view they used last time so returning users don't have
  // to think about it twice — purely informational, doesn't pre-select.
  const lastUsed = getActiveView();
  roleChoicePanel.querySelectorAll("[data-last-used]").forEach((tag) => {
    tag.hidden = tag.dataset.lastUsed !== lastUsed;
  });
  roleChoiceOptions.forEach((option) => {
    option.disabled = false;
    option.classList.remove("is-selecting");
  });
  loginForm.hidden = true;
  roleChoicePanel.hidden = false;
}

function hideRoleChoice() {
  roleChoicePanel.hidden = true;
  loginForm.hidden = false;
  setLoading(loginSubmit, false);
}

function chooseView(role, btn) {
  // Disable both options immediately so a second click (or the other
  // button) can't fire while the redirect is in flight.
  roleChoiceOptions.forEach((option) => { option.disabled = true; });
  btn.classList.add("is-selecting");
  setActiveView(role);
  redirectForRole(role, loginError);
}

roleChoiceBuyerBtn.addEventListener("click", () => chooseView("buyer", roleChoiceBuyerBtn));
roleChoiceSellerBtn.addEventListener("click", () => chooseView("seller", roleChoiceSellerBtn));
// "Back" doesn't log the account out — it's already signed in at this point
// — it just lets them re-check the email/password fields before picking.
roleChoiceBackBtn.addEventListener("click", hideRoleChoice);

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
    if (user.dual_access) {
      showRoleChoice(user);
      return;
    }
    if (!redirectForRole(user.role, loginError)) setLoading(loginSubmit, false);
  } catch (err) {
    showError(loginError, err.message || "Login failed. Please check your credentials and try again.");
    setLoading(loginSubmit, false);
  }
});

/* ---------------- sign up (4-step buyer wizard) ---------------- */
initSignupWizard();