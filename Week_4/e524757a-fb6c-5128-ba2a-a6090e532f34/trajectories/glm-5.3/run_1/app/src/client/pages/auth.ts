// Sign-up, sign-in and confirm pages.

import { el, announce, ensureStatusRegion, api, ApiCallError, param } from "../ui/core";

export function mountAuth(page: string): void {
  ensureStatusRegion("Account status");
  const main = document.getElementById("main");
  if (!main) return;
  main.innerHTML = "";
  const wrap = el("div", { class: "auth-page" });
  const form = el("form", { class: "auth-form", novalidate: "true" });

  if (page === "signup") {
    wrap.append(el("h1", {}, "Create your account"));
    const name = el("input", { type: "text", id: "name", "aria-label": "Name", autocomplete: "name" });
    const email = el("input", { type: "email", id: "email", "aria-label": "Email", autocomplete: "email" });
    const password = el("input", { type: "password", id: "password", "aria-label": "Password", autocomplete: "new-password" });
    const submit = el("button", { class: "action", type: "submit", text: "Create account" });
    form.append(name, email, password, submit);
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      clearInvalid([name, email, password]);
      try {
        await api("POST", "/api/signup", { name: name.value, email: email.value, password: password.value });
        location.href = "/confirm";
      } catch (err) {
        handleAuthError(err, { bad_name: name, bad_email: email, bad_password: password, email_taken: email });
      }
    });
  } else if (page === "signin") {
    wrap.append(el("h1", {}, "Sign in"));
    const email = el("input", { type: "email", id: "email", "aria-label": "Email", autocomplete: "email" });
    const password = el("input", { type: "password", id: "password", "aria-label": "Password", autocomplete: "current-password" });
    const submit = el("button", { class: "action", type: "submit", text: "Sign in" });
    form.append(email, password, submit);
    const links = el("div", { class: "auth-links" });
    links.append(el("a", { href: "/signup", text: "Create an account" }));
    form.append(links);
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      clearInvalid([email, password]);
      try {
        await api("POST", "/api/session", { email: email.value, password: password.value });
        const next = param("next");
        location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/play";
      } catch (err) {
        handleAuthError(err, { bad_credentials: email });
      }
    });
  } else {
    wrap.append(el("h1", {}, "Confirm your email"));
    const code = el("input", { type: "text", id: "code", "aria-label": "Confirmation code", autocomplete: "one-time-code", maxlength: "6" });
    const submit = el("button", { class: "action", type: "submit", text: "Confirm" });
    form.append(code, submit);
    const resend = el("button", { type: "button", id: "resend", text: "Send a new code" });
    resend.addEventListener("click", async () => {
      try {
        await api("POST", "/api/confirm/resend", {});
        announce("Account status", "New code sent.");
      } catch {
        announce("Account status", "Couldn't send the code. Press Send a new code to try again.");
      }
    });
    form.append(resend, el("a", { href: "/play", text: "Later" }));
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      try {
        await api("POST", "/api/confirm", { code: code.value });
        announce("Account status", "Email confirmed.");
        location.href = "/play";
      } catch (err) {
        handleAuthError(err, { bad_code: code, code_expired: code });
      }
    });
  }

  wrap.append(form);
  main.append(wrap);
  (wrap.querySelector("input") as HTMLInputElement | null)?.focus();
}

function clearInvalid(inputs: HTMLInputElement[]): void {
  for (const i of inputs) i.removeAttribute("aria-invalid");
}

function handleAuthError(err: unknown, fieldMap: Record<string, HTMLInputElement>): void {
  if (!(err instanceof ApiCallError)) return;
  announce("Account status", err.message);
  const field = fieldMap[err.code];
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
  }
}
