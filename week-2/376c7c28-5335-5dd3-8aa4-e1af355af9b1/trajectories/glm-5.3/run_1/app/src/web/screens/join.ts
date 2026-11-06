import { api, ApiCallError, errorFields, type Person } from "../api";
import { h, liveRegion, announce } from "../ui";
import { setMe, navigate, homeFor, connectEvents } from "../main";

export function renderJoin(root: HTMLElement, token: string): void {
  const status = liveRegion("Join status");
  const nameInput = h("input", { class: "input", type: "text", id: "join-name", autocomplete: "off" });
  const handleInput = h("input", { class: "input", type: "text", id: "join-handle", autocomplete: "off" });
  const passwordInput = h("input", { class: "input", type: "password", id: "join-password" });
  const submit = h("button", { class: "btn primary", text: "Join studio", type: "submit" });
  const studioLine = h("p", { class: "muted", text: "" });
  const emailLine = h("p", { class: "muted", text: "" });
  const form = h(
    "form",
    {
      class: "panel narrow",
      onsubmit: (e: Event) => {
        e.preventDefault();
        void join();
      },
    },
    h("h1", { class: "heading", text: "Join studio" }),
    studioLine,
    emailLine,
    fieldBlock("Your name", nameInput, "join-name"),
    fieldBlock("Studio handle", handleInput, "join-handle"),
    fieldBlock("Choose a password", passwordInput, "join-password"),
    submit,
    status,
  );
  root.appendChild(h("div", { class: "center-wrap" }, form));
  submit.setAttribute("disabled", "true");

  void (async () => {
    try {
      const invite = await api<{ studio_name: string; email: string; role: string }>(`/api/invites/${encodeURIComponent(token)}`);
      studioLine.textContent = invite.studio_name;
      emailLine.textContent = invite.email;
      form.querySelector("h1")?.replaceWith(h("h1", { class: "heading", text: `Join ${invite.studio_name}` }));
      submit.removeAttribute("disabled");
    } catch (err) {
      if (err instanceof ApiCallError && err.kind === "api") {
        if (err.body.error === "not_found") announce(status, "This invite link is not valid.");
        else if (err.body.error === "invite_gone") announce(status, "This invite has expired or was already used.");
        else announce(status, err.body.message);
      } else {
        announce(status, "No connection. Check the studio wifi and try again.");
      }
    }
  })();

  async function join(): Promise<void> {
    submit.setAttribute("disabled", "true");
    announce(status, "Joining…");
    try {
      const res = await api<{ user: Person }>(`/api/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        body: { name: (nameInput as HTMLInputElement).value.trim(), handle: (handleInput as HTMLInputElement).value.trim(), password: (passwordInput as HTMLInputElement).value },
      });
      setMe({ person: res.user, timeZone: res.user.studio.time_zone });
      connectEvents();
      navigate(homeFor(res.user.role), true);
    } catch (err) {
      if (err instanceof ApiCallError && err.kind === "api") {
        const fields = errorFields(err);
        if (fields) {
          applyFieldErrors(form, fields);
          announce(status, "Fix the highlighted fields.");
        } else if (err.body.error === "not_found") announce(status, "This invite link is not valid.");
        else if (err.body.error === "invite_gone") announce(status, "This invite has expired or was already used.");
        else announce(status, err.body.message);
      } else {
        announce(status, "No connection. Check the studio wifi and try again.");
      }
      submit.removeAttribute("disabled");
    }
  }
}

function fieldBlock(label: string, input: HTMLElement, id: string): HTMLElement {
  return h("div", { class: "field" }, h("label", { for: id, text: label }), input, h("div", { class: "field-error", "data-for": id }));
}

export function applyFieldErrors(form: HTMLElement, fields: Record<string, string>): void {
  const containers = form.querySelectorAll<HTMLElement>(".field");
  for (const container of containers) {
    const input = container.querySelector("input, select, textarea") as HTMLInputElement | null;
    const errorEl = container.querySelector<HTMLElement>(".field-error");
    if (!input || !errorEl) continue;
    const key = input.getAttribute("data-field") ?? camelFromId(input.id);
    const message = fields[key];
    if (message) {
      errorEl.textContent = message;
      const describedBy = `${input.id}-error`;
      errorEl.id = describedBy;
      input.setAttribute("aria-describedby", describedBy);
      container.classList.add("has-error");
      const clearOnce = () => {
        errorEl.textContent = "";
        input.removeAttribute("aria-describedby");
        container.classList.remove("has-error");
        input.removeEventListener("input", clearOnce);
      };
      input.addEventListener("input", clearOnce);
    }
  }
}

export function camelFromId(id: string): string {
  const parts = id.split("-");
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join("");
}
