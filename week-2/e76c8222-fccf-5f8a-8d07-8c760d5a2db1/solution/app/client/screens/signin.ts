// Sign in with a seeded email and the shared demo passcode.
import type { User } from "../../shared/api.js";
import { call } from "../api.js";
import { signedIn, type Screen } from "../app.js";
import { h, say, statusRegion } from "../dom.js";
import { field, showErrors, textInput } from "../ui.js";

export function signinScreen({ main }: Screen): void {
  const email = field("Email", h("input", { type: "email", autocomplete: "username", spellcheck: "false", autocapitalize: "off" }));
  const passcode = field("Passcode", textInput({ class: "secret", spellcheck: "false", autocapitalize: "off" }));
  const status = statusRegion("Sign-in status");
  const submit = h("button", { type: "submit", class: "button primary" }, "Sign in");
  const form = h("form", { class: "stack", novalidate: true }, email.wrap, passcode.wrap, h("div", { class: "actions" }, submit), status);
  const fields = { email, passcode };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showErrors(fields);
    say(status, "Signing in…");
    submit.disabled = true;
    const result = await call<{ user: User }>("POST", "/api/session", { email: email.control.value, passcode: passcode.control.value });
    submit.disabled = false;
    if (result.ok) {
      signedIn(result.data.user);
      return;
    }
    if (result.error.code === "validation") {
      showErrors(fields, result.error.fields);
      say(status, "Enter your email and the passcode.");
      return;
    }
    say(status, result.error.code === "invalid_credentials" ? "That email and passcode do not match." : "Sign-in failed. Try again.");
  });
  main.append(
    h(
      "section",
      { class: "sheet narrow" },
      h("h1", {}, "Sign in"),
      h("p", { class: "lede" }, "The dispatch desk for Fernhollow Access. Use your work email and the passcode you were given."),
      form,
    ),
  );
  email.control.focus();
}
