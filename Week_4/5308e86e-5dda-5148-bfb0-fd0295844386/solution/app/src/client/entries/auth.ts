/** Log in and sign up forms. A signed-in visitor is sent on to the cockpit. */
import { landingAfterSignIn, storedToken, storeSession, clearStored } from "../shared/session.js";
import { announce } from "../shared/announce.js";
import { COPY } from "../shared/copy.js";
import { DEFAULT_LANDING } from "../../shared/redirect.js";

type Kind = "login" | "signup";

const LABELS: Record<Kind, { idle: string; pending: string }> = {
  login: { idle: "Log in", pending: "Logging in…" },
  signup: { idle: "Open account", pending: "Opening account…" },
};

const LOGIN_FAILED = "Email or password is incorrect.";
const LOGIN_LOCKED = "Too many attempts. Try again later.";
const EMAIL_TAKEN = "An account with this email already exists";

function inputFor(form: HTMLFormElement, name: string): HTMLInputElement {
  const input = form.querySelector<HTMLInputElement>(`[data-field="${name}"]`);
  if (!input) throw new Error(`missing ${name}`);
  return input;
}

function setError(form: HTMLFormElement, name: string, message: string): void {
  const input = inputFor(form, name);
  const holder = form.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
  if (holder) holder.textContent = message;
  if (message === "") {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  } else {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", holder?.id ?? "");
  }
}

function setFormError(form: HTMLFormElement, message: string): void {
  const holder = form.querySelector<HTMLElement>("[data-form-error]");
  if (holder) holder.textContent = message;
}

async function leaveIfSignedIn(kind: Kind): Promise<void> {
  const token = storedToken();
  if (!token) return;
  try {
    const response = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (response.ok) location.replace(kind === "login" ? landingAfterSignIn() : DEFAULT_LANDING);
    else if (response.status === 401) clearStored();
  } catch {
    // The form stays; the visitor can still sign in.
  }
}

function mount(form: HTMLFormElement, kind: Kind): void {
  const button = form.querySelector<HTMLButtonElement>("[data-submit]");
  if (!button) return;
  const preset = new URLSearchParams(location.search).get("email");
  if (kind === "signup" && preset) inputFor(form, "email").value = preset;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const fields = kind === "login" ? ["email", "password"] : ["name", "email", "password"];
    for (const name of fields) setError(form, name, "");
    setFormError(form, "");
    button.disabled = true;
    button.textContent = LABELS[kind].pending;
    try {
      const body: Record<string, string> = {};
      for (const name of fields) body[name] = inputFor(form, name).value;
      const response = await fetch(kind === "login" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const data = response.status === 204 ? null : await response.json().catch(() => null);
      if (response.status === 200 || response.status === 201) {
        storeSession(data.token);
        location.replace(kind === "login" ? landingAfterSignIn() : DEFAULT_LANDING);
        return;
      }
      if (response.status === 503) {
        setFormError(form, COPY.outage);
        announce(COPY.outage);
      } else if (kind === "login") {
        const message = response.status === 429 ? LOGIN_LOCKED : LOGIN_FAILED;
        setFormError(form, message);
        announce(message);
      } else if (response.status === 409) {
        setError(form, "email", EMAIL_TAKEN);
        announce(EMAIL_TAKEN);
        inputFor(form, "email").focus();
      } else if (data?.error === "validation") {
        for (const [name, message] of Object.entries<string>(data.fields)) if (fields.includes(name)) setError(form, name, message);
        const first = fields.find((name) => data.fields[name]);
        if (first) inputFor(form, first).focus();
      } else {
        setFormError(form, COPY.serverError);
        announce(COPY.serverError);
      }
    } catch {
      setFormError(form, COPY.outage);
      announce(COPY.outage);
    } finally {
      button.disabled = false;
      button.textContent = LABELS[kind].idle;
    }
  });
}

const form = document.querySelector<HTMLFormElement>("[data-auth-form]");
if (form) {
  const kind = form.dataset.authForm === "signup" ? "signup" : "login";
  mount(form, kind);
  void leaveIfSignedIn(kind);
}
