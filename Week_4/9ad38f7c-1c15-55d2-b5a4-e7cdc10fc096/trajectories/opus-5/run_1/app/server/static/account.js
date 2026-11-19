/* The account pages: sign up, sign in and the safe return address. */

import {
  OUTAGE_COPY,
  announce,
  announceMarkup,
  api,
  applySession,
  escapeText,
  forgetToken,
  keepToken,
  returnAddress,
  startChrome,
  token,
} from "./core.js";

const FIELD_LABELS = {
  email: "Email",
  display_name: "Display name",
  password: "Password",
};

const FIELD_MESSAGES = {
  email: "Enter a valid email",
  display_name: "Display name must be 1 to 40 characters",
  password: "Password must be 8 to 128 characters",
};

const PUBLISHED_MESSAGES = [
  ...Object.values(FIELD_MESSAGES),
  "Display name cannot contain control or direction characters",
];

function messageFor(name, sent) {
  return PUBLISHED_MESSAGES.includes(sent) ? sent : FIELD_MESSAGES[name] || sent;
}

const form = document.querySelector("[data-account-form]");
const signingUp = form.dataset.mode === "signup";

function clearFieldErrors() {
  document
    .querySelectorAll("[data-field-error]")
    .forEach((element) => (element.textContent = ""));
}

function showFieldErrors(fields) {
  const failing = Object.keys(fields);
  failing.forEach((name) => {
    const element = document.querySelector(`[data-field-error="${name}"]`);
    if (element) element.textContent = messageFor(name, fields[name]);
  });
  const links = failing
    .map(
      (name) =>
        `<a href="#${name}-field" data-focus="${name}">${escapeText(
          FIELD_LABELS[name] || name,
        )}</a>`,
    )
    .join(" ");
  announceMarkup("Account messages", `Fix the highlighted fields: ${links}`);
  document.querySelectorAll("[data-focus]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const field = document.querySelector(
        `[data-field="${link.dataset.focus}"]`,
      );
      if (field) field.focus();
    });
  });
}

function values() {
  const body = {
    email: form.querySelector("[data-field=email]").value,
    password: form.querySelector("[data-field=password]").value,
  };
  if (signingUp) {
    body.display_name = form.querySelector("[data-field=display_name]").value;
  }
  return body;
}

async function submit(event) {
  event.preventDefault();
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  clearFieldErrors();
  announce(
    "Account messages",
    signingUp ? "Creating account…" : "Signing in…",
  );
  const { status, data, outage } = await api(
    "POST",
    signingUp ? "/api/auth/signup" : "/api/auth/login",
    values(),
  );
  button.disabled = false;
  if (status === 201 || status === 200) {
    keepToken(data.token);
    applySession(data);
    location.assign(returnAddress());
    return;
  }
  if (outage || status === 0) {
    announce("Account messages", OUTAGE_COPY, "error");
    return;
  }
  if (status === 400 && data && data.fields) {
    showFieldErrors(data.fields);
    return;
  }
  const code = data && data.error;
  if (code === "email_taken") {
    const message = "An account with this email already exists";
    announce("Account messages", message, "error");
    const element = document.querySelector('[data-field-error="email"]');
    if (element) element.textContent = message;
    return;
  }
  if (code === "too_many_attempts") {
    announce(
      "Account messages",
      "Too many sign-in attempts. Try again later.",
      "error",
    );
    return;
  }
  announce("Account messages", "Email or password is incorrect.", "error");
}

async function start() {
  if (token()) {
    const { status } = await api("GET", "/api/me");
    if (status === 200) {
      location.replace(returnAddress());
      return;
    }
    if (status === 401) {
      forgetToken();
      applySession(null);
    }
  }
  await startChrome();
  form.addEventListener("submit", submit);
}

start();
