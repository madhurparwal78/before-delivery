// The sign-in screen: one centred card, server-decided states only.

import { api, setCsrfToken, ApiFailure, NetworkFailure } from "./api.js";
import { h } from "./dom.js";
import { safeReturnAddress } from "../shared/return.js";

export async function bootSignIn(signedOutMessage: string): Promise<void> {
  const alertBox = h("div", { role: "alert", "aria-live": "assertive", class: "sign-in-alert" });
  if (signedOutMessage.length > 0) alertBox.textContent = signedOutMessage;
  const email = h("input", { type: "email", "aria-label": "Email", autocomplete: "username" });
  const password = h("input", { type: "password", "aria-label": "Password", autocomplete: "current-password" });
  const signIn = h("button", { type: "submit" }, "Sign in");
  const form = h("form", { class: "sign-in-form", novalidate: true },
    h("div", { class: "wordmark" }, "Quire"),
    h("h1", {}, "Sign in to Quire"),
    h("label", {}, "Email ", email),
    h("label", {}, "Password ", password),
    signIn,
    alertBox
  );
  const main = h("main", { class: "sign-in-main" }, form);
  document.body.append(main);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    // the screen never disables the button and never runs a countdown
    try {
      const res = await api<{ csrf_token: string }>("POST", "/api/auth/sign-in", { email: email.value, password: password.value });
      setCsrfToken(res.csrf_token);
      const raw = new URLSearchParams(location.search).get("return") ?? "";
      const decoded = decodeURIComponent(raw);
      const safe = safeReturnAddress(decoded);
      if (safe !== null) {
        history.replaceState(null, "", safe);
        const { boot } = await import("./app.js");
        await boot();
      } else {
        history.replaceState(null, "", "/today");
        const { boot } = await import("./app.js");
        await boot();
      }
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.status === 429) alertBox.textContent = "Too many sign-in attempts. Wait a while, then try again.";
        else if (err.status === 401) alertBox.textContent = "That email and password don't match.";
        else alertBox.textContent = "That email and password don't match.";
      } else if (err instanceof NetworkFailure) {
        alertBox.textContent = "Not saved. Check your connection and try again.";
      }
    }
  });
  email.focus();
}
