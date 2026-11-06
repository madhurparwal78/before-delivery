import { api, ApiFailure } from "../api.js";
import { h } from "../dom.js";
import { setFeedback } from "../ui.js";

/** The sign-in page (DP-36). */
export function renderSignIn(onSignedIn: () => void): HTMLElement {
  const live = h("p", { class: "status-output", role: "status" });
  const alert = h("div", { class: "page-alert", role: "alert" });
  setFeedback({
    saveStatus: (text) => {
      live.replaceChildren(text);
    },
    evidence: () => undefined,
    board: () => undefined,
    alert: (text) => {
      alert.replaceChildren(text);
    },
    clearAlert: () => {
      alert.replaceChildren();
    },
  });

  const email = h("input", { type: "email", "aria-label": "Email", autocomplete: "email" }) as HTMLInputElement;
  const password = h("input", { type: "password", "aria-label": "Password", autocomplete: "current-password" }) as HTMLInputElement;
  const submit = h("button", { type: "submit", class: "primary" }, "Sign in") as HTMLButtonElement;

  const form = h(
    "form",
    {
      onsubmit: async (event: SubmitEvent) => {
        event.preventDefault();
        submit.textContent = "Signing in…";
        alert.replaceChildren();
        try {
          await api.signIn(email.value, password.value);
          onSignedIn();
        } catch (err) {
          submit.textContent = "Sign in";
          if (err instanceof ApiFailure) {
            alert.replaceChildren("Email or password is incorrect.");
          } else {
            alert.replaceChildren("Something went wrong on our side. Nothing was saved.");
          }
        }
      },
    },
    h("label", null, "Email"),
    email,
    h("label", null, "Password"),
    password,
    h("div", { class: "dialog-actions" }, submit),
  );

  return h(
    "div",
    { class: "screen" },
    h("div", { class: "panel", style: { maxWidth: "420px", margin: "4rem auto" } },
      h("h1", null, "Sign in to Evidence Desk"),
      alert,
      form,
      live,
    ),
  );
}
