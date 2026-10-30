import { api, el, announce, problemText, ApiProblem } from "../api.js";

export async function renderSignIn(root: HTMLElement): Promise<void> {
  const wrap = el("div", { class: "wrap narrow" });
  wrap.append(el("h1", { class: "section-head", text: "Sign in" }));
  const form = el("form", { class: "form-grid" });
  const email = el("input", { type: "email", "aria-label": "Email", autocomplete: "email" }) as HTMLInputElement;
  const password = el("input", { type: "password", "aria-label": "Password", autocomplete: "current-password" }) as HTMLInputElement;
  const alertNode = el("div", { role: "alert", "aria-label": "Sign-in problem", text: "" });
  const emailLabel = el("label", { text: "Email" });
  emailLabel.append(email);
  const passwordLabel = el("label", { text: "Password" });
  passwordLabel.append(password);
  const submit = el("button", { text: "Sign in" });
  form.append(emailLabel, passwordLabel, submit);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/auth/signin", { method: "POST", body: JSON.stringify({ email: email.value, password: password.value }) });
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next ?? "/tickets";
    } catch (err) {
      if (err instanceof ApiProblem && err.body.error === "invalid_credentials") {
        announce(alertNode, "That email and password don't match.");
      } else {
        announce(alertNode, problemText(err));
      }
    }
  });
  wrap.append(form, alertNode);
  wrap.append(el("a", { href: "/register", text: "Create an account" }));
  root.append(wrap);
}

export async function renderRegister(root: HTMLElement): Promise<void> {
  const wrap = el("div", { class: "wrap narrow" });
  wrap.append(el("h1", { class: "section-head", text: "Create account" }));
  const form = el("form", { class: "form-grid" });
  const name = el("input", { type: "text", "aria-label": "Name", autocomplete: "name" }) as HTMLInputElement;
  const email = el("input", { type: "email", "aria-label": "Email", autocomplete: "email" }) as HTMLInputElement;
  const password = el("input", { type: "password", "aria-label": "Password", autocomplete: "new-password" }) as HTMLInputElement;
  const nameLabel = el("label", { text: "Name" });
  nameLabel.append(name);
  const emailLabel = el("label", { text: "Email" });
  emailLabel.append(email);
  const passwordLabel = el("label", { text: "Password" });
  passwordLabel.append(password);
  const submit = el("button", { text: "Create account" });
  form.append(nameLabel, emailLabel, passwordLabel, submit);
  const alertNode = el("div", { role: "alert", text: "" });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/auth/register", { method: "POST", body: JSON.stringify({ name: name.value, email: email.value, password: password.value }) });
      window.location.href = "/";
    } catch (err) {
      if (err instanceof ApiProblem && err.body.error === "email_taken") {
        announce(alertNode, "An account with this email already exists.");
      } else {
        announce(alertNode, problemText(err));
      }
    }
  });
  wrap.append(form, alertNode);
  root.append(wrap);
}
