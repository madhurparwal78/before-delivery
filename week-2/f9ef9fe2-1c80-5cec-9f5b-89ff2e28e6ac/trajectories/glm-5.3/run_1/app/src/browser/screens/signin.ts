import { api, ApiError } from "../api";
import { el } from "../ui";
import { navigate, state } from "../main";

export function renderSignIn(container: HTMLElement): void {
  const wrap = el("div", { class: "signin-wrap" });
  const card = el("div", { class: "signin-card" });
  const wordmark = el("div", { class: "wordmark" });
  wordmark.append("Pilotlight");
  const form = el("form", { novalidate: true });

  const emailId = "signin-email";
  const passwordId = "signin-password";
  const emailField = el("div", { class: "field" });
  const emailLabel = el("label", { for: emailId });
  emailLabel.textContent = "Email";
  const emailInput = el("input", { id: emailId, type: "email", name: "email", autocomplete: "username" });
  emailInput.setAttribute("aria-label", "Email");
  emailField.append(emailLabel, emailInput);

  const passwordField = el("div", { class: "field" });
  const passwordLabel = el("label", { for: passwordId });
  passwordLabel.textContent = "Password";
  const passwordInput = el("input", { id: passwordId, type: "password", name: "password", autocomplete: "current-password" });
  passwordInput.setAttribute("aria-label", "Password");
  passwordField.append(passwordLabel, passwordInput);

  const alert = el("div", { class: "alert", role: "alert" });
  const submit = el("button", { class: "btn primary", type: "submit" });
  submit.textContent = "Sign in";
  form.append(emailField, passwordField, alert, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    alert.replaceChildren();
    submit.disabled = true;
    submit.textContent = "Signing in…";
    try {
      const body = await api<{ user: typeof state.user }>("POST", "/session", {
        email: emailInput.value,
        password: passwordInput.value,
      });
      state.user = body.user;
      const kitchenBody = await api<{ kitchen: NonNullable<typeof state.kitchen> }>("GET", `/kitchens/${state.user!.kitchen_id}`);
      state.kitchen = kitchenBody.kitchen;
      navigate(state.user!.role === "bookkeeper" ? "/reports" : "/loom");
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        const errors = error.extra.errors as Record<string, string> | undefined;
        alert.textContent = errors ? Object.values(errors)[0] ?? "Enter your email and password." : "Enter your email and password.";
      } else {
        alert.textContent = "Email or password is incorrect.";
      }
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  });
  card.append(wordmark, form);
  wrap.append(card);
  container.append(wrap);
}
