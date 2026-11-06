import { api, ApiCallError, errorFields } from "../api";
import { h, liveRegion, announce, screen as appScreen, registerRefresh } from "../helpers";
import { applyFieldErrors } from "./join";

export function renderSettings(root: HTMLElement): void {
  const status = liveRegion("Settings status");
  const window = h("input", { class: "input small", type: "number", id: "set-window", "data-field": "pickup_window_days", step: "1" });
  const fee = h("input", { class: "input small", type: "number", id: "set-fee", "data-field": "storage_fee_cents", step: "1" });
  const savePolicy = h("button", { class: "btn primary", text: "Save policy", type: "submit" });
  const policyForm = h("form", { class: "panel" },
    h("div", { class: "caption", text: "PICKUP POLICY" }),
    fieldBlock("Pickup window (days)", window, "set-window"),
    fieldBlock("Storage fee (¢/day)", fee, "set-fee"),
    savePolicy);

  const inviteEmail = h("input", { class: "input", type: "email", id: "invite-email", "data-field": "email" });
  const roleSelect = h("select", { class: "input", id: "invite-role", "data-field": "role" },
    h("option", { value: "kiln_tech", text: "Kiln tech" }),
    h("option", { value: "member", text: "Member" }),
    h("option", { value: "drop_off", text: "Drop-off" }));
  const sendInvite = h("button", { class: "btn primary", text: "Send invite", type: "submit" });
  const inviteForm = h("form", { class: "panel" },
    h("div", { class: "caption", text: "INVITE" }),
    fieldBlock("Invite email", inviteEmail, "invite-email"),
    fieldBlock("Role", roleSelect, "invite-role"),
    sendInvite);

  const layout = h("div", { class: "settings-split" }, policyForm, inviteForm);
  root.appendChild(appScreen(layout, status));

  void load();

  async function load(): Promise<void> {
    try {
      const studio = await api<{ pickup_window_days: number; storage_fee_cents: number }>("/api/studio");
      (window as HTMLInputElement).value = String(studio.pickup_window_days);
      (fee as HTMLInputElement).value = String(studio.storage_fee_cents);
    } catch {
      /* refill on next change */
    }
  }

  policyForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void save();
  });

  async function save(): Promise<void> {
    savePolicy.setAttribute("disabled", "true");
    announce(status, "Saving…");
    try {
      const body: Record<string, number> = {};
      const windowValue = Number((window as HTMLInputElement).value);
      const feeValue = Number((fee as HTMLInputElement).value);
      if ((window as HTMLInputElement).value !== "") body.pickup_window_days = windowValue;
      if ((fee as HTMLInputElement).value !== "") body.storage_fee_cents = feeValue;
      await api("/api/studio/settings", { method: "PUT", body });
      announce(status, "Pickup policy saved.");
    } catch (err) {
      const fields = errorFields(err);
      if (fields) {
        applyFieldErrors(policyForm, fields);
        announce(status, "Fix the highlighted fields.");
      } else if (err instanceof ApiCallError && err.kind === "api") {
        announce(status, err.body.message);
      } else {
        announce(status, "No connection. Check the studio wifi and try again.");
      }
    } finally {
      savePolicy.removeAttribute("disabled");
    }
  }

  inviteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    void invite();
  });

  async function invite(): Promise<void> {
    sendInvite.setAttribute("disabled", "true");
    announce(status, "Sending…");
    const email = (inviteEmail as HTMLInputElement).value.trim();
    const selection = (roleSelect as HTMLSelectElement).value;
    const body =
      selection === "kiln_tech"
        ? { email, role: "kiln_tech" }
        : selection === "drop_off"
          ? { email, role: "member", membership: "drop_off" }
          : { email, role: "member", membership: "member" };
    try {
      const created = await api<{ email: string }>("/api/invites", { method: "POST", body });
      announce(status, `Invite created for ${created.email}; the email is on its way.`);
    } catch (err) {
      const fields = errorFields(err);
      if (fields) {
        applyFieldErrors(inviteForm, fields);
        announce(status, "Fix the highlighted fields.");
      } else if (err instanceof ApiCallError && err.kind === "api") {
        announce(status, err.body.message);
      } else {
        announce(status, "No connection. Check the studio wifi and try again.");
      }
    } finally {
      sendInvite.removeAttribute("disabled");
    }
  }

  registerRefresh(() => void load());
}

function fieldBlock(label: string, input: HTMLElement, id: string): HTMLElement {
  return h("div", { class: "field" }, h("label", { for: id, text: label }), input, h("div", { class: "field-error", "data-for": id }));
}
