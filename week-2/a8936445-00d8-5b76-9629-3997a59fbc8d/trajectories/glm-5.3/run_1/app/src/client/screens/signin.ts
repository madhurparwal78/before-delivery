/** Sign in: email and password. */

import type { User } from "../../shared/api-types.js";
import { ApiClientError, apiJson } from "../api.js";
import type { Feedback } from "../feedback.js";
import { clearActivity, showActivity, showError } from "../feedback.js";

export function renderSignIn(
  root: HTMLElement,
  feedback: Feedback,
  kitchenName: string,
  onSignedIn: (user: User) => void
): void {
  const wrap = document.createElement("div");
  wrap.className = "signin-wrap";

  const brand = document.createElement("div");
  brand.className = "brand-big";
  brand.textContent = "Stationkeeper";
  const kitchen = document.createElement("div");
  kitchen.className = "kitchen-name";
  kitchen.textContent = kitchenName;
  wrap.append(brand, kitchen);

  const form = document.createElement("form");
  form.setAttribute("novalidate", "novalidate");

  const emailRow = document.createElement("div");
  emailRow.className = "field";
  const emailLabel = document.createElement("label");
  emailLabel.setAttribute("for", "email");
  emailLabel.textContent = "Email";
  const email = document.createElement("input");
  email.type = "email";
  email.id = "email";
  email.autocomplete = "username";
  emailRow.append(emailLabel, email);

  const passwordRow = document.createElement("div");
  passwordRow.className = "field";
  const passwordLabel = document.createElement("label");
  passwordLabel.setAttribute("for", "password");
  passwordLabel.textContent = "Password";
  const password = document.createElement("input");
  password.type = "password";
  password.id = "password";
  password.autocomplete = "current-password";
  passwordRow.append(passwordLabel, password);

  const submit = document.createElement("button");
  submit.className = "btn primary";
  submit.type = "submit";
  submit.textContent = "Sign in";
  submit.style.marginTop = "16px";

  form.append(emailRow, passwordRow, submit);
  wrap.appendChild(form);
  root.replaceChildren(wrap);
  email.focus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    showActivity(feedback, "Signing in…");
    try {
      const res = await apiJson<{ user: User }>("POST", "/api/session", {
        email: email.value,
        password: password.value
      });
      clearActivity(feedback);
      onSignedIn(res.user);
    } catch (e) {
      let message = "Something went wrong. Try again in a moment.";
      if (e instanceof ApiClientError) {
        if (e.detail.status === 401) {
          message = "That email and password don't match an account.";
        } else if (e.detail.status === 403) {
          message = "This business has been offboarded. Contact the kitchen.";
        }
      }
      clearActivity(feedback);
      showError(feedback, message);
    } finally {
      submit.disabled = false;
    }
  });
}
