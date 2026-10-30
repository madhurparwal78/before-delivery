// The moderation drawer: one row per online courier (name, Mute or Unmute, Rename), the audit
// list and Close. Rows are reused by moderation reference across reloads, so the focused
// button stays the same element; a departed row hands focus to its neighbour, never the page.
import { errorCode, get, send } from "../lib/api";
import { closeDialog, isOpen, openDialog, type OpenDialog } from "../lib/dialogs";
import { h, setText } from "../lib/dom";
import type { Notices } from "../lib/notices";
import { paper } from "../lib/paper";

const RELOAD_MS = 5000;

interface StaffEntry {
  moderation_ref: string;
  display_name: string;
  muted: boolean;
}

interface Row {
  ref: string;
  name: string;
  muted: boolean;
  li: HTMLLIElement;
  label: HTMLSpanElement;
  toggle: HTMLButtonElement;
  rename: HTMLButtonElement;
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export class ModerationDrawer {
  readonly el: HTMLElement;
  private readonly rowsList = h("ul", { class: "drawer-rows", "aria-label": "Couriers on Bramble" });
  private readonly audit = h("ul", { class: "drawer-audit", "aria-label": "Audit" });
  private readonly close = h("button", { type: "button", class: "button" }, "Close moderation");
  private readonly rows = new Map<string, Row>();
  private dialog: OpenDialog | null = null;
  private timer = 0;
  private busy = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly notices: Notices,
  ) {
    this.el = paper(
      h(
        "div",
        { role: "dialog", "aria-modal": "true", "aria-label": "Moderation drawer", class: "drawer" },
        h("h2", { class: "drawer-title" }, "Moderation"),
        h("p", { class: "drawer-hint" }, "Couriers on Bramble right now"),
        this.rowsList,
        h("h3", { class: "drawer-subtitle" }, "Audit"),
        this.audit,
        h("div", { class: "drawer-foot" }, this.close),
      ),
    );
    this.close.addEventListener("click", () => this.hide());
  }

