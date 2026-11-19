/** Log in and sign up pages, inside the marketing chrome. */
import { marketingDocument } from "./marketing/chrome.js";
import type { RenderedPage } from "./layout.js";

function field(id: string, label: string, type: string, autocomplete: string): string {
  return `<div class="field">
          <label for="${id}">${label}</label>
          <input class="input" id="${id}" name="${id}" type="${type}" autocomplete="${autocomplete}" aria-describedby="${id}-error" data-field="${id}">
          <p class="field-error" id="${id}-error" data-error-for="${id}"></p>
        </div>`;
}

export function loginPage(): RenderedPage {
  const main = `<div class="auth">
      <div class="auth-card">
        <h1>Log in</h1>
        <p class="auth-lede">Welcome back. Pick up where you left off.</p>
        <form class="auth-form" novalidate data-auth-form="login">
          ${field("email", "Email", "email", "username")}
          ${field("password", "Password", "password", "current-password")}
          <p class="field-error form-error" data-form-error></p>
          <button class="btn btn-primary btn-block" type="submit" data-submit>Log in</button>
        </form>
        <p class="auth-switch">New to Tallwind? <a href="/signup">Open an account</a></p>
      </div>
    </div>`;
  return marketingDocument({ title: "Log in · Tallwind", page: "login", main, scripts: ["/assets/auth.js"], styles: ["/assets/css/auth.css"] });
}

export function signupPage(): RenderedPage {
  const main = `<div class="auth">
      <div class="auth-card">
        <h1>Open your account</h1>
        <p class="auth-lede">One calm screen for every dollar your company holds, owes and is owed.</p>
        <form class="auth-form" novalidate data-auth-form="signup">
          ${field("name", "Name", "text", "name")}
          ${field("email", "Email", "email", "email")}
          ${field("password", "Password", "password", "new-password")}
          <p class="field-error form-error" data-form-error></p>
          <button class="btn btn-primary btn-block" type="submit" data-submit>Open account</button>
        </form>
        <p class="auth-switch">Already have an account? <a href="/login">Log in</a></p>
      </div>
    </div>`;
  return marketingDocument({ title: "Open an account · Tallwind", page: "signup", main, scripts: ["/assets/auth.js"], styles: ["/assets/css/auth.css"] });
}
