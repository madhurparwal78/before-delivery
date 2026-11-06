// Sign-in screen.
import { api, ApiCallError, el } from "../lib";
import { formField, statusRegion } from "../components";
import type { MeUser } from "../types";

export function renderSignIn(root: HTMLElement, onSignedIn: (user: MeUser) => void): void {
  const email = formField({ name: "email", label: "Email", type: "email" });
  const password = formField({ name: "password", label: "Password", type: "password" });
  const status = statusRegion("Sign-in status");

  const form = el("form", { "aria-label": "Sign in" },
    el("h1", { text: "Sign in" }),
    email.row,
    password.row,
    status.el,
    el("button", { class: "btn btn-primary", type: "submit", text: "Sign in" }),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.set("Signing in…");
    try {
      const res = await api<{ user: MeUser }>("POST", "/api/session", {
        email: (email.input as HTMLInputElement).value.trim(),
        password: password.input.value,
      });
      onSignedIn(res.user);
    } catch (err) {
      status.set(err instanceof ApiCallError && (err.code === "invalid_credentials" || err.code === "unauthenticated")
        ? "Email or password is wrong."
        : "Couldn't reach Teamseat. Try again.");
    }
  });

  const wrap = el("div", { class: "sheet", style: "max-width: 480px; padding-top: 10vh;" }, form);
  root.replaceChildren(wrap);
  email.input.focus();
}
