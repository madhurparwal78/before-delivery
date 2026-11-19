/** Recipients: the list with keyboard-complete removal, and the add-recipient and invite forms. */
import { announce } from "../shared/announce.js";
import { api, ServerFault, SignedOut, Unreachable } from "../shared/api.js";
import { COPY } from "../shared/copy.js";
import { clear, h, ICONS, isPending, openModal, pending, svg } from "../shared/dom.js";
import { actionFailed, actionSucceeded, refreshFailed } from "../shared/outage.js";
import { methodLabel } from "../shared/format.js";
import { clearErrors, field, focusFirstInvalid, showError } from "./fields.js";
import { currentMe } from "./store.js";

interface Recipient {
  id: string;
  display_name: string;
  kind: "person" | "business" | null;
  method: string | null;
  status: "active" | "pending";
  account_last4: string | null;
}

const SAVED_NOTICE = "saved";

function recipientRow(recipient: Recipient, canRemove: boolean): HTMLElement {
  const pendingInvite = recipient.status === "pending";
  const detail = pendingInvite
    ? h("span", { class: "chip chip-quiet" }, "Invite pending")
    : h("span", { class: "recipient-detail" }, h("span", { class: "mono" }, `Checking ${recipient.account_last4}`), h("span", { class: "chip" }, methodLabel(recipient.method ?? "")));
  const row = h(
    "li",
    { class: "recipient-row enter", "data-recipient": recipient.id },
    h("div", { class: "recipient-main" }, h("strong", { class: "recipient-name" }, recipient.display_name), recipient.kind ? h("span", { class: "chip" }, recipient.kind === "business" ? "Business" : "Person") : null, detail),
  );
  if (canRemove) {
    row.append(h("button", { class: "btn btn-quiet", type: "button", "aria-label": `Remove ${recipient.display_name}`, "data-remove": recipient.id }, svg(ICONS.bin), h("span", {}, "Remove")));
  }
  return row;
}

export function mountRecipients(root: HTMLElement): void {
  const add = h("a", { class: "btn btn-primary", href: "/payments/recipients/new" }, "Add recipient");
  const list = h("ul", { class: "recipient-list", "aria-label": "Recipients" });
  const empty = h("p", { class: "empty-state", hidden: true }, "No recipients yet. Add one to start sending payments.");
  root.append(h("div", { class: "page-actions" }, add), list, empty);
  const canRemove = currentMe().user.role !== "member";

  async function load(): Promise<void> {
    try {
      const { data } = await api<{ recipients: Recipient[] }>("GET", "/api/recipients");
      clear(list);
      list.append(...data.recipients.map((recipient) => recipientRow(recipient, canRemove)));
      empty.hidden = data.recipients.length > 0;
    } catch (error) {
      if (error instanceof Unreachable) refreshFailed();
      else if (error instanceof ServerFault) announce(COPY.serverError);
      else if (!(error instanceof SignedOut)) throw error;
    }
  }

  void load().then(() => {
    if (new URLSearchParams(location.search).get("notice") === SAVED_NOTICE) {
      history.replaceState(null, "", location.pathname);
      announce("Recipient saved");
    }
  });

  list.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-remove]");
    if (!button) return;
    const name = button.closest("li")?.querySelector(".recipient-name")?.textContent ?? "";
    confirmRemoval(button, name, add, load);
  });
}

function confirmRemoval(opener: HTMLButtonElement, name: string, addControl: HTMLElement, reload: () => Promise<void>): void {
  const keep = h("button", { class: "btn btn-quiet", type: "button" }, "Keep");
  const remove = h("button", { class: "btn btn-primary", type: "button" }, "Remove");
  const dialog = h(
    "dialog",
    { class: "dialog", "aria-label": "Remove recipient" },
    h("h2", { class: "dialog-title" }, "Remove recipient"),
    h("p", {}, `${name} will no longer appear in Recipients or Send payment. Past payments keep its name.`),
    h("div", { class: "dialog-actions" }, keep, remove),
  );
  const close = openModal(dialog, opener);
  keep.addEventListener("click", () => close(true));
  remove.addEventListener("click", async () => {
    if (isPending(remove)) return;
    const done = pending(remove, "Removing…");
    try {
      const { status, data } = await api<{ error?: string }>("DELETE", `/api/recipients/${opener.dataset.remove}`);
      actionSucceeded();
      if (status === 204 || status === 404) {
        close(false);
        await reload();
        announce("Recipient removed");
        addControl.focus();
      } else if (data && data.error === "recipient_has_pending_payments") {
        close(true);
        announce("This recipient has a payment waiting for approval.");
      } else {
        close(true);
      }
    } catch (error) {
      if (error instanceof Unreachable) {
        actionFailed();
      } else if (error instanceof ServerFault) announce(COPY.serverError);
      else if (!(error instanceof SignedOut)) throw error;
    } finally {
      done();
    }
  });
  keep.focus();
}

