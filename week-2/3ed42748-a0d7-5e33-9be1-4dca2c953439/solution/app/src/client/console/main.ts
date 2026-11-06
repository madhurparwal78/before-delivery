// The founder console: missions, the editor (whose mission lives in the URL), the studio time
// zone and Online now. Refreshes every 5 seconds without moving focus or touching unsaved edits.
import "../styles/console.css";
import { errorCode, get, send, type Answer, type ErrorBody } from "../lib/api";
import { closeDialog, openDialog } from "../lib/dialogs";
import { h, setText } from "../lib/dom";
import { Notices } from "../lib/notices";
import { paper } from "../lib/paper";

interface Mission {
  mission_id: string;
  title: string;
  resident_id: string;
  reward_stamps: number;
  kind: "standard" | "rush";
  rush_slots: number | null;
  dialogue: { offer: string[]; thanks: string[] };
  status: "draft" | "scheduled" | "live" | "retired";
  version: number;
  revision: number;
  live_at: string | null;
}

const RESIDENTS = [
  ["ottoline", "Ottoline Fennick — Lantern Mill"],
  ["barnaby", "Barnaby Sorrel — Gourd House"],
  ["pim", "Pim Halloway — Tide Observatory"],
  ["juniper", "Juniper Okafor — Mossy Arch"],
] as const;

const FIELD_COPY: Record<string, string> = {
  title: "Titles are 1 to 60 characters.",
  reward_stamps: "Rewards are 1 to 50 stamps.",
  resident_id: "Pick a resident.",
  rush_slots: "Rush missions post 1 to 5 parcels a day.",
  offer: "Write 1 to 6 offer lines of up to 200 characters.",
  thanks: "Write 1 to 3 thanks lines of up to 200 characters.",
};

const TIME_COPY: Record<string, string> = {
  invalid: "Enter a time like 2027-01-15 09:30.",
  required: "Enter a time like 2027-01-15 09:30.",
  nonexistent_time: "That time doesn't exist on the studio clock — the clocks skip it.",
  in_past: "Pick a time from now on.",
  out_of_range: "Pick a time no more than 366 days ahead.",
};

const STALE = "This mission changed in another tab. Reload it to see the latest.";
const INTERNAL = "Something went wrong on Bramble.";
const REFRESH_MS = 5000;
const zones = JSON.parse(document.getElementById("studio-zones")!.textContent ?? "[]") as string[];

