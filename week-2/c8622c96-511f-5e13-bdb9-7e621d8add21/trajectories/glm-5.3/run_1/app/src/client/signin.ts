// Sign-in: a single centred column; the first Tab press lands on the email
// field, and a refused sign-in keeps its value.
import { el, clear } from "./dom.js";
import { api, errorOf } from "./api.js";

export function renderSignIn(root: HTMLElement, onSignedIn: () => void): void {
  clear(root);
  const email = el("input", { class: "field", type: "email", id: "email", autocomplete: "email", placeholder: "Email" }) as HTMLInputElement;
  email.setAttribute("aria-label", "Email");
  const password = el("input", { class: "field", type: "password", id: "password", autocomplete: "current-password", placeholder: "Password" }) as HTMLInputElement;
  password.setAttribute("aria-label", "Password");
  const alertBox = el("div", { id: "signin-alert", class: "alert", role: "alert" });
  const submit = el("button", { class: "btn primary", type: "submit", text: "Sign in" }) as HTMLButtonElement;
  const form = el("form", { class: "signin-form", "aria-label": "Sign in to Saltprint Desk" },
    el("h1", { class: "display", text: "Sign in to Saltprint Desk" }),
    el("label", { class: "label", for: "email", text: "Email" }),
    email,
    el("label", { class: "label", for: "password", text: "Password" }),
    password,
    alertBox,
    submit,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alertBox.textContent = "";
    submit.disabled = true;
    const result = await api.post<{ user: unknown }>("/api/session", { email: email.value, password: password.value });
    submit.disabled = false;
    const err = errorOf(result);
    if (result.status === 200 && !(result.body as { error?: unknown }).error) {
      onSignedIn();
      return;
    }
    if (err) {
      alertBox.textContent = err.message;
    } else if (result.network) {
      alertBox.textContent = "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
    } else {
      alertBox.textContent = "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
    }
  });
  const wrap = el("div", { class: "signin-wrap" }, form);
  root.append(wrap);
  email.focus();
}
