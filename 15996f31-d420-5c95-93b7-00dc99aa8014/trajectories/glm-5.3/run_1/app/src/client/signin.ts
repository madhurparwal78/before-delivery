import { api, networkProblem, problemOf } from "./api.ts";
import type { User } from "./api.ts";
import { announceProblem, announceUpdate, busyButton, clear, clearFieldErrors, h, showFieldErrors } from "./ui.ts";

/** The sign-in card at `/`. */
export async function renderSignIn(app: HTMLElement): Promise<void> {
  clear(app);
  const card = h("section", { class: "signin-card", "aria-label": "Sign in" },
    h("h1", { class: "wordmark", text: "Swarmline Bloom Desk" }),
  );
  const email = h("input", { type: "email", id: "email", name: "email", autocomplete: "username", required: "" });
  const password = h("input", { type: "password", id: "password", name: "password", autocomplete: "current-password", required: "" });
  const submit = h("button", { type: "submit", class: "primary", text: "Sign in" });
  const form = h("form", { novalidate: "" },
    h("div", { class: "field" }, h("label", { for: "email", text: "Email" }), email),
    h("div", { class: "field" }, h("label", { for: "password", text: "Password" }), password),
    submit,
  );
  card.append(form);
  const wrap = h("div", { class: "signin-wrap" }, card);
  app.append(wrap);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const restore = busyButton(submit);
    announceUpdate("Signing in…");
    try {
      await api<{ user: User }>("/api/session", { method: "POST", body: { email: email.value, password: password.value } });
      window.history.pushState({}, "", "/desk");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (error) {
      restore();
      const problem = problemOf(error) ?? networkProblem();
      if (problem.fields && Object.keys(problem.fields).length > 0) {
        showFieldErrors(form, problem.fields);
      } else if (problem.status === 401) {
        announceProblem("That email and password don't match a Bloom Desk account.");
        const message = h("p", { class: "message", "data-error-for": "email", text: "That email and password don't match a Bloom Desk account." });
        email.setAttribute("aria-invalid", "true");
        email.insertAdjacentElement("afterend", message);
        email.focus();
      } else {
        announceProblem(problem.message);
      }
    }
  });
}
