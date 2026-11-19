// Sign-up and sign-in: inline field errors, a linked error summary, and the safe return address.
import { $, $$, OUTAGE, api, forgetSession, rememberSession, start, token } from "./common.js";
import { announce } from "./dialog.js";
import { returnAddress } from "./redirect.js";

start();

const form = $("[data-account-form]");
const mode = form.dataset.accountForm;
const region = $("[data-account-region]");
const submit = $("button[type='submit']", form);
const redirect = new URLSearchParams(window.location.search).get("redirect");

/* A live session never sees the account forms: the return address replaces this page. A dead one is forgotten. */
if (token()) {
  const current = await api("/api/me");
  if (current.status === 200) window.location.replace(returnAddress(redirect));
  else if (current.status === 401) forgetSession();
}
const FIELD_COPY = mode === "signup"
  ? { email: "Enter a valid email", display_name: "Display name must be 1 to 40 characters", password: "Password must be 8 to 128 characters" }
  : { email: "Enter your email", password: "Enter your password" };
const SERVER_COPY = new Set(["Enter a valid email", "Display name must be 1 to 40 characters",
  "Display name cannot contain control or direction characters", "Password must be 8 to 128 characters"]);
const LABELS = { email: "Email", display_name: "Display name", password: "Password" };

if (redirect !== null) {
  const link = $("[data-cross-link]");
  link.href = `${link.pathname}?redirect=${encodeURIComponent(redirect)}`;
}

function clearErrors() {
  $$("[data-error-for]", form).forEach((el) => { el.textContent = ""; });
  $$("input", form).forEach((input) => input.removeAttribute("aria-invalid"));
}

function showFieldErrors(fields) {
  const summary = document.createElement("ul");
  for (const [key, message] of Object.entries(fields)) {
    const input = form.elements[key];
    $(`[data-error-for="${key}"]`, form).textContent = message;
    input.setAttribute("aria-invalid", "true");
    const link = document.createElement("a");
    link.href = `#${input.id}`;
    link.textContent = `${LABELS[key]}: ${message}`;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      input.focus();
    });
    const li = document.createElement("li");
    li.append(link);
    summary.append(li);
  }
  announce(region, "", "error");
  region.append("Fix the highlighted fields:", summary);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearErrors();
  submit.disabled = true;
  announce(region, mode === "signup" ? "Creating account…" : "Signing in…");
  const body = Object.fromEntries($$("input", form).map((input) => [input.name, input.value]));
  const result = await api(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", { method: "POST", body });
  submit.disabled = false;
  const error = result.data?.error;
  if (result.status === 200 || result.status === 201) {
    rememberSession(result.data.token);
    window.location.assign(returnAddress(redirect));
  } else if (error === "validation") {
    showFieldErrors(Object.fromEntries(Object.keys(result.data.fields).map((key) => [
      key, SERVER_COPY.has(result.data.fields[key]) ? result.data.fields[key] : FIELD_COPY[key]])));
  } else if (error === "email_taken") {
    showFieldErrors({ email: "An account with this email already exists" });
  } else if (error === "invalid_credentials") {
    announce(region, "Email or password is incorrect.", "error");
  } else if (error === "too_many_attempts") {
    announce(region, "Too many sign-in attempts. Try again later.", "error");
  } else {
    announce(region, OUTAGE, "outage");
  }
});
