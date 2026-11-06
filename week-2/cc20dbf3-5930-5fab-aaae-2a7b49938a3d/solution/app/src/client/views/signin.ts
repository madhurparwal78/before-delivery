import type { User } from "../../shared/api.js";
import { ApiFailure, messageOf, request } from "../api.js";
import { h, statusRegion, uid } from "../dom.js";
import { navigate } from "../nav.js";
import { homePath, setUser } from "../session.js";
import { fieldError, setPending, showFieldErrors } from "./forms.js";

export function signInView(root: HTMLElement): void {
  const emailId = uid("email");
  const passwordId = uid("password");
  const email = h("input", { id: emailId, type: "email", name: "email", autocomplete: "username", required: true });
  const password = h("input", { id: passwordId, type: "password", name: "password", autocomplete: "current-password", required: true });
  const emailError = fieldError(email);
  const passwordError = fieldError(password);
  const status = statusRegion("Form status");
  const submit = h("button", { type: "submit", class: "button button--primary" }, h("span", { class: "button__face" }, "Sign in"));
  let busy = false;

  const form = h(
    "form",
    {
      class: "signin__form",
      novalidate: true,
      onsubmit: async (event: Event) => {
        event.preventDefault();
        if (busy) return;
        busy = true;
        setPending(submit, "Signing in…");
        showFieldErrors({}, { email: emailError, password: passwordError });
        status.textContent = "";
        try {
          const { user } = await request<{ user: User }>("POST", "/api/session", { json: { email: email.value, password: password.value } });
          setUser(user);
          navigate(homePath(user.role), true);
        } catch (error) {
          status.textContent = messageOf(error);
          if (error instanceof ApiFailure) showFieldErrors(error.fields, { email: emailError, password: passwordError });
          email.focus();
        } finally {
          busy = false;
          setPending(submit, null);
        }
      },
    },
    h("div", { class: "field" }, h("label", { for: emailId, class: "label" }, "Email"), email, emailError),
    h("div", { class: "field" }, h("label", { for: passwordId, class: "label" }, "Password"), password, passwordError),
    submit,
    status,
  );

  root.append(
    h(
      "section",
      { class: "box signin", "aria-labelledby": "signin-title" },
      h("p", { class: "label signin__kicker" }, "Lending desk"),
      h("h1", { id: "signin-title" }, "Sign in"),
      h("p", { class: "signin__lede" }, "Members, volunteers and the founder sign in with the email the library has on file."),
      form,
    ),
  );
}
