// Sign in and Apply screens.

import { ApiFailure, postJson, type User } from "../lib/api.js";
import { announce, clear, el } from "../lib/dom.js";
import { roleLanding, type Navigate } from "../lib/shell.js";

const narrowColumn = (...children: HTMLElement[]): HTMLElement =>
  el("div", { class: "auth-column" }, ...children);

export const renderSignIn = (mount: HTMLElement, navigate: Navigate): void => {
  clear(mount);
  const email = el("input", { type: "text", id: "email", name: "email" });
  email.setAttribute("aria-label", "Email");
  const password = el("input", { type: "password", id: "password", name: "password" });
  password.setAttribute("aria-label", "Password");
  const submit = el("button", { type: "submit" }, "Sign in");
  const statusLine = el("div", {
    role: "status",
    id: "sign-in-status",
    class: "status-live",
    "aria-live": "polite",
    "aria-label": "Sign-in status",
  });
  const applyLink = el("a", { href: "/apply" }, "Apply for kitchen time");

  const form = el(
    "form",
    { "aria-label": "Sign in" },
    el("div", { class: "field" }, el("label", { for: "email" }, "Email"), email),
    el("div", { class: "field" }, el("label", { for: "password" }, "Password"), password),
    submit,
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = "Signing in…";
    try {
      const data = await postJson<{ user: User }>("/api/session", {
        email: (email as HTMLInputElement).value.trim(),
        password: (password as HTMLInputElement).value,
      });
      navigate(roleLanding(data.user), true);
    } catch (err) {
      submit.disabled = false;
      submit.textContent = "Sign in";
      const message = err instanceof ApiFailure && err.code === "invalid_credentials"
        ? "That email and password don't match."
        : "Something went wrong. Try again.";
      announce(statusLine, message);
    }
  });
  const brand = el("h1", { class: "auth-brand" }, "Railside");
  const column = narrowColumn(brand, form, statusLine, applyLink);
  mount.append(column);
  email.focus();
};

export const renderApply = (mount: HTMLElement, navigate: Navigate): void => {
  clear(mount);
  const business = el("input", { type: "text", id: "business_name", name: "business_name" });
  business.setAttribute("aria-label", "Business name");
  const contact = el("input", { type: "text", id: "contact_name", name: "contact_name" });
  contact.setAttribute("aria-label", "Your name");
  const email = el("input", { type: "text", id: "apply-email", name: "email" });
  email.setAttribute("aria-label", "Email");
  const phone = el("input", { type: "text", id: "phone", name: "phone" });
  phone.setAttribute("aria-label", "Phone");
  const password = el("input", { type: "password", id: "apply-password", name: "password" });
  password.setAttribute("aria-label", "Password");

  const errors: Record<string, HTMLElement> = {};
  const wrap = (input: HTMLElement, name: string, label: string): HTMLElement => {
    const error = el("span", { class: "field-error", id: `${name}-error` });
    errors[name] = error;
    return el("div", { class: "field" }, el("label", { for: input.id }, label), input, error);
  };

  const submit = el("button", { type: "submit" }, "Submit application");
  const statusLine = el("div", {
    role: "status",
    id: "application-status",
    class: "status-live",
    "aria-live": "polite",
    "aria-label": "Application status",
  });

  const form = el(
    "form",
    { "aria-label": "Apply" },
    wrap(business, "business_name", "Business name"),
    wrap(contact, "contact_name", "Your name"),
    wrap(email, "email", "Email"),
    wrap(phone, "phone", "Phone"),
    wrap(password, "password", "Password"),
    submit,
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    announce(statusLine, "Sending application…");
    for (const node of Object.values(errors)) clear(node);
    try {
      const data = await postJson<{ user: User }>("/api/applications", {
        business_name: (business as HTMLInputElement).value.trim(),
        contact_name: (contact as HTMLInputElement).value.trim(),
        email: (email as HTMLInputElement).value.trim(),
        phone: (phone as HTMLInputElement).value.trim(),
        password: (password as HTMLInputElement).value,
      });
      window.sessionStorage.setItem("railside-applied", "1");
      navigate("/kitchen", true);
      void data;
    } catch (err) {
      submit.disabled = false;
      if (err instanceof ApiFailure && err.body.errors) {
        for (const [key, message] of Object.entries(err.body.errors)) {
          if (errors[key]) announce(errors[key]!, message);
        }
        announce(statusLine, "Something went wrong. Try again.");
      } else {
        announce(statusLine, "Something went wrong. Try again.");
      }
    }
  });
  const brand = el("h1", { class: "auth-brand" }, "Railside");
  const column = narrowColumn(brand, form, statusLine);
  mount.append(column);
};

