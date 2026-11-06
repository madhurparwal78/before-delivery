// Sign in with an access code, on whatever address was opened.
import { api, errorCode, NoResponse } from "../api.js";
import { h, setFieldError, uid } from "../dom.js";
import { main, type Me } from "../shell.js";

export function signInScreen(onSignedIn: (me: Me) => Promise<void>): void {
  document.title = "Sign in · Tally Split";
  const errorEl = h("p", { class: "field-error", id: uid("err"), hidden: true });
  const input = h("input", {
    id: "access-code",
    class: "input",
    type: "text",
    name: "code",
    autocomplete: "off",
    autocapitalize: "characters",
    spellcheck: "false",
    "aria-label": "Access code",
  });
  const button = h("button", { type: "submit", class: "button primary wide" }, "Sign in");
  let sending = false;
  const form = h(
    "form",
    {
      class: "panel signin",
      onsubmit: async (event: SubmitEvent) => {
        event.preventDefault();
        if (sending) return;
        sending = true;
        button.textContent = "Signing in...";
        button.setAttribute("aria-disabled", "true");
        try {
          const r = await api<Me>("POST", "/api/session", { body: { code: input.value } });
          if (r.status === 200) {
            await onSignedIn(r.body);
            return;
          }
          setFieldError(input, errorEl, errorCode(r) === "invalid_code" ? "That code doesn't match anyone in this club." : "Enter your access code.");
        } catch (error) {
          if (!(error instanceof NoResponse)) throw error;
          setFieldError(input, errorEl, "Couldn't reach the club's server. Check your connection and try again.");
        } finally {
          sending = false;
          button.textContent = "Sign in";
          button.setAttribute("aria-disabled", "false");
        }
        input.focus();
      },
    },
    h("p", { class: "kicker" }, "Tare & Tally"),
    h("h1", {}, "Tally Split"),
    h("p", { class: "muted" }, "Split-case orders for the club. Sign in with the access code the coordinator gave you."),
    h("div", { class: "field" }, h("label", { for: "access-code", class: "label" }, "ACCESS CODE"), input, errorEl),
    button,
  );
  main.replaceChildren(h("div", { class: "signin-wrap" }, form));
  input.focus();
}
