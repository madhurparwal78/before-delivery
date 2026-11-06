/** The Sign-in and Join screens. */

import { api, ApiError, errorFields } from "../lib/api.js";
import { h, clear, statusRegion, setStatus, asInput } from "../lib/dom.js";
import { registerRoute, navigate, refreshShell } from "../app.js";

registerRoute("/sign-in", (params, render) => renderSignIn(params, render.main), true);
registerRoute("/join/([^/]+)", (params, render) => renderJoin(params[0]!, render.main), true);

async function renderSignIn(_params: string[], main: HTMLElement): Promise<void> {
  clear(main);
  const next = new URLSearchParams(location.search).get("next") ?? "/servers";
  const handleInput = asInput(h("input", { type: "text", "aria-label": "Handle", autocomplete: "username" }));
  const passcodeInput = asInput(h("input", { type: "password", "aria-label": "Passcode", autocomplete: "current-password" }));
  const submit = h("button", { class: "primary", type: "submit" }, "Sign in");
  const status = statusRegion("Sign-in status", "sign-in-status");
  const form = h(
    "form",
    {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        setStatus(status, "");
        submit.textContent = "Signing in";
        submit.setAttribute("disabled", "");
        try {
          await api("/api/session", { method: "POST", body: { handle: handleInput.value, passcode: passcodeInput.value } });
          await refreshShell();
          await navigate(next);
        } catch (err) {
          submit.textContent = "Sign in";
          submit.removeAttribute("disabled");
          if (err instanceof ApiError) {
            const fields = errorFields(err);
            setStatus(status, fields.handle ?? fields.passcode ?? err.failure.message);
          }
        }
      },
    },
    h("label", {}, "Handle"),
    handleInput,
    h("label", {}, "Passcode"),
    passcodeInput,
    submit
  );
  main.append(
    h("div", { style: "max-width: 420px; margin: 40px auto" }, h("h1", {}, "Plotwright"), h("div", { class: "card" }, form, status))
  );
  handleInput.focus();
}

async function renderJoin(token: string, main: HTMLElement): Promise<void> {
  clear(main);
  const invite = await api<{ server_name: string; inviter: string; email: string }>(`/api/invites/${token}`);
  const handleInput = asInput(h("input", { type: "text", "aria-label": "Handle", autocomplete: "username" }));
  const displayInput = asInput(h("input", { type: "text", "aria-label": "Display name", autocomplete: "name" }));
  const passcodeInput = asInput(h("input", { type: "password", "aria-label": "Passcode", autocomplete: "new-password" }));
  const submit = h("button", { class: "primary", type: "submit" }, "Join server");
  const status = statusRegion("Join status", "join-status");
  const form = h(
    "form",
    {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        setStatus(status, "");
        submit.textContent = "Joining server";
        submit.setAttribute("disabled", "");
        try {
          const res = await api<{ server: { slug: string } }>(`/api/invites/${token}/accept`, {
            method: "POST",
            body: { handle: handleInput.value, display_name: displayInput.value, passcode: passcodeInput.value },
          });
          await refreshShell();
          await navigate(`/s/${res.data.server.slug}/roster`);
        } catch (err) {
          submit.textContent = "Join server";
          submit.removeAttribute("disabled");
          if (err instanceof ApiError) {
            const fields = errorFields(err);
            setStatus(status, fields.handle ?? fields.display_name ?? fields.passcode ?? err.failure.message);
          }
        }
      },
    },
    h("label", {}, "Handle"),
    handleInput,
    h("label", {}, "Display name"),
    displayInput,
    h("label", {}, "Passcode"),
    passcodeInput,
    submit
  );
  const heading = h("h1", {}, `Join ${invite.data.server_name}`);
  main.append(
    h("div", { style: "max-width: 420px; margin: 40px auto" }, heading, h("p", {}, `${invite.data.inviter} invited ${invite.data.email}.`), h("div", { class: "card" }, form, status))
  );
  handleInput.focus();
}
