// Fetch wrapper: one error shape, server time sync, and the session-ended dialog that resends a refused write once.
import * as clock from "./clock.js";
import { h } from "./dom.js";
import { openDialog } from "./dialog.js";
import { problems } from "./problems.js";

export class ApiError extends Error {
  constructor(status, error, body) {
    super(error?.message || "Request failed");
    this.status = status;
    this.code = error?.code || "UNKNOWN";
    this.fields = error?.fields || null;
    this.error = error || {};
    this.body = body;
  }
}

export class SessionCancelled extends Error {}

export const session = { user: null, paused: false, email: null };
let pending = null;

async function once(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* not JSON */ }
  if (payload && payload.server_now) clock.sync(payload.server_now);
  return { response, payload };
}

export async function api(method, path, body, { background = false } = {}) {
  let { response, payload } = await once(method, path, body);
  if (response.status === 401 && session.user && !path.startsWith("/api/auth/")) {
    const signedIn = await sessionEnded();
    if (!signedIn) throw new SessionCancelled();
    if (background) throw new SessionCancelled();
    ({ response, payload } = await once(method, path, body));
  }
  if (!response.ok) throw new ApiError(response.status, payload?.error, payload);
  return payload;
}

export const get = (path, options) => api("GET", path, undefined, options);
export const post = (path, body = {}) => api("POST", path, body);
export const put = (path, body) => api("PUT", path, body);

// The sign-in dialog over the current screen; resolves true after a successful sign-in, false when cancelled.
export function sessionEnded() {
  if (pending) return pending;
  session.paused = true;
  pending = new Promise((resolve) => {
    const password = h("input", { id: "again-password", type: "password", autocomplete: "current-password" });
    const list = problems();
    const submit = h("button", { type: "submit", text: "Sign in" });
    const cancel = h("button", { type: "button", text: "Cancel" });
    const form = h("form", { class: "stack", novalidate: "" },
      h("p", { text: "Your session ended. Sign in to finish." }),
      list.el,
      h("label", { for: "again-password", text: "Password" }), password,
      h("div", { class: "row" }, submit, cancel));
    const dialog = h("dialog", { class: "panel field-yellow", "aria-label": "Sign in again" }, form);
    let result = false;
    const handle = openDialog(dialog, { initial: password, onClose: () => { pending = null; session.paused = false; resolve(result); } });
    cancel.addEventListener("click", () => handle.close());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.setAttribute("aria-disabled", "true");
      try {
        await api("POST", "/api/auth/sign-in", { email: session.user.email, password: password.value });
        result = true;
        handle.close();
      } catch (error) {
        list.show(error instanceof ApiError ? error.message : "Try again.", []);
      } finally {
        submit.removeAttribute("aria-disabled");
      }
    });
  });
  return pending;
}
