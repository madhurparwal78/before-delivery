import { ICONS, autoGrow, formatWhen, h, plural, quillMark, setText, svgIcon } from "../dom.js";
import { HttpError, Live, api, type ServerFrame } from "../net.js";
import { NoticesControl } from "../notices.js";
import { navigate, type View } from "../router.js";
import { announce, openDialog, reducedMotion } from "../ui.js";
import { FindDialog } from "./find.js";
import { Margin } from "./margin.js";
import { type Cover, caretRect, offsetOf, pointAt, renderPage, wordLeft, wordRight } from "./page.js";
import { ShareDialog } from "./share.js";
import { ProposalSync, isPending } from "./sync.js";
import { blocksOf, mapCaret, saveState, wordCount, type Change } from "../../shared/model.js";
import {
  BLOCK_STYLES, ROLE_LABEL, STYLE_LABEL, TOGGLE_MARKS, canComment, canDecide, isOwner, modesFor,
  type BlockStyle, type Card, type Comment, type EditMode, type EndReason, type Mode, type Op, type Person, type PresenceEntry,
  type Range, type Role, type SaveState, type SessionPerson, type Snapshot, type ToggleMark,
} from "../../shared/types.js";

const PHONE = "(max-width: 767.98px)";
const DESKTOP = "(min-width: 1200px)";
const MODE_LABEL: Record<Mode, string> = { editing: "Editing", suggesting: "Suggesting", viewing: "Viewing" };
const HEADINGS: BlockStyle[] = ["title", "heading1", "heading2", "heading3"];
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

interface CardModel { id: string; start: number; card: Card; range: Range | null; text: string }

export function mountEditor(root: HTMLElement, me: SessionPerson, proposalId: string, focusCard: string | null): View {
  const editor = new Editor(root, me, proposalId, focusCard);
  void editor.load();
  return { unmount: () => editor.destroy() };
}

/** The editor page (Screens and layout; Interactions; Motion and effects). */
export class Editor {
  private me: Person;
  private sync!: ProposalSync;
  private role: Role = "viewer";
  private mode: Mode = "viewing";
  private accessEndsAt: string | null = null;
  private title = "";
  private sel = { anchor: 0, focus: 0 };
  private starts: number[] = [];
  private focusedCard: string | null = null;
  private showResolved = false;
  private carets = new Map<string, { at: number; length: number }>();
  private presence = new Map<string, PresenceEntry>();
  private saveFailed = false;
  private latestSaved = 0;
  private live: Live | null = null;
  private joined = false;
  private inflight = false;
  private lastCaret = "";
  private chosenMode: Mode | null = null;
  private connected = true;
  private finished = false;
  private hits: number[] = [];
  private hitLength = 0;
  private currentHit = -1;
  private ink: { range: Range; colour: string }[] = [];
  private idleWaiters: (() => void)[] = [];
  private lastStart = new Map<string, number>();
  private replyDrafts = new Map<string, HTMLTextAreaElement>();
  private dialogs: (() => void)[] = [];
  private media = { phone: window.matchMedia(PHONE), desktop: window.matchMedia(DESKTOP) };
  private cleanups: (() => void)[] = [];

  // chrome
  private notices = new NoticesControl();
  private titleEl!: HTMLElement;
  private peopleList = h("ul", { "aria-label": "People here", class: "people-here" });
  private modeGroup = h("div", { role: "radiogroup", "aria-label": "Mode", class: "modes" });
  private radios = new Map<Mode, HTMLInputElement>();
  private toolbar = h("div", { role: "toolbar", "aria-label": "Formatting", class: "toolbar" });
  private markButtons = new Map<ToggleMark, HTMLButtonElement>();
  private styleSelect = h("select", { "aria-label": "Paragraph style", class: "style-select" }, ...BLOCK_STYLES.map((s) => h("option", { value: s }, STYLE_LABEL[s])));
  private toolButtons: Record<string, HTMLButtonElement> = {};
  private outlineButton = h("button", { type: "button", class: "chrome-btn outline-toggle", "aria-expanded": "false", "aria-controls": "outline-panel" }, svgIcon(ICONS.list), h("span", { class: "label" }, "Outline"));
  private menuButton = h("button", { type: "button", class: "chrome-btn menu-toggle", "aria-haspopup": "menu", "aria-expanded": "false" }, svgIcon(ICONS.menu), h("span", { class: "label" }, "Toolbar"));
  private menu = h("div", { role: "menu", "aria-label": "Toolbar", class: "tool-menu", hidden: true });
  private saveEl = h("span", { role: "status", "aria-label": "Save status", class: "save-status" });
  private wordsEl = h("span", { class: "words" });
  private untilEl = h("span", { class: "until" });
  private sheetButton = h("button", { type: "button", class: "chrome-btn sheet-toggle" });
  private banners = h("div", { class: "banners" });
  private outline = h("nav", { "aria-label": "Outline", class: "outline", id: "outline-panel" });
  private headings = h("div", { role: "listbox", "aria-label": "Headings", tabindex: "0", class: "headings" });
  private page = h("div", {
    role: "textbox", "aria-label": "Proposal body", "aria-multiline": "true", contenteditable: "true", spellcheck: "true", class: "page",
  });
  private caretLayer = h("div", { class: "caret-layer", "aria-hidden": "true" });
  private cardsHost = h("div", { class: "cards" });
  private marginEl = h("aside", { "aria-label": "Margin", class: "margin" });
  private svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private sheet = h("dialog", { class: "sheet", "aria-labelledby": "sheet-title" });
  private sheetHandle: (() => void) | null = null;
  private draft: HTMLElement | null = null;
  private find: FindDialog;
  private share: ShareDialog | null = null;
  private margin: Margin;
  private shell = h("div", { class: "editor" });

  constructor(root: HTMLElement, session: SessionPerson, private documentId: string, private focusCard: string | null) {
    this.me = { personId: session.personId, displayName: session.displayName, colour: session.colour };
    this.svg.setAttribute("class", "tethers");
    this.svg.setAttribute("aria-hidden", "true");
    this.margin = new Margin(this.cardsHost, this.svg, this.page);
    this.find = new FindDialog(this);
    root.append(this.shell);
    this.shell.append(h("div", { class: "editor-loading", "aria-hidden": "true" }, h("div", { class: "sheet-skeleton" }, h("span"), h("span"), h("span"), h("span"))));
  }

  // ---------------------------------------------------------------- loading and screens