const RECIPIENT_ORDER = ["display_name", "kind", "method", "account_number", "routing_number"];

export function mountRecipientForm(root: HTMLElement): void {
  const name = h("input", { class: "input", type: "text", autocomplete: "off", spellcheck: "false" });
  const kind = h("select", { class: "select" }, h("option", { value: "business" }, "Business"), h("option", { value: "person" }, "Person"));
  const method = h("select", { class: "select" }, ...["ach", "wire", "rtp", "check"].map((value) => h("option", { value }, methodLabel(value))));
  const account = h("input", { class: "input mono", type: "text", inputmode: "numeric", autocomplete: "off" });
  const routing = h("input", { class: "input mono", type: "text", inputmode: "numeric", autocomplete: "off" });
  const save = h("button", { class: "btn btn-primary", type: "submit" }, "Save recipient");
  const form = h(
    "form",
    { class: "stack-form", novalidate: true },
    field("display_name", "Display name", name),
    field("kind", "Kind", kind),
    field("method", "Method", method),
    field("account_number", "Account number", account),
    field("routing_number", "Routing number", routing),
    save,
  );
  const email = h("input", { class: "input", type: "text", autocomplete: "off", inputmode: "email" });
  const invite = h("button", { class: "btn btn-quiet", type: "submit" }, "Send invite");
  const inviteForm = h("form", { class: "stack-form", novalidate: true }, field("invite_email", "Recipient email", email), invite);
  root.append(
    h("section", { class: "panel", "aria-label": "New recipient" }, form),
    h("section", { class: "panel", "aria-label": "Invite by email" }, h("h2", { class: "panel-title" }, "Invite by email"), inviteForm),
  );

  const idByField: Record<string, HTMLElement> = { display_name: name, kind, method, account_number: account, routing_number: routing };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isPending(save)) return;
    clearErrors(form);
    const done = pending(save, "Saving…");
    try {
      const { status, data } = await api<any>("POST", "/api/recipients", {
        body: { display_name: name.value, kind: kind.value, method: method.value, account_number: account.value, routing_number: routing.value },
      });
      actionSucceeded();
      if (status === 201) {
        location.assign("/payments/recipients?notice=saved");
        return;
      }
      if (data.error === "duplicate_recipient") {
        const message = `This recipient is already saved as ${data.display_name}.`;
        showError(account, message);
        announce(message);
        account.focus();
      } else if (data.error === "validation") {
        for (const [fieldName, message] of Object.entries<string>(data.fields)) {
          const input = idByField[fieldName];
          if (input) showError(input, message);
        }
        focusFirstInvalid(form, RECIPIENT_ORDER);
      }
    } catch (error) {
      if (error instanceof Unreachable) {
        actionFailed();
      } else if (error instanceof ServerFault) announce(COPY.serverError);
      else if (!(error instanceof SignedOut)) throw error;
    } finally {
      done();
    }
  });

  inviteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isPending(invite)) return;
    clearErrors(inviteForm);
    const done = pending(invite, "Sending invite…");
    try {
      const { status, data } = await api<any>("POST", "/api/recipients/invite", { body: { email: email.value } });
      actionSucceeded();
      if (status === 201) {
        const sent = email.value.trim().toLowerCase();
        email.value = "";
        announce(`Invite sent to ${sent}`);
      } else if (data.error === "duplicate_recipient") {
        const message = "An invite to this email is already pending.";
        showError(email, message);
        announce(message);
        email.focus();
      } else if (data.error === "validation") {
        showError(email, "Enter a valid email");
        email.focus();
      }
    } catch (error) {
      if (error instanceof Unreachable) {
        actionFailed();
      } else if (error instanceof ServerFault) announce(COPY.serverError);
      else if (!(error instanceof SignedOut)) throw error;
    } finally {
      done();
    }
  });
}

