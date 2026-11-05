// Sign in (DP-44, DP-66).
import { api, ApiError } from "../api.js";
import { h } from "../ui/dom.js";
import { navigate } from "../router.js";
import { landingPath, roleHome, type SessionUser } from "../state.js";

export async function renderSignIn(root: HTMLElement, next: string | null): Promise<void> {
  while (root.firstChild) root.removeChild(root.firstChild);
  const wrap = h("div", { class: "signin-wrap" });
  const card = h("div", { class: "signin-card" });
  card.appendChild(h("h1", { text: "Keel & Bell rentals" }));
  const status = h("div", { class: "status-text", role: "status", "aria-live": "polite", "data-status-name": "Sign-in status" });

  const email = h("input", { type: "email", class: "input", "aria-label": "Email", autocomplete: "username" });
  const emailField = h("label", { class: "field" }, h("span", { class: "field-label", text: "Email" }), email);
  const password = h("input", { type: "password", class: "input", "aria-label": "Password", autocomplete: "current-password" });
  const passwordField = h("label", { class: "field" }, h("span", { class: "field-label", text: "Password" }), password);

  const submit = h("button", { class: "btn btn-primary", text: "Sign in", type: "submit" });
  const form = h("form", {
    onsubmit: async (event: Event) => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = "Signing in…";
      try {
        const result = await api<{ user: SessionUser }>("POST", "/api/session", {
          email: email.value,
          password: password.value,
        });
        status.textContent = "";
        const target = landingPath(next, result.user.role, roleHome(result.user));
        navigate(target, true);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          status.textContent = "Email or password is wrong.";
        } else {
          status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
        }
        submit.disabled = false;
        status.setAttribute("tabindex", "-1");
        status.focus({ preventScroll: true });
      }
    },
  });
  form.append(emailField, passwordField, submit);
  card.append(form, status);
  wrap.appendChild(card);
  root.appendChild(wrap);
  email.focus();
}