  async show(opener: HTMLElement): Promise<void> {
    if (isOpen(this.dialog)) return;
    this.host.append(this.el);
    await this.reload();
    const first = this.ordered()[0];
    this.dialog = openDialog({ el: this.el, opener, focus: first ? first.toggle : this.close, onEscape: () => this.hide() });
    this.timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !this.busy) void this.reload();
    }, RELOAD_MS);
  }

  hide(): void {
    window.clearInterval(this.timer);
    this.el.remove();
    if (this.dialog) closeDialog(this.dialog);
    this.dialog = null;
  }

  private ordered(): Row[] {
    return [...this.rows.values()].sort((a, b) => byCodePoint(a.name, b.name) || byCodePoint(a.ref, b.ref));
  }

  private makeRow(ref: string): Row {
    const label = h("span", { class: "drawer-name" });
    const toggle = h("button", { type: "button", class: "button button-small" });
    const rename = h("button", { type: "button", class: "button button-small button-quiet" }, "Rename");
    const li = h("li", { class: "drawer-row" }, label, toggle, rename);
    const row: Row = { ref, name: "", muted: false, li, label, toggle, rename };
    toggle.addEventListener("click", () => void this.toggleMute(row));
    rename.addEventListener("click", () => this.confirmRename(row));
    return row;
  }

  private async reload(): Promise<void> {
    const [people, entries] = await Promise.all([
      get<{ couriers: StaffEntry[] }>("/api/moderation/presence"),
      get<{ entries: Array<Record<string, string>> }>("/api/moderation/audit"),
    ]);
    if (people.status !== 200) return;
    const active = document.activeElement;
    const before = this.ordered();
    const focusIndex = before.findIndex((r) => r.toggle === active || r.rename === active);
    const focusKind = focusIndex >= 0 && before[focusIndex]!.rename === active ? "rename" : "toggle";
    const seen = new Set<string>();
    for (const entry of people.data.couriers) {
      seen.add(entry.moderation_ref);
      let row = this.rows.get(entry.moderation_ref);
      if (!row) {
        row = this.makeRow(entry.moderation_ref);
        this.rows.set(row.ref, row);
      }
      row.name = entry.display_name;
      row.muted = entry.muted;
      setText(row.label, entry.display_name);
      setText(row.toggle, entry.muted ? "Unmute" : "Mute");
      row.toggle.setAttribute("aria-label", `${entry.muted ? "Unmute" : "Mute"} ${entry.display_name}`);
      row.rename.setAttribute("aria-label", `Rename ${entry.display_name}`);
    }
    for (const ref of [...this.rows.keys()]) if (!seen.has(ref)) this.rows.get(ref)!.li.remove(), this.rows.delete(ref);
    const order = this.ordered();
    order.forEach((row, i) => {
      if (this.rowsList.children[i] !== row.li) this.rowsList.insertBefore(row.li, this.rowsList.children[i] ?? null);
    });
    if (!order.length) setText(this.rowsList, ""), this.rowsList.append(h("li", { class: "drawer-empty" }, "Nobody else is on Bramble right now."));
    else this.rowsList.querySelector(".drawer-empty")?.remove();
    if (entries.status === 200) {
      this.audit.replaceChildren(
        ...entries.data.entries.slice(0, 20).map((e) => {
          const text =
            e.action === "rename"
              ? `${e.actor_display_name} renamed ${e.target_name_before} to ${e.target_name_after}`
              : `${e.actor_display_name} ${e.action === "mute" ? "muted" : "unmuted"} ${e.target_name_before}`;
          return h("li", {}, text);
        }),
      );
    }
    if (focusIndex >= 0) {
      const focusedRow = before[focusIndex]!;
      const kept = this.rows.get(focusedRow.ref);
      const target = kept ?? order[Math.min(focusIndex, order.length - 1)];
      const button = target ? (focusKind === "rename" ? target.rename : target.toggle) : this.close;
      if (document.activeElement !== button) button.focus({ preventScroll: true });
    }
  }

  private async toggleMute(row: Row): Promise<void> {
    const action = row.muted ? "unmute" : "mute";
    const name = row.name;
    this.busy = true;
    this.notices.say("Working…", true);
    const answer = await send({ method: "POST", path: `/api/moderation/${row.ref}/${action}`, body: {} }).catch(() => null);
    const code = answer ? errorCode(answer) : "";
    if (answer?.status === 200) this.notices.say(action === "mute" ? `Muted ${name}.` : `Unmuted ${name}.`);
    else if (code === "already_muted") this.notices.say(`${name} is already muted.`);
    else if (code === "not_muted") this.notices.say(`${name} isn't muted.`);
    else if (code === "cannot_moderate_staff") this.notices.say("Helpers can't moderate staff.");
    else this.notices.say("Something went wrong on Bramble.");
    await this.reload();
    this.busy = false;
    const current = this.rows.get(row.ref);
    (current ? current.toggle : this.close).focus({ preventScroll: true });
  }

  private confirmRename(row: Row): void {
    const cancel = h("button", { type: "button", class: "button button-quiet" }, "Cancel");
    const confirm = h("button", { type: "button", class: "button button-primary" }, "Rename");
    const box = paper(
      h(
        "div",
        { role: "alertdialog", "aria-modal": "true", "aria-label": "Rename courier", class: "confirm" },
        h("p", { class: "confirm-text" }, `Give ${row.name} a fresh courier name?`),
        h("div", { class: "confirm-actions" }, cancel, confirm),
      ),
    );
    this.host.append(box);
    const entry = openDialog({ el: box, opener: row.rename, focus: cancel, onClose: () => box.remove() });
    cancel.addEventListener("click", () => closeDialog(entry));
    confirm.addEventListener("click", async () => {
      closeDialog(entry, false);
      const old = row.name;
      this.busy = true;
      this.notices.say("Working…", true);
      const answer = await send<{ display_name: string }>({ method: "POST", path: `/api/moderation/${row.ref}/rename`, body: {} }).catch(
        () => null,
      );
      if (answer?.status === 200) this.notices.say(`Renamed ${old} to ${answer.data.display_name}.`);
      else if (answer && errorCode(answer) === "cannot_moderate_staff") this.notices.say("Helpers can't moderate staff.");
      else this.notices.say("Something went wrong on Bramble.");
      await this.reload();
      this.busy = false;
      const current = this.rows.get(row.ref);
      (current ? current.rename : this.close).focus({ preventScroll: true });
    });
  }
}
