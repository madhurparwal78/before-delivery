import { formatWhen, h } from "../dom.js";
import { HttpError, api } from "../net.js";
import { announce, field, openDialog, showFieldErrors } from "../ui.js";
import { ROLE_LABEL, SHARE_ROLES, type OwnerShare, type ShareEntry, type ShareRole } from "../../shared/types.js";

const isOwnerShare = (s: ShareEntry): s is OwnerShare => "shareId" in s;

/** The Share proposal dialog (Public screens; DP-06, DP-07, DP-36, DP-37). */
export class ShareDialog {
  private dialog = h("dialog", { class: "dialog share-dialog", "aria-labelledby": "share-title" });
  private list = h("ul", { "aria-label": "People with access", class: "people-list" });
  private handle: (() => void) | null = null;
  private email = h("input", { id: "share-email", type: "email", autocomplete: "off" });
  private access = h("select", { id: "share-access", "aria-label": "Access" },
    ...SHARE_ROLES.map((r) => h("option", { value: r }, ROLE_LABEL[r])));
  private timed = h("input", { id: "share-timed", type: "checkbox" });
  private ends = h("input", { id: "share-ends", type: "datetime-local" });
  private add = h("button", { type: "submit", class: "btn primary" }, "Add person");
  private form: HTMLFormElement | null = null;

  constructor(private documentId: string, private owner: boolean) {
    const close = h("button", { type: "button", class: "btn quiet" }, "Close");
    close.addEventListener("click", () => this.handle?.());
    this.dialog.append(h("h2", { id: "share-title", class: "dialog-title" }, "Share proposal"));
    if (owner) {
      const endsField = field("Access ends", this.ends);
      endsField.hidden = true;
      this.timed.addEventListener("change", () => { endsField.hidden = !this.timed.checked; if (this.timed.checked) this.ends.focus(); });
      this.form = h("form", { class: "share-form", novalidate: true },
        field("Email", this.email),
        h("div", { class: "field" }, h("label", { for: "share-access" }, "Access"), this.access),
        h("div", { class: "check-row" }, this.timed, h("label", { for: "share-timed" }, "Set an end time")),
        endsField,
        h("div", { class: "form-actions" }, this.add));
      this.form.addEventListener("submit", (e) => { e.preventDefault(); void this.addPerson(); });
      this.dialog.append(this.form);
    }
    this.dialog.append(h("h3", { class: "list-title" }, "People with access"), this.list);
    if (!owner) this.dialog.append(h("p", { class: "muted-line" }, "Only the proposal owner can change access."));
    this.dialog.append(h("div", { class: "dialog-actions" }, close));
  }

  async show(opener: HTMLElement): Promise<void> {
    this.handle = openDialog(this.dialog, { opener, focus: this.owner ? this.email : null });
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const { shares } = await api<{ shares: ShareEntry[] }>("GET", `/api/documents/${encodeURIComponent(this.documentId)}/shares`);
    this.list.replaceChildren(...shares.map((s) => this.item(s)));
  }

  private item(s: ShareEntry): HTMLElement {
    const p = s.person;
    const who = h("span", { class: "who" }, h("span", { class: "dot", style: `--ac:${p.colour}` }), h("span", { class: "name" }, p.displayName));
    if (!isOwnerShare(s)) return h("li", { class: "person-row" }, who, h("span", { class: "role-tag" }, ROLE_LABEL[p.role ?? "viewer"]));
    const ended = s.status === "expired";
    const select = h("select", { "aria-label": `Access for ${p.displayName}`, disabled: ended },
      ...SHARE_ROLES.map((r) => h("option", { value: r, selected: r === s.role }, ROLE_LABEL[r])));
    select.addEventListener("change", () => void this.change(s, { role: select.value as ShareRole }, `${p.displayName} is now ${ROLE_LABEL[select.value as ShareRole]}`));
    const remove = h("button", { type: "button", class: "btn quiet danger", "aria-label": `Remove ${p.displayName}` }, "Remove");
    remove.addEventListener("click", () => void this.remove(s, remove));
    return h("li", { class: "person-row", "data-share": s.shareId },
      h("div", { class: "person-main" }, who,
        h("span", { class: "email" }, s.email),
        h("span", { class: ended ? "until ended" : "until" }, ended ? "Ended" : s.endsAt ? `Until ${formatWhen(s.endsAt)}` : "No end time")),
      h("div", { class: "person-tools" }, h("span", { class: "role-tag" }, ROLE_LABEL[s.role]), select, remove));
  }

  private async change(s: OwnerShare, body: Record<string, unknown>, message: string): Promise<void> {
    try {
      await api("PATCH", `/api/documents/${encodeURIComponent(this.documentId)}/shares/${encodeURIComponent(s.shareId)}`, body);
      announce(message);
    } catch { /* the list below shows the current state */ }
    await this.refresh();
  }

  private async remove(s: OwnerShare, button: HTMLElement): Promise<void> {
    const row = button.closest("li");
    const nextName = row?.nextElementSibling?.querySelector("select, button") as HTMLElement | null;
    await api("DELETE", `/api/documents/${encodeURIComponent(this.documentId)}/shares/${encodeURIComponent(s.shareId)}`).catch(() => undefined);
    announce(`Removed ${s.person.displayName}`);
    const nextId = nextName?.closest("li")?.getAttribute("data-share");
    await this.refresh();
    const target = nextId ? this.list.querySelector(`[data-share="${CSS.escape(nextId)}"] select, [data-share="${CSS.escape(nextId)}"] button`) as HTMLElement | null : null;
    (target ?? this.email).focus();
  }

  private async addPerson(): Promise<void> {
    if (!this.form) return;
    let endsAt: string | null = null;
    if (this.timed.checked) {
      const when = new Date(this.ends.value);
      endsAt = Number.isNaN(when.getTime()) ? "" : when.toISOString().replace(/\.\d{3}Z$/, "Z");
    }
    this.add.disabled = true;
    this.add.textContent = "Adding";
    try {
      const share = await api<OwnerShare>("POST", `/api/documents/${encodeURIComponent(this.documentId)}/shares`, { email: this.email.value.trim(), role: this.access.value, endsAt });
      announce(`Shared with ${share.person.displayName} as ${ROLE_LABEL[share.role]}`);
      showFieldErrors(this.form, {}, { email: this.email, role: this.access, endsAt: this.ends });
      this.email.value = "";
      this.timed.checked = false;
      this.ends.value = "";
      (this.ends.closest(".field") as HTMLElement).hidden = true;
      await this.refresh();
    } catch (e) {
      if (e instanceof HttpError) {
        const fields = e.status === 409 ? { email: "This person already has access." } : e.fields;
        if (fields.endsAt) (this.ends.closest(".field") as HTMLElement).hidden = false;
        showFieldErrors(this.form, fields, { email: this.email, role: this.access, endsAt: this.ends });
      }
    } finally {
      this.add.disabled = false;
      this.add.textContent = "Add person";
    }
  }

  destroy(): void {
    this.handle?.();
    this.dialog.remove();
  }
}