  async load(): Promise<void> {
    let snap: Snapshot;
    try {
      snap = await api<Snapshot>("GET", `/api/documents/${encodeURIComponent(this.documentId)}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) return navigate(`/sign-in?next=${encodeURIComponent(location.pathname)}`, true);
      if (e instanceof HttpError && e.status === 503) return this.screen("This proposal can't be opened right now", "Storage is unreachable. Try again in a minute.", false);
      return this.screen("Proposal not found", "This proposal doesn't exist or isn't shared with you.", false);
    }
    if (this.finished) return;
    this.applySnapshot(snap);
    this.build();
    this.connect();
    this.render();
    if (this.focusCard) {
      const id = this.focusCard;
      this.focusCard = null;
      requestAnimationFrame(() => this.focusCardEl(id));
      this.focusCardEl(id);
    }
  }

  private applySnapshot(snap: Snapshot): void {
    this.sync = new ProposalSync(snap, this.me);
    this.role = snap.myAccess.role;
    this.mode = snap.myAccess.mode;
    this.accessEndsAt = snap.myAccess.accessEndsAt;
    this.title = snap.title;
    this.me.role = this.role;
    this.saveFailed = snap.saveState === "failed";
    this.latestSaved = snap.savedRevision;
  }

  /** Not-found, access-ended and storage-unavailable screens replace the editor. */
  private screen(heading: string, text: string, alert: boolean): void {
    this.finished = true;
    this.live?.expectClose();
    this.live?.close();
    this.closeDialogs();
    const body = alert ? h("div", { role: "alert", class: "end-alert" }, text) : h("p", {}, text);
    this.shell.replaceChildren(h("main", { class: "end-screen" }, h("div", { class: "end-card" }, quillMark(), h("h1", {}, heading), body,
      h("a", { href: "/", "data-route": true, class: "btn primary" }, "Back to documents"))));
  }

  private ended(reason: EndReason): void {
    const why: Record<EndReason, string> = {
      expired: "Your access ended at the time the owner set.",
      removed: "The owner removed your access.",
      deleted: "The owner deleted this proposal.",
    };
    this.screen("This proposal is no longer available", why[reason], true);
  }

  destroy(): void {
    this.finished = true;
    this.live?.close();
    this.closeDialogs();
    this.find.destroy();
    this.share?.destroy();
    this.notices.destroy();
    this.sheet.remove();
    for (const c of this.cleanups) c();
  }

  private closeDialogs(): void {
    for (const d of this.dialogs.splice(0)) d();
    this.sheetHandle?.();
    this.closeMenu(false);
  }

  // ---------------------------------------------------------------- socket

  private connect(): void {
    this.joined = false;
    this.inflight = false;
    this.live = new Live((f) => this.onFrame(f), () => void this.join(), () => this.dropped());
  }

  private async join(): Promise<void> {
    const live = this.live;
    if (!live) return;
    const reply = await live.request({ type: "join", documentId: this.documentId, revision: this.sync.revision });
    if (this.finished) return;
    if (reply.type !== "joined") return this.screen("Proposal not found", "This proposal doesn't exist or isn't shared with you.", false);
    this.joined = true;
    this.setConnected(true);
    this.role = reply.role as Role;
    this.me.role = this.role;
    const chosen = this.chosenMode;
    this.chosenMode = null;
    this.mode = chosen && modesFor(this.role).includes(chosen) ? chosen : reply.mode as Mode;
    if (chosen && this.mode === chosen && chosen !== reply.mode) void live.request({ type: "mode", mode: chosen });
    this.accessEndsAt = (reply.accessEndsAt as string | null) ?? null;
    for (const p of reply.people as PresenceEntry[]) { this.presence.set(p.person.personId, p); this.sync.people.set(p.person.personId, p.person); }
    if ((reply.revision as number) > this.sync.revision) await this.resync();
    this.render();
    this.pump();
  }

  private async resync(): Promise<void> {
    const snap = await api<Snapshot>("GET", `/api/documents/${encodeURIComponent(this.documentId)}`).catch(() => null);
    if (!snap || this.finished) return;
    const people = this.sync.people;
    this.applySnapshot(snap);
    for (const [id, p] of people) if (!this.sync.people.has(id)) this.sync.people.set(id, p);
  }

  private dropped(): void {
    if (this.finished) return;
    this.joined = false;
    this.setConnected(false);
    window.setTimeout(async () => {
      if (this.finished) return;
      const snap = await api<Snapshot>("GET", `/api/documents/${encodeURIComponent(this.documentId)}`).catch((e: unknown) => e);
      if (this.finished) return;
      if (snap instanceof HttpError && snap.status === 404) return this.screen("Proposal not found", "This proposal doesn't exist or isn't shared with you.", false);
      if (snap instanceof Error || !snap) return this.dropped();
      this.applySnapshot(snap as Snapshot);
      this.connect();
      this.render();
    }, 1500);
  }

  private setConnected(on: boolean): void {
    this.connected = on;
    this.renderBanners();
    this.renderChromeState();
  }

  private onFrame(f: ServerFrame): void {
    if (this.finished) return;
    switch (f.type) {
      case "op": {
        if ((f.revision as number) <= this.sync.revision) return;
        const changes = this.sync.remote(f.revision as number, f.authorId as string, f.mode as EditMode, f.ops as Op[]);
        this.mapThrough(changes);
        this.render();
        this.find.refresh();
        return;
      }
      case "card_added":
      case "card_changed":
        this.sync.card(f.card as Card, f.type === "card_added");
        this.render();
        return;
      case "card_closed": {
        const id = f.cardId as string;
        const span = this.sync.closed(id);
        if (span && f.status === "accepted" && span.inserted && !reducedMotion()) {
          this.ink = [{ range: { ...span.inserted, length: span.inserted.length }, colour: this.sync.author(span.authorId).colour }];
        }
        if (this.focusedCard === id) this.focusedCard = null;
        this.margin.settle(id);
        this.render();
        this.animateInk();
        return;
      }
      case "caret": {
        const p = f.person as Person;
        this.sync.people.set(p.personId, p);
        this.carets.set(p.personId, { at: f.at as number, length: f.length as number });
        this.renderCarets();
        return;
      }
      case "presence": {
        const p = f.person as Person;
        this.sync.people.set(p.personId, p);
        if (f.state === "left") { this.presence.delete(p.personId); this.carets.delete(p.personId); }
        else this.presence.set(p.personId, { person: p, state: f.state as "active" | "idle" });
        this.renderPeople();
        this.renderCarets();
        return;
      }
      case "saved":
        this.latestSaved = Math.max(this.latestSaved, f.revision as number);
        if (this.latestSaved >= this.sync.revision) this.saveFailed = false;
        this.renderStatus();
        return;
      case "save_failed":
        this.saveFailed = true;
        this.renderStatus();
        return;
      case "role_changed":
        this.roleChanged(f.role as Role, f.mode as Mode);
        return;
      case "title_changed":
        this.title = f.title as string;
        if (this.titleEl instanceof HTMLInputElement) { if (document.activeElement !== this.titleEl) this.titleEl.value = this.title; } else setText(this.titleEl, this.title);
        return;
      case "access_ended":
        this.live?.expectClose();
        this.ended(f.reason as EndReason);
        return;
      case "notice":
      case "lists_changed":
        void this.notices.refresh();
        return;
    }
  }

  private roleChanged(role: Role, mode: Mode): void {
    const before = this.mode;
    this.role = role;
    this.me.role = role;
    this.sync.people.set(this.me.personId, { ...this.me });
    this.mode = mode;
    this.sync.pending = this.sync.pending.filter((f) => f.sent || modesFor(role).includes(f.mode));
    this.sync.recompute();
    let message = `Your access changed to ${ROLE_LABEL[role]}.`;
    if (mode !== before && mode === "suggesting") message += " You're now suggesting.";
    if (mode !== before && mode === "viewing") message += " You're now viewing.";
    announce(message);
    this.render();
  }

  private get saveStatus(): SaveState {
    return saveState(this.latestSaved, this.sync.revision, this.saveFailed, this.sync.idle);
  }

  // ---------------------------------------------------------------- editing

  private get editMode(): EditMode | null {
    return this.mode === "viewing" || !this.connected ? null : this.mode;
  }

  private range(): { from: number; to: number } {
    return { from: Math.min(this.sel.anchor, this.sel.focus), to: Math.max(this.sel.anchor, this.sel.focus) };
  }

  /** A local change: applied on this screen at once, sent in order, merged by the server. */
  private edit(ops: Op[], caret: number): void {
    const mode = this.editMode;
    if (!mode || !ops.length) return;
    const changes = this.sync.local(mode, ops);
    if (!changes) return;
    for (const [id, c] of this.carets) this.carets.set(id, { at: mapCaret(c.at, changes), length: c.length });
    this.sel = { anchor: caret, focus: caret };
    this.render();
    this.find.refresh();
    this.pump();
  }

  private pump(): void {
    if (!this.live?.open || !this.joined || this.inflight) return;
    const frame = this.sync.takeFrame();
    if (!frame) { this.flushIdle(); return; }
    this.inflight = true;
    void this.live.request({ type: "op", baseRevision: this.sync.revision, mode: frame.mode, ops: frame.ops }).then((reply) => {
      this.inflight = false;
      if (this.finished) return;
      if (reply.type === "ack") this.sync.acked(reply.revision as number);
      else this.sync.refused();
      this.renderStatus();
      this.render();
      this.pump();
    });
  }

  private flushIdle(): void {
    if (!this.sync.idle) return;
    for (const w of this.idleWaiters.splice(0)) w();
  }

  private whenIdle(): Promise<void> {
    if (this.sync.idle) return Promise.resolve();
    return new Promise((resolve) => { this.idleWaiters.push(resolve); this.pump(); });
  }

  private mapThrough(changes: Change[]): void {
    this.sel = { anchor: mapCaret(this.sel.anchor, changes), focus: mapCaret(this.sel.focus, changes) };
    for (const [id, c] of this.carets) this.carets.set(id, { at: mapCaret(c.at, changes), length: c.length });
  }

  private typeText(text: string): void {
    const mode = this.editMode;
    if (!mode) return;
    const { from, to } = this.range();
    if (from === to) return this.edit([{ insert: text, at: from }], from + text.length);
    if (mode === "editing") return this.edit([{ delete: to - from, at: from }, { insert: text, at: from }], from + text.length);
    const at = to - this.removedBySuggestingDelete(from, to);
    this.edit([{ delete: to - from, at: from }, { insert: text, at }], at + text.length);
  }

  /** Text physically removed when deleting [from, to) in Suggesting mode (the typist's own insertions). */
  private removedBySuggestingDelete(from: number, to: number): number {
    let removed = 0;
    for (const s of this.sync.view.spans) {
      if (s.authorId !== this.me.personId || s.contentDeleted || s.kind === "delete" || !s.inserted) continue;
      const lo = Math.max(s.inserted.at, from);
      const hi = Math.min(s.inserted.at + s.inserted.length, to);
      if (hi > lo) removed += hi - lo;
    }
    return removed;
  }

  private deleteRange(from: number, to: number, forward: boolean): void {
    const mode = this.editMode;
    if (!mode || to <= from) return;
    if (mode === "editing") return this.edit([{ delete: to - from, at: from }], from);
    const removed = this.removedBySuggestingDelete(from, to);
    this.edit([{ delete: to - from, at: from }], forward ? to - removed : from);
  }

  private backspace(word: boolean, forward: boolean): void {
    const { from, to } = this.range();
    if (from !== to) return this.deleteRange(from, to, forward);
    const text = this.sync.view.text;
    if (forward) return this.deleteRange(from, word ? wordRight(text, from) : Math.min(text.length, from + 1), true);
    return this.deleteRange(word ? wordLeft(text, from) : Math.max(0, from - 1), from, false);
  }

  private toggleMark(type: ToggleMark): void {
    if (this.editMode !== "editing") return;
    const { from, to } = this.range();
    if (from === to) return;
    const on = !this.everyCharHas(type, from, to);
    this.sync.local("editing", [{ mark: type, value: on, at: from, length: to - from }]);
    this.afterFormat();
  }

  private everyCharHas(type: string, from: number, to: number): boolean {
    for (let i = from; i < to; i++) {
      if (!this.sync.view.marks.some((m) => m.type === type && m.at <= i && i < m.at + m.length)) return false;
    }
    return true;
  }

  private setStyle(style: BlockStyle): void {
    if (this.editMode !== "editing") return;
    const { from, to } = this.range();
    const ops: Op[] = blocksOf(this.sync.view).filter((b) => b.at + b.length >= from && b.at <= to && (b.at < to || b.at === from)).map((b) => ({ style, at: b.at }));
    if (!ops.length) return;
    this.sync.local("editing", ops);
    this.afterFormat();
  }

  private setLink(href: string | null): void {
    if (this.editMode !== "editing") return;
    const { from, to } = this.range();
    if (from === to) return;
    this.sync.local("editing", [{ mark: "link", value: href, at: from, length: to - from }]);
    this.afterFormat();
  }

  private afterFormat(): void {
    this.render();
    this.pump();
  }

  // ---------------------------------------------------------------- find and replace

  findText(): string { return this.sync.view.text; }

  canReplace(): boolean { return this.mode !== "viewing" && this.connected; }

  isSuggesting(): boolean { return this.mode === "suggesting"; }

  showHits(hits: number[], length: number, current: number): void {
    this.hits = hits;
    this.hitLength = length;
    this.currentHit = current;
    this.render();
  }

  replaceAt(at: number, length: number, replacement: string): void {
    const mode = this.editMode;
    if (!mode) return;
    const ops: Op[] = mode === "editing"
      ? [{ delete: length, at }, ...(replacement ? [{ insert: replacement, at }] : [])]
      : [{ delete: length, at }, ...(replacement ? [{ insert: replacement, at: at + length }] : [])];
    this.edit(ops, mode === "editing" ? at + replacement.length : at + length + replacement.length);
  }

  async replaceAll(find: string, replace: string, matchCase: boolean): Promise<number | null> {
    const mode = this.editMode;
    if (!mode || !this.live) return null;
    await this.whenIdle();
    const reply = await this.live.request({ type: "replace_all", baseRevision: this.sync.revision, mode, find, replace, matchCase });
    return reply.type === "ack" ? (reply.count as number) : null;
  }

  // ---------------------------------------------------------------- keyboard and input on the page

  private onKeyDown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (e.altKey && e.shiftKey && (key === "ArrowDown" || key === "ArrowUp")) return;
    if (mod && e.altKey && /^Digit[0-3]$/.test(e.code)) {
      e.preventDefault();
      const n = Number(e.code.slice(5));
      this.setStyle(n === 0 ? "paragraph" : (`heading${n}` as BlockStyle));
      return;
    }
    if (mod && e.altKey && e.code === "KeyM") { e.preventDefault(); this.startComment(); return; }
    if (mod && !e.altKey && ["b", "i", "u"].includes(key.toLowerCase())) {
      e.preventDefault();
      this.toggleMark(({ b: "bold", i: "italic", u: "underline" } as const)[key.toLowerCase() as "b" | "i" | "u"]);
      return;
    }
    if (mod && ["z", "y"].includes(key.toLowerCase())) { e.preventDefault(); return; }
    const word = e.ctrlKey || (isMac && e.altKey);
    const text = this.sync.view.text;
    if (key === "ArrowLeft" || key === "ArrowRight") {
      e.preventDefault();
      const right = key === "ArrowRight";
      const { from, to } = this.range();
      let focus: number;
      if (word) focus = right ? wordRight(text, this.sel.focus) : wordLeft(text, this.sel.focus);
      else if (!e.shiftKey && from !== to) focus = right ? to : from;
      else focus = right ? Math.min(text.length, this.sel.focus + 1) : Math.max(0, this.sel.focus - 1);
      this.setSelection(e.shiftKey ? this.sel.anchor : focus, focus);
      return;
    }
    if ((key === "Home" || key === "End") && mod) {
      e.preventDefault();
      const focus = key === "Home" ? 0 : text.length;
      this.setSelection(e.shiftKey ? this.sel.anchor : focus, focus);
      return;
    }
    if ((key === "Home" || key === "End") && !e.altKey) {
      e.preventDefault();
      document.getSelection()?.modify(e.shiftKey ? "extend" : "move", key === "End" ? "forward" : "backward", "lineboundary");
      this.readSelection();
      return;
    }
    if (key === "Enter" && !mod) { e.preventDefault(); this.typeText("\n"); return; }
    if (key === "Backspace" || key === "Delete") {
      e.preventDefault();
      this.backspace(e.ctrlKey || (isMac && e.altKey), key === "Delete");
    }
  }

  private onBeforeInput(e: InputEvent): void {
    e.preventDefault();
    const t = e.inputType;
    if (t === "insertText" || t === "insertReplacementText" || t === "insertCompositionText") {
      const data = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
      if (data) this.typeText(clean(data));
    } else if (t === "insertParagraph" || t === "insertLineBreak") this.typeText("\n");
    else if (t === "deleteContentBackward") this.backspace(false, false);
    else if (t === "deleteContentForward") this.backspace(false, true);
    else if (t === "deleteWordBackward") this.backspace(true, false);
    else if (t === "deleteWordForward") this.backspace(true, true);
  }

  private onPaste(e: ClipboardEvent): void {
    e.preventDefault();
    const text = clean(e.clipboardData?.getData("text/plain") ?? "");
    if (text) this.typeText(text);
  }

  private onCut(e: ClipboardEvent): void {
    const { from, to } = this.range();
    e.preventDefault();
    if (from === to) return;
    e.clipboardData?.setData("text/plain", this.sync.view.text.slice(from, to));
    this.deleteRange(from, to, false);
  }

  private readSelection(): void {
    const s = document.getSelection();
    if (!s || !s.anchorNode || !this.page.contains(s.anchorNode)) return;
    const text = this.sync.view.text.length;
    const anchor = offsetOf(this.page, this.starts, text, s.anchorNode, s.anchorOffset);
    const focus = s.focusNode ? offsetOf(this.page, this.starts, text, s.focusNode, s.focusOffset) : anchor;
    if (anchor === null || focus === null) return;
    if (anchor === this.sel.anchor && focus === this.sel.focus) return;
    this.sel = { anchor, focus };
    this.renderToolbarState();
    this.sendCaret();
  }

  private setSelection(anchor: number, focus: number): void {
    this.sel = { anchor, focus };
    this.placeSelection();
    this.renderToolbarState();
    this.sendCaret();
  }

  private placeSelection(): void {
    if (document.activeElement !== this.page) return;
    const a = pointAt(this.page, this.starts, this.sel.anchor);
    const f = pointAt(this.page, this.starts, this.sel.focus);
    const s = document.getSelection();
    if (!s) return;
    if (s.anchorNode === a.node && s.anchorOffset === a.offset && s.focusNode === f.node && s.focusOffset === f.offset) return;
    s.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
  }

  private sendCaret(): void {
    if (!this.joined || !this.live?.open) return;
    const { from, to } = this.range();
    const key = `${from}:${to}`;
    if (key === this.lastCaret) return;
    this.lastCaret = key;
    void this.live.request({ type: "caret", at: from, length: to - from });
  }

  focusPage(at?: number): void {
    this.page.focus({ preventScroll: at !== undefined });
    if (at !== undefined) this.sel = { anchor: at, focus: at };
    this.placeSelection();
    this.sendCaret();
  }

  revealOffset(at: number): void {
    const rect = caretRect(this.page, this.starts, at);
    if (rect && (rect.top < this.headerHeight() || rect.bottom > window.innerHeight)) {
      window.scrollBy({ top: rect.top - window.innerHeight / 2, behavior: "instant" });
    }
  }

  private headerHeight(): number {
    return this.shell.querySelector(".editor-head")?.getBoundingClientRect().bottom ?? 0;
  }

  // ---------------------------------------------------------------- cards

  private cardModels(): CardModel[] {
    const view = this.sync.view;
    const out: CardModel[] = [];
    const slice = (r: Range | null): string => (r ? view.text.slice(r.at, r.at + r.length) : "");
    for (const s of view.spans) {
      const ranges = [s.inserted, s.deleted].filter((r): r is Range => Boolean(r && r.length > 0));
      const start = ranges.length ? Math.min(...ranges.map((r) => r.at)) : this.lastStart.get(s.id) ?? Number.MAX_SAFE_INTEGER;
      if (ranges.length) this.lastStart.set(s.id, start);
      let text = "Original content deleted";
      if (!s.contentDeleted) {
        if (s.kind === "insert") text = `Insert “${slice(s.inserted)}”`;
        else if (s.kind === "delete") text = `Delete “${slice(s.deleted)}”`;
        else text = `Replace “${slice(s.deleted)}” with “${slice(s.inserted)}”`;
      }
      const author = this.sync.author(s.authorId);
      out.push({ id: s.id, start, range: ranges[0] ?? null, text, card: { id: s.id, kind: s.kind, author, inserted: s.inserted, deleted: s.deleted, contentDeleted: s.contentDeleted, status: "open", createdAt: s.createdAt } });
    }
    for (const c of this.sync.comments.values()) {
      if (c.status === "resolved" && !this.showResolved) continue;
      const anchor = view.anchors.find((a) => a.id === c.id)?.range ?? null;
      const start = anchor ? anchor.at : this.lastStart.get(c.id) ?? Number.MAX_SAFE_INTEGER;
      if (anchor) this.lastStart.set(c.id, start);
      out.push({ id: c.id, start, range: anchor, text: anchor ? slice(anchor) : "Original content deleted", card: c });
    }
    return out.sort((a, b) => a.start - b.start || a.card.createdAt.localeCompare(b.card.createdAt));
  }

  private buildCard(m: CardModel, n: number): HTMLElement {
    const author = m.card.author;
    const colour = this.sync.author(author.personId).colour;
    const person = this.sync.people.get(author.personId) ?? author;
    const head = h("header", { class: "card-head" },
      h("span", { class: "dot", "aria-hidden": "true" }),
      h("span", { class: "who" }, author.displayName),
      h("span", { class: "role" }, ROLE_LABEL[person.role ?? author.role ?? "viewer"]),
      h("span", { class: "num", "aria-hidden": "true" }, String(n)));
    if ("kind" in m.card) {
      const el = h("article", { class: "card s-card", "data-card-id": m.id, tabindex: "-1", "aria-label": `Suggestion by ${author.displayName}`, style: `--ac:${colour}` },
        head, h("p", { class: m.card.contentDeleted ? "card-text gone" : "card-text" }, m.text));
      if (canDecide(this.role) && !isPending(m.id)) {
        const accept = h("button", { type: "button", class: "btn small primary" }, svgIcon(ICONS.check), "Accept");
        const reject = h("button", { type: "button", class: "btn small" }, svgIcon(ICONS.x), "Reject");
        accept.addEventListener("click", () => void this.decide(m.id, "accept"));
        reject.addEventListener("click", () => void this.decide(m.id, "reject"));
        el.append(h("div", { class: "card-actions" }, accept, reject));
      }
      return el;
    }
    const c = m.card as Comment;
    const el = h("article", { class: c.status === "resolved" ? "card c-card resolved" : "card c-card", "data-card-id": m.id, tabindex: "-1", "aria-label": `Comment by ${author.displayName}`, style: `--ac:${colour}` },
      head,
      h("blockquote", { class: m.range ? "quote" : "quote gone" }, m.text),
      h("p", { class: "card-body" }, c.body),
      c.status === "resolved" ? h("p", { class: "state-tag" }, "Resolved") : null,
      c.replies.length ? h("ol", { class: "replies" }, ...c.replies.map((r) => h("li", {}, h("span", { class: "who", style: `--ac:${this.sync.author(r.author.personId).colour}` }, r.author.displayName), " ", h("span", {}, r.body)))) : null);
    if (canComment(this.role)) {
      let reply = this.replyDrafts.get(c.id);
      if (!reply) { reply = autoGrow(h("textarea", { "aria-label": "Reply", rows: "1", class: "reply-box", placeholder: "Reply" })); this.replyDrafts.set(c.id, reply); }
      const send = h("button", { type: "button", class: "btn small" }, "Reply");
      const box = reply;
      send.addEventListener("click", () => void this.postReply(c.id, box, send));
      const toggle = h("button", { type: "button", class: "btn small" }, c.status === "resolved" ? "Reopen" : "Resolve");
      toggle.addEventListener("click", () => void this.setCommentStatus(c.id, c.status === "resolved" ? "reopen" : "resolve"));
      el.append(h("div", { class: "reply-row" }, reply, send), h("div", { class: "card-actions" }, toggle));
    }
    return el;
  }

  private async decide(id: string, decision: "accept" | "reject"): Promise<void> {
    if (!this.live) return;
    const reply = await this.live.request({ type: "decide", suggestionId: id, decision });
    if (reply.type === "ack" && reply.applied === true) announce(decision === "accept" ? "Suggestion accepted" : "Suggestion rejected");
  }

  private async postReply(id: string, box: HTMLTextAreaElement, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    button.textContent = "Posting";
    box.parentElement?.querySelector(".field-error")?.remove();
    try {
      await api("POST", `/api/documents/${encodeURIComponent(this.documentId)}/comments`, { body: box.value, mentions: [], parentId: id });
      box.value = "";
      box.style.height = "";
      announce("Reply posted");
    } catch (e) {
      if (e instanceof HttpError && e.fields.body) {
        box.parentElement?.after(h("p", { class: "field-error" }, e.fields.body));
        box.focus();
      }
    } finally {
      button.disabled = false;
      button.textContent = "Reply";
    }
  }

  private async setCommentStatus(id: string, action: "resolve" | "reopen"): Promise<void> {
    try {
      await api("POST", `/api/documents/${encodeURIComponent(this.documentId)}/comments/${encodeURIComponent(id)}/${action}`, {});
      announce(action === "resolve" ? "Comment resolved" : "Comment reopened");
    } catch { /* 409: the card shows its current state */ }
  }

  private focusCardEl(id: string): void {
    const el = this.margin.card(id);
    if (!el) return;
    if (this.media.phone.matches) this.openSheet(null);
    el.focus({ preventScroll: true });
    this.ensureVisible(id, el);
  }

  private ensureVisible(id: string, el: HTMLElement): void {
    const top = this.headerHeight();
    const range = this.page.querySelector(`[data-anchor-for="${CSS.escape(id)}"]`);
    const r = el.getBoundingClientRect();
    const a = range?.getBoundingClientRect();
    if (this.media.phone.matches) { if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "nearest", behavior: "instant" }); return; }
    const lo = Math.min(r.top, a?.top ?? r.top);
    const hi = Math.max(r.bottom, a?.bottom ?? r.bottom);
    if (lo < top) window.scrollBy({ top: lo - top - 16, behavior: "instant" });
    else if (hi > window.innerHeight) window.scrollBy({ top: Math.min(hi - window.innerHeight + 16, lo - top - 16), behavior: "instant" });
  }

  /** Card-cycle shortcuts (DP-47): next or previous card in page order, from anywhere on the editor page. */
  private cycleCard(dir: 1 | -1): void {
    const models = this.cardModels();
    if (!models.length) return;
    const ids = models.map((m) => m.id);
    const current = (document.activeElement as HTMLElement | null)?.closest("[data-card-id]")?.getAttribute("data-card-id");
    let next: string;
    if (current && ids.includes(current)) next = ids[(ids.indexOf(current) + dir + ids.length) % ids.length];
    else {
      const caret = this.range().from;
      next = dir > 0 ? (models.find((m) => m.start >= caret) ?? models[0]).id : ([...models].reverse().find((m) => m.start < caret) ?? models[models.length - 1]).id;
    }
    this.focusCardEl(next);
  }

  private onCardKey(e: KeyboardEvent): void {
    const card = (e.target as HTMLElement).closest<HTMLElement>("[data-card-id]");
    if (!card) return;
    const id = card.dataset.cardId as string;
    if (e.key === "Enter" && e.target === card && card.classList.contains("s-card") && canDecide(this.role) && !isPending(id)) {
      e.preventDefault();
      void this.decide(id, "accept");
      return;
    }
    if (e.key === "Escape" && e.target === card) {
      e.preventDefault();
      this.sheetHandle?.();
      const start = this.cardModels().find((m) => m.id === id)?.range?.at ?? this.sel.focus;
      this.focusPage(start);
    }
  }

  // ---------------------------------------------------------------- comments draft and mentions

  private startComment(): void {
    if (!canComment(this.role) || !this.connected) return;
    const { from, to } = this.range();
    if (from === to) { announce("Select the text this comment is about."); return; }
    this.draft?.remove();
    const anchor = { at: from, length: to - from };
    const box = autoGrow(h("textarea", { "aria-label": "Comment", id: "draft-comment", rows: "3", class: "comment-box", placeholder: "Comment, or @ to mention" }));
    const picker = h("div", { role: "listbox", "aria-label": "Mention people", class: "mentions", hidden: true, id: "mention-list" });
    const post = h("button", { type: "button", class: "btn small primary" }, "Post");
    const cancel = h("button", { type: "button", class: "btn small quiet" }, "Cancel");
    const error = h("p", { class: "field-error", id: "draft-error", hidden: true });
    const draft = h("div", { class: "card draft", style: `--ac:${this.me.colour}` },
      h("header", { class: "card-head" }, h("span", { class: "dot" }), h("span", { class: "who" }, this.me.displayName), h("span", { class: "role" }, ROLE_LABEL[this.role])),
      h("blockquote", { class: "quote" }, this.sync.view.text.slice(from, to)),
      box, picker, error, h("div", { class: "card-actions" }, post, cancel));
    this.draft = draft;
    let people: Person[] = [];
    const picked = new Map<string, string>();
    let options: Person[] = [];
    let active = 0;
    void api<{ people: Person[] }>("GET", `/api/documents/${encodeURIComponent(this.documentId)}/people`).then((r) => { people = r.people; refreshPicker(); }).catch(() => undefined);
    const query = (): string | null => {
      const before = box.value.slice(0, box.selectionStart ?? box.value.length);
      const m = /(^|\s)@([^\s@]*)$/.exec(before);
      return m ? m[2] : null;
    };
    const refreshPicker = (): void => {
      const q = query();
      options = q === null ? [] : people.filter((p) => p.displayName.toLowerCase().includes(q.toLowerCase()));
      picker.hidden = !options.length;
      box.setAttribute("aria-expanded", String(!picker.hidden));
      active = Math.min(active, Math.max(0, options.length - 1));
      picker.replaceChildren(...options.map((p, i) => {
        const o = h("div", { role: "option", id: `mention-${i}`, "aria-selected": String(i === active), class: "mention-option" },
          h("span", { class: "dot", style: `--ac:${p.colour}`, "aria-hidden": "true" }), `${p.displayName} · ${ROLE_LABEL[p.role ?? "viewer"]}`);
        o.addEventListener("mousedown", (e) => { e.preventDefault(); choose(p); });
        return o;
      }));
      if (options.length) box.setAttribute("aria-activedescendant", `mention-${active}`); else box.removeAttribute("aria-activedescendant");
    };
    const choose = (p: Person): void => {
      const caret = box.selectionStart ?? box.value.length;
      const before = box.value.slice(0, caret).replace(/@([^\s@]*)$/, `@${p.displayName} `);
      box.value = before + box.value.slice(caret);
      box.setSelectionRange(before.length, before.length);
      picked.set(p.personId, p.displayName);
      options = [];
      picker.hidden = true;
      box.focus();
    };
    box.setAttribute("aria-controls", "mention-list");
    box.addEventListener("input", refreshPicker);
    box.addEventListener("keydown", (e) => {
      if (!picker.hidden && options.length) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          active = (active + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
          refreshPicker();
          return;
        }
        if (e.key === "Enter") { e.preventDefault(); choose(options[active]); return; }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); picker.hidden = true; options = []; return; }
      }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    });
    const close = (restore: boolean): void => {
      draft.remove();
      if (this.draft === draft) this.draft = null;
      if (restore) { this.page.focus({ preventScroll: true }); this.sel = { anchor: anchor.at, focus: anchor.at + anchor.length }; this.placeSelection(); }
    };
    cancel.addEventListener("click", () => close(true));
    post.addEventListener("click", async () => {
      post.disabled = true;
      post.textContent = "Posting";
      error.hidden = true;
      box.removeAttribute("aria-invalid");
      try {
        await this.whenIdle();
        const mentions = [...picked].filter(([, name]) => box.value.includes(`@${name}`)).map(([id]) => id);
        await api("POST", `/api/documents/${encodeURIComponent(this.documentId)}/comments`, { anchor, body: box.value, mentions });
        announce("Comment posted");
        close(false);
      } catch (e) {
        post.disabled = false;
        post.textContent = "Post";
        if (e instanceof HttpError && Object.keys(e.fields).length) {
          error.textContent = e.fields.body ?? e.fields.anchor ?? e.fields.mentions ?? "";
          error.hidden = false;
          box.setAttribute("aria-invalid", "true");
          box.setAttribute("aria-describedby", "draft-error");
          box.focus();
        }
      }
    });
    if (this.media.phone.matches) {
      this.cardsHost.before(draft);
      this.openSheet(null);
    } else {
      this.marginEl.append(draft);
      const rects = this.page.querySelectorAll(".blk");
      const pt = caretRect(this.page, this.starts, from);
      const top = (pt?.top ?? rects[0]?.getBoundingClientRect().top ?? 0) - this.marginEl.getBoundingClientRect().top;
      draft.style.top = `${Math.max(0, top)}px`;
    }
    box.focus({ preventScroll: true });
    draft.scrollIntoView({ block: "nearest", behavior: "instant" });
  }

  // ---------------------------------------------------------------- dialogs

  private openShare(opener: HTMLElement): void {
    this.share?.destroy();
    this.share = new ShareDialog(this.documentId, isOwner(this.role));
    void this.share.show(opener);
  }

  private openDecideAll(decision: "accept" | "reject", opener: HTMLElement): void {
    if (!canDecide(this.role)) return;
    const count = this.sync.view.spans.filter((s) => !isPending(s.id)).length;
    const verb = decision === "accept" ? "Accept all" : "Reject all";
    const confirm = h("button", { type: "button", class: decision === "accept" ? "btn primary" : "btn danger" }, verb);
    const cancel = h("button", { type: "button", class: "btn quiet" }, "Cancel");
    const id = `decide-all-${decision}`;
    const dialog = h("dialog", { class: "dialog", role: "alertdialog", "aria-labelledby": `${id}-t`, "aria-describedby": `${id}-d` },
      h("h2", { id: `${id}-t`, class: "dialog-title" }, `${verb} suggestions`),
      h("p", { id: `${id}-d` }, `${decision === "accept" ? "Accept" : "Reject"} ${plural(count, "open suggestion", "open suggestions")}? Cards that are still open when Quillmere processes this are settled; text you have not read is ${decision === "accept" ? "kept" : "dropped"} too.`),
      h("div", { class: "dialog-actions" }, cancel, confirm));
    const handle = openDialog(dialog, { opener, focus: cancel, onClose: () => { dialog.remove(); this.dialogs = this.dialogs.filter((d) => d !== handle); } });
    this.dialogs.push(handle);
    cancel.addEventListener("click", () => handle());
    confirm.addEventListener("click", async () => {
      if (!this.live) return;
      confirm.disabled = true;
      cancel.disabled = true;
      confirm.textContent = decision === "accept" ? "Accepting" : "Rejecting";
      await this.whenIdle();
      const reply = await this.live.request({ type: "decide_all", decision });
      if (reply.type === "ack") {
        const n = reply.count as number;
        announce(`${plural(n, "suggestion", "suggestions")} ${decision === "accept" ? "accepted" : "rejected"}`);
      }
      handle();
    });
  }

  private openLink(opener: HTMLElement): void {
    if (this.editMode !== "editing") return;
    const { from, to } = this.range();
    const current = this.sync.view.marks.find((m) => m.type === "link" && m.at <= from && from < m.at + m.length);
    const input = h("input", { id: "link-address", type: "url", value: current?.href ?? "https://", autocomplete: "off" });
    const apply = h("button", { type: "submit", class: "btn primary" }, "Apply");
    const remove = h("button", { type: "button", class: "btn" }, "Remove link");
    const cancel = h("button", { type: "button", class: "btn quiet" }, "Cancel");
    const error = h("p", { class: "field-error", hidden: true }, "Enter an address starting with http:// or https://.");
    const form = h("form", { novalidate: true }, h("div", { class: "field" }, h("label", { for: "link-address" }, "Link address"), input, error), h("div", { class: "dialog-actions" }, cancel, remove, apply));
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "link-title" }, h("h2", { id: "link-title", class: "dialog-title" }, "Link"), form);
    const restore = (): void => { this.page.focus({ preventScroll: true }); this.sel = { anchor: from, focus: to }; this.placeSelection(); };
    const handle = openDialog(dialog, { opener, focus: input, onClose: () => { dialog.remove(); this.dialogs = this.dialogs.filter((d) => d !== handle); }, restore });
    this.dialogs.push(handle);
    cancel.addEventListener("click", () => handle());
    remove.addEventListener("click", () => { this.sel = { anchor: from, focus: to }; this.setLink(null); handle(); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!/^https?:\/\/\S+$/i.test(input.value.trim())) { error.hidden = false; input.focus(); return; }
      this.sel = { anchor: from, focus: to };
      this.setLink(input.value.trim());
      handle();
    });
  }

  private openOutlineDialog(opener: HTMLElement): void {
    const list = h("div", { role: "listbox", "aria-label": "Headings", tabindex: "0", class: "headings" });
    const close = h("button", { type: "button", class: "btn quiet" }, "Close");
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "outline-title" }, h("h2", { id: "outline-title", class: "dialog-title" }, "Outline"), list, h("div", { class: "dialog-actions" }, close));
    const handle = openDialog(dialog, { opener, focus: list, onClose: () => { dialog.remove(); this.dialogs = this.dialogs.filter((d) => d !== handle); } });
    this.dialogs.push(handle);
    close.addEventListener("click", () => handle());
    this.fillOutline(list, (at) => { handle(); this.jumpTo(at); });
  }

  private openStyleDialog(opener: HTMLElement): void {
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "style-title" }, h("h2", { id: "style-title", class: "dialog-title" }, "Paragraph style"));
    const { from, to } = this.range();
    const handle = openDialog(dialog, {
      opener, onClose: () => { dialog.remove(); this.dialogs = this.dialogs.filter((d) => d !== handle); },
      restore: () => { this.page.focus({ preventScroll: true }); this.sel = { anchor: from, focus: to }; this.placeSelection(); },
    });
    this.dialogs.push(handle);
    const list = h("div", { class: "style-list" }, ...BLOCK_STYLES.map((s) => {
      const b = h("button", { type: "button", class: "btn wide" }, STYLE_LABEL[s]);
      b.addEventListener("click", () => { this.sel = { anchor: from, focus: to }; this.setStyle(s); handle(); });
      return b;
    }));
    const cancel = h("button", { type: "button", class: "btn quiet" }, "Cancel");
    cancel.addEventListener("click", () => handle());
    dialog.append(list, h("div", { class: "dialog-actions" }, cancel));
    (list.firstElementChild as HTMLElement | null)?.focus();
  }

  private openSheet(opener: HTMLElement | null): void {
    if (this.sheet.inert) { this.sheet.getAnimations().forEach((a) => a.cancel()); this.sheet.close(); this.sheet.inert = false; }
    if (this.sheetHandle) return;
    this.sheetHandle = openDialog(this.sheet, { opener: opener ?? (document.activeElement as HTMLElement | null), focus: this.sheet.querySelector<HTMLElement>(".sheet-close"), onClose: () => { this.sheetHandle = null; } });
    if (!reducedMotion()) this.sheet.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], { duration: 333, easing: "cubic-bezier(.2,.8,.2,1)" });
  }

  private closeSheet(): void {
    const handle = this.sheetHandle;
    if (!handle) return;
    handle();
    if (reducedMotion()) return;
    this.sheet.inert = true;
    this.sheet.show();
    this.sheet.animate([{ transform: "translateY(0)" }, { transform: "translateY(100%)" }], { duration: 333, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" })
      .finished.then(() => {
        if (!this.sheet.inert) return;
        this.sheet.close();
        this.sheet.inert = false;
        this.sheet.getAnimations().forEach((a) => a.cancel());
      }, () => undefined);
  }

  private openMenu(): void {
    this.menu.hidden = false;
    this.menuButton.setAttribute("aria-expanded", "true");
    this.menuItems()[0]?.focus();
  }

  private closeMenu(restore: boolean): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.menuButton.setAttribute("aria-expanded", "false");
    if (restore) this.menuButton.focus();
  }

  private menuItems(): HTMLElement[] {
    return [...this.menu.querySelectorAll<HTMLElement>("[role=menuitem]")];
  }

  // ---------------------------------------------------------------- outline

  private fillOutline(list: HTMLElement, pick: (at: number) => void): void {
    const items = blocksOf(this.sync.view).filter((b) => HEADINGS.includes(b.style));
    const prev = Number(list.dataset.active ?? "0");
    const active = Math.min(prev, Math.max(0, items.length - 1));
    list.dataset.active = String(active);
    const id = list.closest("dialog") ? "dlg-h" : "rail-h";
    list.replaceChildren(...items.map((b, i) => {
      const o = h("div", { role: "option", id: `${id}-${i}`, class: `heading-option lvl-${b.style}`, "aria-selected": String(i === active) }, this.sync.view.text.slice(b.at, b.at + b.length) || "Untitled heading");
      o.addEventListener("click", () => pick(b.at));
      return o;
    }));
    if (items.length) list.setAttribute("aria-activedescendant", `${id}-${active}`); else list.removeAttribute("aria-activedescendant");
    list.onkeydown = (e: KeyboardEvent) => {
      const n = items.length;
      if (!n) return;
      let i = Number(list.dataset.active ?? "0");
      if (e.key === "ArrowDown") i = Math.min(n - 1, i + 1);
      else if (e.key === "ArrowUp") i = Math.max(0, i - 1);
      else if (e.key === "Home") i = 0;
      else if (e.key === "End") i = n - 1;
      else if (e.key === "Enter") { e.preventDefault(); pick(items[i].at); return; }
      else return;
      e.preventDefault();
      list.dataset.active = String(i);
      for (const [k, o] of [...list.children].entries()) o.setAttribute("aria-selected", String(k === i));
      list.setAttribute("aria-activedescendant", `${id}-${i}`);
      list.children[i]?.scrollIntoView({ block: "nearest" });
    };
  }

  private jumpTo(at: number): void {
    this.setOutlineOpen(false, false);
    this.page.focus({ preventScroll: true });
    this.sel = { anchor: at, focus: at };
    this.placeSelection();
    this.sendCaret();
    this.renderToolbarState();
    const rect = caretRect(this.page, this.starts, at);
    if (rect) window.scrollBy({ top: rect.top - this.headerHeight() - 24, behavior: "instant" });
  }

  private setOutlineOpen(open: boolean, restore: boolean): void {
    this.outlineButton.setAttribute("aria-expanded", String(open));
    this.outline.classList.toggle("open", open);
    if (!open && restore) this.outlineButton.focus();
  }

  // ---------------------------------------------------------------- build

  private build(): void {
    const owner = isOwner(this.role);
    this.titleEl = owner
      ? h("input", { type: "text", class: "title-input", "aria-label": "Proposal title", value: this.title, maxlength: "120" })
      : h("h1", { class: "title-heading" }, this.title);
    if (this.titleEl instanceof HTMLInputElement) {
      const input = this.titleEl;
      const save = async (): Promise<void> => {
        const next = input.value.trim();
        if (!next || next === this.title) { input.value = this.title; return; }
        try {
          await api("PATCH", `/api/documents/${encodeURIComponent(this.documentId)}`, { title: next });
          this.title = next;
        } catch { input.value = this.title; }
      };
      input.addEventListener("change", () => void save());
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
    }
    for (const m of ["editing", "suggesting", "viewing"] as Mode[]) {
      const radio = h("input", { type: "radio", name: "mode", value: m, id: `mode-${m}` });
      radio.addEventListener("change", () => { if (radio.checked) void this.changeMode(m); });
      this.radios.set(m, radio);
      this.modeGroup.append(h("label", { class: "mode-option", for: `mode-${m}` }, radio, h("span", {}, MODE_LABEL[m])));
    }
    const shareButton = h("button", { type: "button", class: "chrome-btn share-btn" }, svgIcon(ICONS.share), h("span", { class: "label" }, "Share"));
    shareButton.addEventListener("click", () => this.openShare(shareButton));

    for (const type of TOGGLE_MARKS) {
      const label = type[0].toUpperCase() + type.slice(1);
      const b = h("button", { type: "button", class: "tool icon-only", "aria-label": label, "aria-pressed": "false", title: `${label} (${isMac ? "⌘" : "Ctrl+"}${label[0]})` }, svgIcon(ICONS[type]));
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => this.toggleMark(type));
      this.markButtons.set(type, b);
    }
    const tool = (name: string, icon: string, run: (b: HTMLButtonElement) => void, iconOnly = false): HTMLButtonElement => {
      const b = h("button", { type: "button", class: iconOnly ? "tool icon-only" : "tool", "aria-label": iconOnly ? name : null, title: iconOnly ? name : null }, svgIcon(icon), iconOnly ? null : h("span", {}, name));
      b.addEventListener("mousedown", (e) => { if (b !== this.toolButtons.find) e.preventDefault(); });
      b.addEventListener("click", () => run(b));
      this.toolButtons[name === "Find and replace" ? "find" : name] = b;
      return b;
    };
    this.styleSelect.addEventListener("change", () => { this.setStyle(this.styleSelect.value as BlockStyle); this.focusPage(); });
    this.toolbar.append(
      h("div", { class: "tool-group" }, ...this.markButtons.values(), tool("Link", ICONS.link, (b) => this.openLink(b), true)),
      h("div", { class: "tool-group" }, h("span", { class: "select-wrap" }, this.styleSelect, svgIcon(ICONS.chevron))),
      h("div", { class: "tool-group" }, tool("Comment", ICONS.comment, () => this.startComment()), tool("Find and replace", ICONS.search, (b) => this.find.show(b))),
      h("div", { class: "tool-group" }, tool("Accept all", ICONS.checks, (b) => this.openDecideAll("accept", b)), tool("Reject all", ICONS.x, (b) => this.openDecideAll("reject", b))));

    const menuEntries: [string, (opener: HTMLElement) => void][] = [
      ["Bold", () => this.toggleMark("bold")], ["Italic", () => this.toggleMark("italic")], ["Underline", () => this.toggleMark("underline")],
      ["Link", (o) => this.openLink(o)], ["Paragraph style", (o) => this.openStyleDialog(o)], ["Comment", () => this.startComment()],
      ["Find and replace", (o) => this.find.show(o)], ["Accept all", (o) => this.openDecideAll("accept", o)], ["Reject all", (o) => this.openDecideAll("reject", o)],
      ["Outline", (o) => this.openOutlineDialog(o)], ["Share", (o) => this.openShare(o)],
    ];
    this.menu.append(...menuEntries.map(([name, run]) => {
      const item = h("button", { type: "button", role: "menuitem", tabindex: "-1", class: "menu-item", "data-name": name }, name);
      item.addEventListener("click", () => { this.closeMenu(false); run(this.menuButton); });
      return item;
    }));
    this.menuButton.addEventListener("click", () => (this.menu.hidden ? this.openMenu() : this.closeMenu(true)));
    this.menu.addEventListener("keydown", (e) => {
      const items = this.menuItems().filter((i) => !i.hasAttribute("disabled"));
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
      else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
      else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.closeMenu(true); }
      else if (e.key === "Tab") this.closeMenu(false);
    });
    const outside = (e: Event): void => { if (!this.menu.hidden && !this.menu.contains(e.target as Node) && !this.menuButton.contains(e.target as Node)) this.closeMenu(false); };
    document.addEventListener("pointerdown", outside);
    this.cleanups.push(() => document.removeEventListener("pointerdown", outside));

    this.outlineButton.addEventListener("click", () => {
      const open = this.outlineButton.getAttribute("aria-expanded") !== "true";
      this.setOutlineOpen(open, false);
    });
    this.sheetButton.addEventListener("click", () => this.openSheet(this.sheetButton));

    // the page
    this.page.addEventListener("keydown", (e) => this.onKeyDown(e));
    this.page.addEventListener("beforeinput", (e) => this.onBeforeInput(e));
    this.page.addEventListener("paste", (e) => this.onPaste(e));
    this.page.addEventListener("cut", (e) => this.onCut(e));
    this.page.addEventListener("drop", (e) => e.preventDefault());
    this.page.addEventListener("click", (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-marker-for]");
      if (chip) { e.preventDefault(); this.chipOpen(chip); return; }
      const anchor = (e.target as HTMLElement).closest<HTMLElement>("[data-anchor-for]");
      if (anchor && document.getSelection()?.isCollapsed && !this.media.phone.matches) {
        const id = anchor.dataset.anchorFor as string;
        const el = this.margin.card(id);
        if (el) el.focus({ preventScroll: true });
      }
    });
    this.page.addEventListener("keydown", (e) => {
      const chip = (e.target as HTMLElement).closest?.("[data-marker-for]");
      if (chip && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); this.chipOpen(chip as HTMLElement); }
    }, true);
    const onSelection = (): void => { if (!this.finished) this.readSelection(); };
    document.addEventListener("selectionchange", onSelection);
    this.cleanups.push(() => document.removeEventListener("selectionchange", onSelection));

    // cards
    const cardsEvents = (host: HTMLElement): void => {
      host.addEventListener("keydown", (e) => this.onCardKey(e));
      host.addEventListener("focusin", (e) => {
        const id = (e.target as HTMLElement).closest<HTMLElement>("[data-card-id]")?.dataset.cardId ?? null;
        if (id !== this.focusedCard) { this.focusedCard = id; this.margin.setFocused(id); }
      });
      host.addEventListener("focusout", (e) => {
        const next = (e.relatedTarget as HTMLElement | null)?.closest?.("[data-card-id]")?.getAttribute("data-card-id") ?? null;
        if (next !== this.focusedCard) { this.focusedCard = next; this.margin.setFocused(next); }
      });
      host.addEventListener("click", (e) => {
        const card = (e.target as HTMLElement).closest<HTMLElement>("[data-card-id]");
        if (card && !(e.target as HTMLElement).closest("button, textarea, input, a")) card.focus({ preventScroll: true });
      });
    };
    cardsEvents(this.cardsHost);
    const resolved = h("input", { type: "checkbox", id: "show-resolved" });
    resolved.addEventListener("change", () => { this.showResolved = resolved.checked; this.render(); });
    this.marginEl.append(h("div", { class: "margin-head" }, h("span", { class: "margin-title" }, "Margin notes"), h("div", { class: "check-row" }, resolved, h("label", { for: "show-resolved" }, "Show resolved"))), this.cardsHost);

    // sheet (phone)
    const sheetClose = h("button", { type: "button", class: "btn quiet sheet-close" }, "Close");
    sheetClose.addEventListener("click", () => this.closeSheet());
    const grab = h("div", { class: "grab", "aria-hidden": "true" }, h("span"));
    let startY: number | null = null;
    grab.addEventListener("pointerdown", (e) => { startY = e.clientY; grab.setPointerCapture(e.pointerId); });
    grab.addEventListener("pointerup", (e) => { if (startY !== null && e.clientY - startY > 48) this.closeSheet(); startY = null; });
    this.sheet.append(grab, h("div", { class: "sheet-head" }, h("h2", { id: "sheet-title" }, "Comments and suggestions"), sheetClose), h("div", { class: "sheet-body" }));

    // global shortcuts
    const onKey = (e: KeyboardEvent): void => {
      if (this.finished) return;
      const modalOpen = document.querySelector("dialog[open]:not(.sheet)");
      if (e.altKey && e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp") && !modalOpen) {
        e.preventDefault();
        this.cycleCard(e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f" && !modalOpen && this.shell.contains(document.activeElement)) {
        e.preventDefault();
        const fromPage = document.activeElement === this.page;
        this.find.show(fromPage ? null : (document.activeElement as HTMLElement));
        return;
      }
      if (e.key === "Escape" && this.outline.classList.contains("open") && !modalOpen) {
        e.preventDefault();
        this.setOutlineOpen(false, true);
      }
    };
    document.addEventListener("keydown", onKey, true);
    this.cleanups.push(() => document.removeEventListener("keydown", onKey, true));

    const relayout = (): void => { if (!this.finished) { this.placeCards(); this.render(); } };
    for (const q of [this.media.phone, this.media.desktop]) {
      q.addEventListener("change", relayout);
      this.cleanups.push(() => q.removeEventListener("change", relayout));
    }
    const onResize = (): void => { if (!this.finished) { this.syncHeader(); this.margin.layout(); this.renderCarets(); } };
    window.addEventListener("resize", onResize);
    this.cleanups.push(() => window.removeEventListener("resize", onResize));

    this.outline.append(h("p", { class: "rail-title", "aria-hidden": "true" }, "Outline"), this.headings);
    const head = h("div", { class: "editor-head" },
      h("header", { class: "menubar" },
        h("a", { href: "/", "data-route": true, class: "chrome-link" }, svgIcon(ICONS.back), h("span", {}, "Documents")),
        h("div", { class: "title-wrap" }, this.titleEl),
        this.peopleList,
        h("div", { class: "menubar-actions" }, shareButton, this.notices.button),
        this.modeGroup),
      h("div", { class: "toolrow" }, this.outlineButton, this.toolbar, h("div", { class: "menu-wrap" }, this.menuButton, this.menu)),
      h("section", { "aria-label": "Document status", class: "statusbar" }, this.saveEl, this.wordsEl, this.untilEl, this.sheetButton),
      this.banners);
    const work = h("div", { class: "work" },
      this.outline,
      h("div", { class: "sheet-wrap" }, this.page, this.caretLayer),
      this.marginEl);
    work.append(this.svg);
    this.shell.replaceChildren(head, h("main", { class: "desk" }, work));
    document.body.append(this.sheet);
    this.placeCards();
    this.syncHeader();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => { if (!this.finished) { this.syncHeader(); this.margin.layout(); this.renderCarets(); } });
      ro.observe(head);
      ro.observe(this.page);
      this.cleanups.push(() => ro.disconnect());
    }
    this.renderStatus(true);
  }

  /** The cards live in the Margin from 768 px and in the bottom sheet below it. */
  private placeCards(): void {
    const phone = this.media.phone.matches;
    this.margin.stacked = !phone;
    const target = phone ? this.sheet.querySelector(".sheet-body") : this.marginEl;
    if (target && this.cardsHost.parentElement !== target) target.append(this.cardsHost);
    if (!phone) this.sheetHandle?.();
    if (!phone) this.closeMenu(false);
    const wrap = this.menuButton.parentElement;
    const host = phone ? this.modeGroup.parentElement : this.toolbar.parentElement;
    if (wrap && host && wrap.parentElement !== host) host.append(wrap);
    if (this.media.desktop.matches) this.setOutlineOpen(false, false);
  }

  private syncHeader(): void {
    const head = this.shell.querySelector(".editor-head");
    if (head) document.documentElement.style.setProperty("--head-h", `${Math.ceil(head.getBoundingClientRect().height)}px`);
  }

  private async changeMode(mode: Mode): Promise<void> {
    if (!modesFor(this.role).includes(mode) || !this.live) return;
    this.mode = mode;
    this.renderChromeState();
    this.find.setReplaceAllowed(this.mode !== "viewing");
    if (!this.joined) { this.chosenMode = mode; return; }
    const reply = await this.live.request({ type: "mode", mode });
    if (reply.type !== "ack") { this.renderChromeState(); }
  }

  private chipOpen(chip: HTMLElement): void {
    const id = chip.dataset.markerFor as string;
    this.openSheet(chip);
    const el = this.margin.card(id);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }

  private animateInk(): void {
    if (!this.ink.length) return;
    this.ink = [];
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
    for (const s of this.page.querySelectorAll<HTMLElement>(".ink-settle")) {
      const from = s.style.getPropertyValue("--ac");
      s.animate([{ color: from }, { color: ink }], { duration: 250, easing: "cubic-bezier(.2,.8,.2,1)" });
    }
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    if (this.finished || !this.titleEl) return;
    const view = this.sync.view;
    const phone = this.media.phone.matches;
    const models = this.cardModels();
    const covers: Cover[] = [];
    for (const s of view.spans) {
      const colour = this.sync.author(s.authorId).colour;
      if (s.inserted && s.inserted.length) covers.push({ id: s.id, range: s.inserted, kind: "ins", colour });
      if (s.deleted && s.deleted.length) covers.push({ id: s.id, range: s.deleted, kind: "del", colour });
    }
    for (const m of models) {
      if (!("kind" in m.card) && m.range) covers.push({ id: m.id, range: m.range, kind: "cmt", colour: this.sync.author(m.card.author.personId).colour });
    }
    const chips = phone ? models.flatMap((m, i) => {
      const ranges = "kind" in m.card ? [m.card.inserted, m.card.deleted].filter((r): r is Range => Boolean(r && r.length)) : m.range ? [m.range] : [];
      if (!ranges.length) return [];
      let at = Math.max(...ranges.map((r) => r.at + r.length));
      if (view.text[at - 1] === "\n") at -= 1;
      return [{ id: m.id, at, n: i + 1, colour: this.sync.author(m.card.author.personId).colour }];
    }) : [];
    const hadFocus = document.activeElement === this.page;
    this.starts = renderPage(this.page, view, { covers, focused: this.focusedCard, hits: this.hits, hitLength: this.hitLength, currentHit: this.currentHit, chips, ink: this.ink });
    this.page.setAttribute("aria-readonly", String(this.editMode === null));
    this.margin.update(models.map((m, i) => ({
      id: m.id,
      colour: this.sync.author(m.card.author.personId).colour,
      hasRange: Boolean(m.range),
      signature: JSON.stringify([m.text, this.role, "kind" in m.card ? m.card.kind : (m.card as Comment).status, "kind" in m.card ? "" : (m.card as Comment).replies.length,
        m.card.author.personId, this.sync.people.get(m.card.author.personId)?.role ?? "", this.connected]),
      build: () => this.buildCard(m, i + 1),
    })));
    models.forEach((m, i) => { const num = this.margin.card(m.id)?.querySelector(".num"); if (num) setText(num, String(i + 1)); });
    this.margin.setFocusedSilently(this.focusedCard);
    this.margin.layout();
    if (hadFocus) this.placeSelection();
    this.renderCarets();
    this.fillOutline(this.headings, (at) => this.jumpTo(at));
    setText(this.wordsEl, plural(wordCount(view), "word", "words"));
    setText(this.untilEl, this.accessEndsAt ? `Access until ${formatWhen(this.accessEndsAt)}` : "");
    this.untilEl.hidden = !this.accessEndsAt;
    const open = models.length;
    this.sheetButton.replaceChildren(svgIcon(ICONS.cards), h("span", { class: "label" }, "Comments and suggestions"), h("span", { class: "count" }, String(open)));
    this.sheetButton.title = `${plural(open, "open card", "open cards")}`;
    this.renderPeople();
    this.renderChromeState();
    this.renderStatus();
  }

  private renderStatus(first = false): void {
    const text = { saved: "All changes saved", saving: "Saving", failed: "Not saved" }[this.saveStatus];
    if (first) this.saveEl.textContent = text;
    else setText(this.saveEl, text);
    this.saveEl.dataset.state = this.saveStatus;
    this.renderBanners();
  }

  private renderBanners(): void {
    const want: string[] = [];
    if (this.saveStatus === "failed") want.push("Your latest edits are not saved. Quillmere can't reach storage and is retrying.");
    if (!this.connected) want.push("Connection lost. Reconnecting.");
    const have = [...this.banners.children].map((c) => c.textContent);
    if (have.join("|") === want.join("|")) return;
    this.banners.replaceChildren(...want.map((t) => h("div", { role: "alert", class: "banner" }, t)));
    this.syncHeader();
  }

  private renderPeople(): void {
    const entries: { person: Person; state: string }[] = [{ person: { ...this.me, role: this.role }, state: "active" }, ...this.presence.values()];
    const sig = JSON.stringify(entries.map((e) => [e.person.personId, e.person.role, e.state]));
    if (this.peopleList.dataset.sig === sig) return;
    this.peopleList.dataset.sig = sig;
    this.peopleList.replaceChildren(...entries.map((e) => {
      const role = ROLE_LABEL[e.person.role ?? "viewer"];
      const idle = e.state === "idle";
      return h("li", { class: idle ? "person idle" : "person", style: `--ac:${e.person.colour}`, title: `${e.person.displayName} · ${role}${idle ? " · Idle" : ""}` },
        h("span", { class: "avatar", "aria-hidden": "true" }, initials(e.person.displayName)),
        h("span", { class: "person-name" }, e.person.displayName),
        h("span", { class: "person-role" }, role),
        idle ? h("span", { class: "person-state" }, "Idle") : null);
    }));
  }

  private renderCarets(): void {
    if (!this.titleEl) return;
    const wrap = this.caretLayer.getBoundingClientRect();
    const keep = new Set<string>();
    for (const [id, c] of this.carets) {
      const state = this.presence.get(id)?.state;
      if (!state || id === this.me.personId) continue;
      const rect = caretRect(this.page, this.starts, Math.min(c.at, this.sync.view.text.length));
      if (!rect) continue;
      keep.add(id);
      const person = this.sync.author(id);
      let el = this.caretLayer.querySelector<HTMLElement>(`[data-caret-for="${CSS.escape(id)}"]`);
      if (!el) {
        el = h("div", { class: "rcaret", "data-caret-for": id }, h("span", { class: "rlabel" }, person.displayName));
        this.caretLayer.append(el);
      }
      el.style.setProperty("--ac", person.colour);
      el.style.left = `${rect.left - wrap.left}px`;
      el.style.top = `${rect.top - wrap.top}px`;
      el.style.height = `${rect.height || 20}px`;
      el.classList.toggle("idle", state === "idle");
      const label = el.firstElementChild as HTMLElement;
      el.classList.toggle("flip", rect.left - wrap.left + label.offsetWidth > wrap.width);
    }
    for (const el of [...this.caretLayer.children]) if (!keep.has((el as HTMLElement).dataset.caretFor ?? "")) el.remove();
  }

  private renderToolbarState(): void {
    if (!this.titleEl) return;
    const { from, to } = this.range();
    for (const [type, b] of this.markButtons) {
      const on = from === to ? from > 0 && this.everyCharHas(type, from - 1, from) : this.everyCharHas(type, from, to);
      b.setAttribute("aria-pressed", String(on));
    }
    const block = blocksOf(this.sync.view).filter((b) => b.at <= from).pop();
    if (block && this.styleSelect.value !== block.style) this.styleSelect.value = block.style;
  }

  private renderChromeState(): void {
    if (!this.titleEl) return;
    const allowed = modesFor(this.role);
    for (const [m, r] of this.radios) {
      r.disabled = !allowed.includes(m);
      r.checked = m === this.mode;
    }
    const editing = this.editMode === "editing";
    for (const b of this.markButtons.values()) b.disabled = !editing;
    this.styleSelect.disabled = !editing;
    if (this.toolButtons.Link) this.toolButtons.Link.disabled = !editing;
    if (this.toolButtons.Comment) this.toolButtons.Comment.disabled = !canComment(this.role) || !this.connected;
    for (const k of ["Accept all", "Reject all"]) if (this.toolButtons[k]) this.toolButtons[k].disabled = !canDecide(this.role) || !this.connected;
    for (const item of this.menuItems()) {
      const name = item.dataset.name ?? "";
      const off = (["Bold", "Italic", "Underline", "Link", "Paragraph style"].includes(name) && !editing)
        || (name === "Comment" && (!canComment(this.role) || !this.connected))
        || (["Accept all", "Reject all"].includes(name) && (!canDecide(this.role) || !this.connected));
      item.toggleAttribute("disabled", off);
      item.setAttribute("aria-disabled", String(off));
    }
    this.page.setAttribute("aria-readonly", String(this.editMode === null));
    this.shell.dataset.mode = this.mode;
    this.renderToolbarState();
  }
}

function clean(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "");
}

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0] ?? "").slice(0, 2).join("").toUpperCase();
}
