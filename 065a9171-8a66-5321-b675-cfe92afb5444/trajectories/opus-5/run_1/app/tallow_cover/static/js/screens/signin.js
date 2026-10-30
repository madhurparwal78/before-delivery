import { OFFLINE, api } from "../api.js";
import { el, say, statusRegion } from "../dom.js";

export function render({ onSignedIn }) {
  const status = statusRegion("Sign-in status");
  const email = el("input", { type: "email", "aria-label": "Email", autocomplete: "username" });
  const password = el("input", {
    type: "password",
    "aria-label": "Password",
    autocomplete: "current-password",
  });
  const submit = el("button", { type: "submit", text: "Sign in" });
  const form = el(
    "form",
    {
      "aria-label": "Sign in",
      onsubmit: async (event) => {
        event.preventDefault();
        submit.disabled = true;
        say(status, "Signing in…");
        try {
          const payload = await api.post("/api/session", {
            email: email.value,
            password: password.value,
          });
          await onSignedIn(payload.user);
        } catch (error) {
          say(status, error.status === 0 ? OFFLINE : error.message);
          submit.disabled = false;
        }
      },
    },
    el("label", {}, "Email", email),
    el("label", {}, "Password", password),
    submit
  );
  return el(
    "section",
    { class: "panel" },
    el("h1", { text: "Sign in to Tallow Cover" }),
    form,
    status
  );
}
