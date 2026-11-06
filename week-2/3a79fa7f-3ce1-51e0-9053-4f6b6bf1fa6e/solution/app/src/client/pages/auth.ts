// /signup, /login, /forgot-password and /reset-password (brief: Accounts).
import { api } from "../api.ts";
import { h, replace } from "../dom.ts";
import { busy, clearErrors, form, input, showRefusal } from "../forms.ts";
import { navigate, type PageContext } from "../router.ts";
import { announce, refreshCart, setSession, type User } from "../state.ts";
import { pageHead } from "../ui.ts";

/** Only same-site paths are followed after sign-in (pattern of kit/modules/safe_redirect). */
function nextPath(query: URLSearchParams, fallback: string): string {
  const next = query.get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

function home(user: User): string {
  return user.role === "customer" ? "/account" : "/staff";
}

export function signup({ main, query }: PageContext): void {
  document.title = "Create an account | Tern Foils";
  const fields = {
    email: input("Email", { type: "email", name: "email", autocomplete: "email" }),
    password: input("Password", { type: "password", name: "password", autocomplete: "new-password" }, "10 or more characters with a letter and a digit"),
    confirm: input("Confirm password", { type: "password", name: "confirm", autocomplete: "new-password" }),
  };
  const submit = h("button", { type: "submit", class: "pill pill-large" }, "Create account");
  const f = form({ class: "stack-form card" }, fields.email.wrap, fields.password.wrap, fields.confirm.wrap, submit,
    h("p", { class: "caption" }, "Already riding with us? ", h("a", { href: `/login${location.search}` }, "Sign in instead")));
  f.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors(fields, f.alert);
    if (fields.password.control.value !== fields.confirm.control.value) {
      showRefusal({ error: "validation_error", message: "", fields: { confirm: "Passwords do not match." } }, fields, f.alert);
      return;
    }
    const r = await busy(submit, "Creating account...", () => api<{ user: User }>("POST", "/api/auth/signup", { email: fields.email.control.value, password: fields.password.control.value }));
    if (!r.ok) {
      showRefusal(r.error, fields, f.alert);
      return;
    }
    setSession(r.data.user);
    await refreshCart();
    navigate(nextPath(query, "/account"));
  });
  main.append(pageHead("Create an account", "Save builds to your account, check out and book demo seats."), h("div", { class: "wrap narrow" }, f.el));
}

export function login({ main, query }: PageContext): void {
  document.title = "Sign in | Tern Foils";
  const fields = {
    email: input("Email", { type: "email", name: "email", autocomplete: "email" }),
    password: input("Password", { type: "password", name: "password", autocomplete: "current-password" }),
  };
  const submit = h("button", { type: "submit", class: "pill pill-large" }, "Sign in");
  const f = form({ class: "stack-form card" }, fields.email.wrap, fields.password.wrap, submit,
    h("p", null, h("a", { href: "/forgot-password" }, "Forgot your password?")),
    h("p", { class: "caption" }, "New to Tern Foils? ", h("a", { href: `/signup${location.search}` }, "Create an account")));
  f.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors(fields, f.alert);
    const r = await busy(submit, "Signing in...", () => api<{ user: User }>("POST", "/api/auth/login", { email: fields.email.control.value, password: fields.password.control.value }));
    if (!r.ok) {
      showRefusal(r.error, fields, f.alert);
      return;
    }
    setSession(r.data.user);
    await refreshCart();
    navigate(nextPath(query, home(r.data.user)));
  });
  main.append(pageHead("Sign in"), h("div", { class: "wrap narrow" }, f.el));
}

export function forgotPassword({ main }: PageContext): void {
  document.title = "Forgot your password | Tern Foils";
  const email = input("Email", { type: "email", name: "email", autocomplete: "email" });
  const submit = h("button", { type: "submit", class: "pill pill-large" }, "Send reset link");
  const done = h("p", { class: "form-done" });
  const f = form({ class: "stack-form card" }, email.wrap, submit, done);
  f.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    done.textContent = "";
    const r = await busy(submit, "Sending...", () => api<{ message: string }>("POST", "/api/auth/password-reset", { email: email.control.value }));
    if (r.ok) done.textContent = r.data.message;
    else f.alert.textContent = r.error.message;
  });
  main.append(pageHead("Forgot your password", "Enter your email and we will send you a link to choose a new one."), h("div", { class: "wrap narrow" }, f.el));
}

export function resetPassword({ main, query }: PageContext): void {
  document.title = "Reset your password | Tern Foils";
  const fields = {
    password: input("New password", { type: "password", name: "password", autocomplete: "new-password" }, "10 or more characters with a letter and a digit"),
    confirm: input("Confirm new password", { type: "password", name: "confirm", autocomplete: "new-password" }),
  };
  const submit = h("button", { type: "submit", class: "pill pill-large" }, "Reset password");
  const f = form({ class: "stack-form card" }, fields.password.wrap, fields.confirm.wrap, submit);
  const box = h("div", { class: "wrap narrow" }, f.el);
  f.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors(fields, f.alert);
    if (fields.password.control.value !== fields.confirm.control.value) {
      showRefusal({ error: "validation_error", message: "", fields: { confirm: "Passwords do not match." } }, fields, f.alert);
      return;
    }
    const r = await busy(submit, "Saving...", () => api<{ message: string }>("POST", "/api/auth/password-reset/confirm", { token: query.get("token") ?? "", password: fields.password.control.value }));
    if (!r.ok) {
      showRefusal(r.error, fields, f.alert);
      return;
    }
    announce(r.data.message);
    replace(box, h("div", { class: "card" }, h("p", null, "You can now sign in with your new password."), h("a", { href: "/login", class: "pill" }, "Go to sign in")));
  });
  main.append(pageHead("Choose a new password"), box);
}