function wallTime(iso: string, zone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

class Console {
  private readonly root = document.getElementById("console-root")!;
  private readonly notices = new Notices();
  private readonly newButton = h("button", { type: "button", class: "button button-primary" }, "New mission");
  private readonly tbody = h("tbody");
  private readonly rows = new Map<string, { tr: HTMLTableRowElement; edit: HTMLButtonElement; cells: HTMLTableCellElement[] }>();
  private readonly form = h("form", { "aria-label": "Mission editor", class: "editor", novalidate: true });
  private readonly placeholder = h("p", { class: "editor-empty" }, "Pick a mission to edit, or start a new one.");
  private readonly fields = {
    title: h("input", { id: "f-title", type: "text", class: "field-input", autocomplete: "off" }),
    resident_id: h("select", { id: "f-resident", class: "field-select" }),
    reward_stamps: h("input", { id: "f-reward", type: "number", class: "field-input", min: "1", max: "50", step: "1" }),
    rush_slots: h("input", { id: "f-slots", type: "number", class: "field-input", min: "1", max: "5", step: "1" }),
    offer: h("textarea", { id: "f-offer", class: "field-area", rows: "4" }),
    thanks: h("textarea", { id: "f-thanks", class: "field-area", rows: "3" }),
    live_at: h("input", { id: "f-live", type: "text", class: "field-input", placeholder: "2027-01-15 09:30", autocomplete: "off" }),
  };
  private readonly kindStandard = h("input", { type: "radio", name: "kind", id: "kind-standard", value: "standard" });
  private readonly kindRush = h("input", { type: "radio", name: "kind", id: "kind-rush", value: "rush" });
  private readonly slotsField = h("div", { class: "field" });
  private readonly saveButton = h("button", { type: "submit", class: "button button-primary" }, "Save draft");
  private readonly moves = {
    schedule: h("button", { type: "button", class: "button" }, "Schedule"),
    publish: h("button", { type: "button", class: "button" }, "Publish now"),
    unschedule: h("button", { type: "button", class: "button" }, "Unschedule"),
    retire: h("button", { type: "button", class: "button" }, "Retire"),
  };
  private readonly zoneSelect = h("select", { id: "studio-zone", class: "field-select" });
  private readonly boardLine = h("p", { class: "board-line" });
  private readonly onlineLine = h("p", { class: "online-line" });
  private zone = "UTC";
  private missions: Mission[] = [];
  /** The mission in the editor: null (empty editor), "new" or an existing mission. */
  private editing: { id: string | "new"; mission: Mission | null; snapshot: string } | null = null;
  private busy = false;

  constructor() {
    void this.start();
  }

  private async start(): Promise<void> {
    const me = await get<{ role: string }>("/api/me").catch(() => null);
    if (me?.status === 200 && me.data.role === "founder") return this.build();
    this.refusal(!me || me.status === 401 || me.data.role === "guest");
  }

  // ---- refusal ----

  private refusal(offerKey: boolean): void {
    const walk = h("button", { type: "button", class: "button" }, "Walk on Bramble");
    walk.addEventListener("click", () => location.assign("/"));
    const card = paper(
      h(
        "section",
        { class: "refusal", "aria-labelledby": "refusal-title" },
        h("h1", { id: "refusal-title" }, "Founder console"),
        h("p", { class: "refusal-copy" }, "Only the founder can open the console."),
      ),
    );
    if (offerKey) {
      const email = h("input", { id: "refusal-email", type: "email", class: "field-input", autocomplete: "email" });
      const error = h("p", { id: "refusal-email-error", class: "field-error" });
      const sendKey = h("button", { type: "submit", class: "button button-primary" }, "Send postbox key");
      const form = h(
        "form",
        { class: "refusal-form", novalidate: true },
        h("label", { for: "refusal-email", class: "field-label" }, "Email"),
        email,
        error,
        sendKey,
      );
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        this.notices.say("Sending your postbox key…", true);
        const answer = await send({
          method: "POST",
          path: "/api/auth/postbox-key",
          body: { email: email.value, return_to: location.pathname + location.search },
        }).catch(() => null);
        if (answer?.status === 200) {
          setText(error, "");
          email.removeAttribute("aria-describedby");
          this.notices.say("Check your inbox for a postbox key.");
        } else if (answer && errorCode(answer) === "validation") {
          setText(error, "Enter an email address like name@example.com.");
          email.setAttribute("aria-describedby", error.id);
          this.notices.say("Enter an email address like name@example.com.");
        } else if (answer && errorCode(answer) === "post_office_closed")
          this.notices.say("The post office is closed right now. Try again in a few minutes.");
        else this.notices.say(INTERNAL);
      });
      card.append(form);
    }
    card.append(walk);
    this.root.replaceChildren(this.notices.el, h("main", { "aria-label": "Founder console", class: "refusal-main" }, card));
  }

  // ---- the console ----

  private build(): void {
    for (const [value, label] of [["", "Pick a resident"], ...RESIDENTS] as const)
      this.fields.resident_id.append(h("option", { value }, label));
    for (const z of zones) this.zoneSelect.append(h("option", { value: z }, z));
    const table = h(
      "table",
      { "aria-label": "Missions", class: "missions-table" },
      h("thead", {}, h("tr", {}, ...["Title", "Status", "Version", "Goes live"].map((c) => h("th", { scope: "col" }, c)))),
      this.tbody,
    );
    const missionsRegion = paper(
      h(
        "section",
        { "aria-labelledby": "missions-title", class: "panel panel-missions", role: "region" },
        h("div", { class: "panel-head" }, h("h2", { id: "missions-title" }, "Missions"), this.newButton),
        h("div", { class: "table-scroll" }, table),
      ),
    );
    this.buildForm();
    const editorPanel = paper(h("section", { class: "panel panel-editor", "aria-labelledby": "editor-title" }, h("h2", { id: "editor-title" }, "Mission editor"), this.placeholder, this.form));
    const saveZone = h("button", { type: "button", class: "button" }, "Save time zone");
    saveZone.addEventListener("click", () => void this.saveZone());
    const studio = paper(
      h(
        "section",
        { "aria-labelledby": "studio-title", class: "panel panel-studio", role: "region" },
        h("h2", { id: "studio-title" }, "Studio"),
        h("label", { for: "studio-zone", class: "field-label" }, "Studio time zone"),
        h("div", { class: "field-row" }, this.zoneSelect, saveZone),
        this.boardLine,
      ),
    );
    const online = paper(
      h(
        "section",
        { "aria-labelledby": "online-title", class: "panel panel-online", role: "region" },
        h("h2", { id: "online-title" }, "Online now"),
        this.onlineLine,
      ),
    );
    const main = h(
      "main",
      { "aria-label": "Founder console", class: "console" },
      h("header", { class: "console-head" }, h("h1", {}, "Founder console"), h("a", { href: "/", class: "back-link" }, "Walk on Bramble")),
      h("div", { class: "console-grid" }, missionsRegion, editorPanel, studio, online),
    );
    this.newButton.addEventListener("click", () => this.openEditor("new", true));
    window.addEventListener("popstate", () => this.onPopState());
    this.root.replaceChildren(this.notices.el);
    void this.firstLoad(main);
    window.setInterval(() => {
      if (document.visibilityState === "visible" && !this.busy) void this.refresh();
    }, REFRESH_MS);
  }

  private buildForm(): void {
    const f = this.fields;
    const field = (id: string, label: string, control: Field, extra?: Node): HTMLElement =>
      h(
        "div",
        { class: "field" },
        h("label", { for: control.id, class: "field-label" }, label),
        control,
        extra ?? null,
        h("p", { id: `${id}-error`, class: "field-error" }),
      );
    const kind = h(
      "fieldset",
      { role: "radiogroup", "aria-label": "Kind", class: "field kind" },
      h("legend", { class: "field-label" }, "Kind"),
      h("label", { class: "radio" }, this.kindStandard, h("span", {}, "Standard")),
      h("label", { class: "radio" }, this.kindRush, h("span", {}, "Rush")),
    );
    this.slotsField.append(
      h("label", { for: f.rush_slots.id, class: "field-label" }, "Rush slots"),
      f.rush_slots,
      h("p", { id: "rush_slots-error", class: "field-error" }),
    );
    for (const radio of [this.kindStandard, this.kindRush]) radio.addEventListener("change", () => this.syncKind());
    const moves = h("div", { class: "editor-moves" }, this.saveButton, ...Object.values(this.moves));
    this.form.append(
      field("title", "Title", f.title),
      field("resident_id", "Resident", f.resident_id),
      field("reward_stamps", "Stamp reward", f.reward_stamps),
      kind,
      this.slotsField,
      field("offer", "Offer lines", f.offer, h("p", { class: "field-hint" }, "One line of dialogue per line.")),
      field("thanks", "Thanks lines", f.thanks),
      field("live_at", "Go live at", f.live_at, h("p", { class: "field-hint" }, `Studio wall time, YYYY-MM-DD HH:MM`)),
      moves,
    );
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.save();
    });
    this.moves.schedule.addEventListener("click", () => void this.move("schedule"));
    this.moves.publish.addEventListener("click", () => void this.move("publish"));
    this.moves.unschedule.addEventListener("click", () => void this.move("unschedule"));
    this.moves.retire.addEventListener("click", () => void this.move("retire"));
    this.form.hidden = true;
  }

  private syncKind(): void {
    this.slotsField.hidden = !this.kindRush.checked;
  }

  // ---- loading ----

  /** The studio zone is read before the missions so every Goes live cell renders in it. */
  private async loadAll(): Promise<void> {
    await this.loadStudio();
    await Promise.all([this.loadMissions(), this.loadOnline()]);
  }

  /** The console mounts once its first data, the editor's URL state and the fonts are in, so nothing shifts. */
  private async firstLoad(main: HTMLElement): Promise<void> {
    await this.loadAll();
    await this.openFromUrl(false);
    await document.fonts.ready.catch(() => undefined);
    this.root.append(main);
    (this.form.hidden ? this.newButton : this.fields.title).focus();
  }

  private async refresh(): Promise<void> {
    await this.loadAll();
    const e = this.editing;
    if (e?.mission && !this.dirty()) {
      const fresh = this.missions.find((m) => m.mission_id === e.mission!.mission_id);
      if (fresh && fresh.revision !== e.mission.revision) this.fill(fresh);
    }
  }

  private async loadMissions(): Promise<void> {
    const answer = await get<{ missions: Mission[] }>("/api/founder/missions").catch(() => null);
    if (answer?.status !== 200) return;
    this.missions = answer.data.missions;
    this.renderTable();
  }

  private async loadStudio(): Promise<void> {
    const answer = await get<{ time_zone: string; board_date: string }>("/api/founder/studio").catch(() => null);
    if (answer?.status !== 200) return;
    if (this.zone !== answer.data.time_zone) {
      this.zone = answer.data.time_zone;
      this.renderTable();
    }
    if (document.activeElement !== this.zoneSelect) this.zoneSelect.value = this.zone;
    setText(this.boardLine, `Today's board: ${answer.data.board_date}`);
  }

  private async loadOnline(): Promise<void> {
    const answer = await get<{ online: number; guests: number; signed_in: number }>("/api/founder/online").catch(() => null);
    if (answer?.status !== 200) return;
    const { online, guests, signed_in } = answer.data;
    setText(this.onlineLine, `${online} couriers on Bramble (${guests} guests, ${signed_in} signed in)`);
  }

  private renderTable(): void {
    const seen = new Set<string>();
    this.missions.forEach((m, i) => {
      seen.add(m.mission_id);
      let row = this.rows.get(m.mission_id);
      if (!row) {
        const edit = h("button", { type: "button", class: "link-button" });
        edit.addEventListener("click", () => this.openEditor(m.mission_id, true));
        const cells = [h("td", {}, edit), h("td"), h("td"), h("td")];
        row = { tr: h("tr", {}, ...cells), edit, cells };
        this.rows.set(m.mission_id, row);
      }
      setText(row.edit, m.title);
      row.edit.setAttribute("aria-label", `Edit ${m.title}`);
      setText(row.cells[1]!, m.status[0]!.toUpperCase() + m.status.slice(1));
      row.cells[1]!.className = `status status-${m.status}`;
      setText(row.cells[2]!, String(m.version));
      setText(row.cells[3]!, m.status === "scheduled" && m.live_at ? wallTime(m.live_at, this.zone) : "—");
      if (this.tbody.children[i] !== row.tr) this.tbody.insertBefore(row.tr, this.tbody.children[i] ?? null);
    });
    for (const [id, row] of this.rows) if (!seen.has(id)) row.tr.remove(), this.rows.delete(id);
  }

  // ---- the editor and the URL ----

  private urlFor(id: string | "new" | null): string {
    return id === null ? "/console" : `/console?mission=${id}`;
  }

  private wantedFromUrl(): string | null {
    return new URLSearchParams(location.search).get("mission");
  }

  private async openFromUrl(fromHistory: boolean): Promise<void> {
    const wanted = this.wantedFromUrl();
    if (wanted === null) return this.clearEditor();
    if (wanted === "new") return this.showNew();
    const answer = await get<Mission>(`/api/founder/missions/${encodeURIComponent(wanted)}`).catch(() => null);
    if (answer?.status === 200) return this.showMission(answer.data);
    if (answer?.status === 404 || !/^[a-z0-9-]{1,64}$/.test(wanted)) {
      this.notices.say("That mission isn't on the list.");
      history.replaceState(null, "", "/console");
      this.clearEditor();
      return;
    }
    if (!fromHistory) this.notices.say(INTERNAL);
  }

  private clearEditor(): void {
    this.editing = null;
    this.form.hidden = true;
    this.placeholder.hidden = false;
    this.newButton.focus();
  }

  private showNew(): void {
    this.clearErrors();
    this.form.hidden = false;
    this.placeholder.hidden = true;
    const f = this.fields;
    f.title.value = "";
    f.resident_id.value = "";
    f.reward_stamps.value = "";
    f.rush_slots.value = "";
    f.offer.value = "";
    f.thanks.value = "";
    f.live_at.value = "";
    this.kindStandard.checked = true;
    this.kindStandard.disabled = this.kindRush.disabled = false;
    this.syncKind();
    this.editing = { id: "new", mission: null, snapshot: "" };
    this.editing.snapshot = this.snapshot();
    this.syncButtons();
    f.title.focus();
  }

  private showMission(m: Mission): void {
    this.clearErrors();
    this.form.hidden = false;
    this.placeholder.hidden = true;
    this.editing = { id: m.mission_id, mission: m, snapshot: "" };
    this.fill(m);
    this.fields.title.focus();
  }

  /** Puts a mission's current revision into the editor (a clean editor follows every refresh). */
  private fill(m: Mission): void {
    const f = this.fields;
    const focused = document.activeElement;
    f.title.value = m.title;
    f.resident_id.value = m.resident_id;
    f.reward_stamps.value = String(m.reward_stamps);
    f.rush_slots.value = m.rush_slots === null ? "" : String(m.rush_slots);
    f.offer.value = m.dialogue.offer.join("\n");
    f.thanks.value = m.dialogue.thanks.join("\n");
    if (focused !== f.live_at) f.live_at.value = m.live_at && m.status === "scheduled" ? wallTime(m.live_at, this.zone) : f.live_at.value;
    (m.kind === "rush" ? this.kindRush : this.kindStandard).checked = true;
    this.kindStandard.disabled = this.kindRush.disabled = true;
    this.syncKind();
    this.editing = { id: m.mission_id, mission: m, snapshot: "" };
    this.editing.snapshot = this.snapshot();
    this.syncButtons();
  }

  private snapshot(): string {
    const f = this.fields;
    return JSON.stringify([
      f.title.value,
      f.resident_id.value,
      f.reward_stamps.value,
      this.kindRush.checked,
      f.rush_slots.value,
      f.offer.value,
      f.thanks.value,
    ]);
  }

  private dirty(): boolean {
    return !!this.editing && this.snapshot() !== this.editing.snapshot;
  }

  private syncButtons(): void {
    const m = this.editing?.mission ?? null;
    const status = m?.status ?? "new";
    setText(this.saveButton, m ? "Save changes" : "Save draft");
    this.saveButton.hidden = status === "retired";
    this.moves.schedule.hidden = status !== "draft";
    this.moves.publish.hidden = status !== "draft";
    this.moves.unschedule.hidden = status !== "scheduled";
    this.moves.retire.hidden = status !== "live";
  }

  private firstLegalMove(): HTMLButtonElement {
    const order = [this.moves.schedule, this.moves.publish, this.moves.unschedule, this.moves.retire];
    return order.find((b) => !b.hidden) ?? this.newButton;
  }

  private openEditor(id: string | "new", push: boolean): void {
    if (push) history.pushState(null, "", this.urlFor(id));
    if (id === "new") this.showNew();
    else void this.openFromUrl(false);
  }

  private onPopState(): void {
    if (!this.dirty()) return void this.openFromUrl(true);
    const own = this.urlFor(this.editing!.id);
    const destination = location.pathname + location.search;
    const focused = document.activeElement as HTMLElement | null;
    const keep = h("button", { type: "button", class: "button button-primary" }, "Keep editing");
    const discard = h("button", { type: "button", class: "button button-quiet" }, "Discard");
    const box = paper(
      h(
        "div",
        { role: "dialog", "aria-modal": "true", "aria-label": "Discard changes?", class: "confirm" },
        h("h2", {}, "Discard changes?"),
        h("p", {}, "Your unsaved edits to this mission will be lost."),
        h("div", { class: "confirm-actions" }, discard, keep),
      ),
    );
    document.body.append(box);
    let decided = false;
    const entry = openDialog({
      el: box,
      opener: focused,
      focus: keep,
      onEscape: () => keepEditing(),
      onClose: () => box.remove(),
    });
    const keepEditing = (): void => {
      if (decided) return;
      decided = true;
      history.pushState(null, "", own);
      closeDialog(entry);
    };
    keep.addEventListener("click", keepEditing);
    discard.addEventListener("click", () => {
      decided = true;
      closeDialog(entry, false);
      if (this.editing) this.editing.snapshot = this.snapshot();
      history.replaceState(null, "", destination);
      void this.openFromUrl(true);
    });
  }

  // ---- saving and moves ----

  private clearErrors(): void {
    for (const el of this.form.querySelectorAll<HTMLElement>(".field-error")) setText(el, "");
    for (const c of this.form.querySelectorAll("[aria-describedby]")) c.removeAttribute("aria-describedby");
    this.form.querySelector(".kind")?.removeAttribute("aria-describedby");
  }

  private showErrors(fields: Record<string, string>): void {
    this.clearErrors();
    const map: Array<[string, Field | null, string]> = [
      ["title", this.fields.title, FIELD_COPY.title!],
      ["resident_id", this.fields.resident_id, FIELD_COPY.resident_id!],
      ["reward_stamps", this.fields.reward_stamps, FIELD_COPY.reward_stamps!],
      ["rush_slots", this.fields.rush_slots, FIELD_COPY.rush_slots!],
      ["offer", this.fields.offer, FIELD_COPY.offer!],
      ["thanks", this.fields.thanks, FIELD_COPY.thanks!],
    ];
    let first: Field | null = null;
    for (const [key, control, copy] of map) {
      const reason = key === "offer" || key === "thanks" ? fields[`dialogue.${key}`] ?? fields.dialogue : fields[key];
      if (!reason || !control) continue;
      const error = document.getElementById(`${key}-error`)!;
      setText(error, copy);
      control.setAttribute("aria-describedby", error.id);
      first ??= control;
    }
    const time = fields.live_at_local ?? fields.live_at;
    if (time) {
      const error = document.getElementById("live_at-error")!;
      setText(error, TIME_COPY[time] ?? TIME_COPY.invalid!);
      this.fields.live_at.setAttribute("aria-describedby", error.id);
      first ??= this.fields.live_at;
    }
    if (first) this.notices.say(document.getElementById(first.getAttribute("aria-describedby")!)!.textContent ?? "");
    first?.focus();
  }

  private body(): Record<string, unknown> {
    const f = this.fields;
    const lines = (v: string): string[] => v.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() !== "");
    const number = (v: string): number | null => (v.trim() === "" ? null : Number(v));
    const rush = this.kindRush.checked;
    return {
      title: f.title.value,
      resident_id: f.resident_id.value,
      reward_stamps: number(f.reward_stamps.value),
      kind: rush ? "rush" : "standard",
      rush_slots: rush ? number(f.rush_slots.value) : null,
      dialogue: { offer: lines(f.offer.value), thanks: lines(f.thanks.value) },
    };
  }

  private async save(): Promise<void> {
    const e = this.editing;
    if (!e || this.busy) return;
    this.busy = true;
    this.notices.say("Saving…", true);
    let answer: Answer<Mission> | null;
    if (e.mission) {
      const body = this.body();
      delete body.kind;
      if (e.mission.kind === "standard") delete body.rush_slots;
      answer = await send<Mission>({
        method: "PATCH",
        path: `/api/founder/missions/${e.mission.mission_id}`,
        body,
        headers: { "If-Match": `"${e.mission.revision}"` },
      }).catch(() => null);
    } else answer = await send<Mission>({ method: "POST", path: "/api/founder/missions", body: this.body() }).catch(() => null);
    this.busy = false;
    this.afterChange(answer, (m) => {
      if (!e.mission) history.replaceState(null, "", this.urlFor(m.mission_id));
      return m.status === "live" ? `Live now — version ${m.version}.` : "Draft saved.";
    });
  }

  private async move(kind: "schedule" | "publish" | "unschedule" | "retire"): Promise<void> {
    const m = this.editing?.mission;
    if (!m || this.busy) return;
    this.busy = true;
    this.notices.say("Working…", true);
    let body: Record<string, unknown> = {};
    if (kind === "publish") body = { live_at: "now" };
    if (kind === "schedule") body = { live_at_local: this.fields.live_at.value.trim().replace(" ", "T") };
    const path = `/api/founder/missions/${m.mission_id}/${kind === "publish" ? "schedule" : kind}`;
    const answer = await send<Mission>({ method: "POST", path, body, headers: { "If-Match": `"${m.revision}"` } }).catch(() => null);
    this.busy = false;
    const target = { schedule: "scheduled", publish: "live", unschedule: "draft", retire: "retired" }[kind];
    this.afterChange(
      answer,
      (next) => {
        if (next.status === "live" && kind !== "retire") return `Live now — version ${next.version}.`;
        if (next.status === "scheduled") return `Scheduled for ${wallTime(next.live_at!, this.zone)}.`;
        if (next.status === "draft") return "Back to draft.";
        return "Retired.";
      },
      `That mission can't move from ${m.status} to ${target}.`,
    );
  }

  private afterChange(answer: Answer<Mission> | null, success: (m: Mission) => string, illegal?: string): void {
    if (!answer) return this.notices.say("Couldn't reach the depot. Try again.");
    const code = errorCode(answer);
    if (answer.status === 200 || answer.status === 201) {
      const m = answer.data;
      this.clearErrors();
      this.notices.say(success(m));
      this.editing = { id: m.mission_id, mission: m, snapshot: "" };
      this.fill(m);
      if (m.status !== "scheduled") this.fields.live_at.value = "";
      void this.loadMissions();
      this.firstLegalMove().focus();
    } else if (code === "validation") {
      this.showErrors((answer.data as unknown as ErrorBody).error.fields ?? {});
    } else if (code === "stale_revision") this.notices.say(STALE);
    else if (code === "mission_retired") this.notices.say("Retired missions can't be edited.");
    else if (code === "illegal_transition" && illegal) this.notices.say(illegal);
    else this.notices.say(INTERNAL);
  }

  private async saveZone(): Promise<void> {
    this.notices.say("Saving…", true);
    const answer = await send<{ time_zone: string; board_date: string }>({
      method: "PATCH",
      path: "/api/founder/studio",
      body: { time_zone: this.zoneSelect.value },
    }).catch(() => null);
    if (answer?.status === 200) {
      this.zone = answer.data.time_zone;
      setText(this.boardLine, `Today's board: ${answer.data.board_date}`);
      this.renderTable();
      this.notices.say(`Studio time zone saved. Today's board is ${answer.data.board_date}.`);
    } else if (answer && errorCode(answer) === "validation") this.notices.say("Pick a time zone from the list.");
    else this.notices.say(answer ? INTERNAL : "Couldn't reach the depot. Try again.");
  }
}

new Console();
