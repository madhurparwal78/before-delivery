// The Share document dialog: invite by email, the people list, Not sent and Resend.
import type { Share } from "./api.js";
import { docPath, request } from "./api.js";
import { COPY } from "./copy.js";
import { Dialog, field, radioGroup } from "./dialog.js";
import { announce, button, h, setBusy } from "./dom.js";
import type { Workspace } from "./workspace.js";

export function openShare(ws: Workspace, opener: HTMLElement): void {
  // A one-line textarea keeps a pasted line break, so the server can refuse that address.
  const email = h("textarea", { rows: "1", inputmode: "email", autocomplete: "off", spellcheck: "false", class: "one-line" }) as HTMLTextAreaElement;
  const emailField = field("Email", email);
  const role = radioGroup("share-role", "Role", [["editor", "Editor"], ["viewer", "Viewer"]], "editor");
  const scope = radioGroup("share-rows", "Rows", [["all", "All rows"], ["own", "Only their own rows"]], "all");
  const send = button("Send invite", { class: "btn primary" });
  const status = h("div", { role: "status", "aria-label": "Share status", class: "share-status" });
  const outageSlot = h("div", { class: "outage-slot" });
  const people = h("ul", { "aria-label": "People", class: "people" });
  let outage: HTMLElement | null = null;
  const dialog = new Dialog({ title: "Share document", returnTo: () => ws.control("share") ?? opener, extraClass: "share-dialog" });

  const setOutage = (text: string | null) => {
    if (text === null) {
      outage?.remove();
      outage = null;
      return;
    }
    if (!outage) {
      outage = h("div", { role: "alert", "aria-label": "Mail outage", class: "banner" });
      outageSlot.append(outage);
    }
    announce(outage, text);
  };

  const render = (shares: Share[], outageCopy: string | null) => {
    people.replaceChildren(
      ...shares.map((s) =>
        h("li", { class: "person" },
          h("span", { class: "person-email" }, s.email),
          h("span", { class: "person-role" }, s.role === "editor" ? "Editor" : "Viewer", s.row_scope === "own" ? " · own rows" : " · all rows"),
          h("span", { class: `person-status ${s.invite_status}` }, s.invite_status === "sent" ? "Sent" : "Not sent"),
          s.invite_status === "not_sent" ? button(`Resend invite to ${s.email}`, { class: "btn small", onclick: (e: Event) => void resend(s, e.currentTarget as HTMLButtonElement) }) : null,
        ),
      ),
    );
    if (!shares.some((s) => s.invite_status === "not_sent")) setOutage(null);
    else if (outageCopy) setOutage(outageCopy);
  };

  const load = async (outageCopy: string | null) => {
    const answer = await request<{ shares: Share[] }>("GET", `${docPath(ws.docId)}/shares`);
    if (answer.ok) render(answer.data.shares, outageCopy);
  };

  const resend = async (s: Share, control: HTMLButtonElement) => {
    setBusy(control, true);
    const answer = await request<{ share: Share }>("POST", `${docPath(ws.docId)}/shares/${s.id}/resend`);
    if (answer.ok) {
      announce(status, COPY.inviteSent(answer.data.share.email));
      await load(null);
      email.focus();
      return;
    }
    setBusy(control, false);
    if (answer.status === 503) setOutage(COPY.stillNotSent);
    else if (answer.status === 409) announce(status, COPY.alreadySent);
    await load(null);
  };

  const submit = async () => {
    setBusy(send, true);
    const answer = await request<{ share: Share }>("POST", `${docPath(ws.docId)}/shares`, { email: email.value, role: role.value(), row_scope: scope.value() });
    setBusy(send, false);
    if (!answer.ok) {
      if (answer.status === 422) {
        emailField.setError(answer.error?.fields?.email ?? Object.values(answer.error?.fields ?? {})[0] ?? "");
        email.focus();
      }
      return;
    }
    const share = answer.data.share;
    email.value = "";
    email.focus();
    if (share.invite_status === "sent") {
      announce(status, COPY.inviteSent(share.email));
      await load(null);
    } else await load(COPY.mailOutage);
  };

  send.addEventListener("click", () => void submit());
  email.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  });
  dialog.body.append(
    emailField.wrap, role.group, scope.group,
    h("div", { class: "dialog-buttons" }, send, button("Cancel", { onclick: () => dialog.close() })),
    status, outageSlot,
    h("h3", { class: "people-title" }, "People"), people,
  );
  dialog.show();
  void load(COPY.mailOutage);
}
