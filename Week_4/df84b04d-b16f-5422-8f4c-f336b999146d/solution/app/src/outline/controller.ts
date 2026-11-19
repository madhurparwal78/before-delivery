import { ALERTS, hiddenCount, MOVE_REFUSAL_COPY, matchCount } from "../../shared/copy";
import {
  countInside, decideMirror, decideMove, type MoveOp, type MoveRules,
} from "../../shared/moves";
import { bulletLabel } from "../../shared/text";
import type {
  Bullet, ChangeMessage, LiveMessage, MeResponse, OutlineView, SearchResult,
} from "../../shared/types";
import { ApiFailure, del, get, patch, post } from "../lib/api";
import { announce, refuse } from "../lib/announce";
import { ZOOM_SETTLE_MS } from "./motion";
import {
  buildRows, flatten, inserted, patchBullet, placed, renamed, topContainer, topIds, viewFrom, ViewTree,
  withBullet, withoutBullets, type RowNode, type View,
} from "./model";

const SAVE_DELAY_MS = 600;
const SEARCH_DELAY_MS = 250;
const RETRY_MS = 1500;

interface FocusRequest {
  key: string;
  caret: "start" | "end";
  nonce: number;
}

export interface Carry {
  id: string;
  fromParent: string | null;
  fromIndex: number;
  parent: string | null;
  index: number;
}

export interface Motion {
  kind: "in" | "out";
  fromRect: DOMRect | null;
  /** The bullet the view was zoomed into before a zoom out, so its row can take the title's place. */
  from: string | null;
  nonce: number;
}

type Phase = "loading" | "ready" | "missing" | "revoked";

export interface ControllerState {
  phase: Phase;
  view: View;
  focusKey: string | null;
  focusRequest: FocusRequest | null;
  titleRequest: number;
  search: { query: string; result: SearchResult | null; error: string | null };
  paused: boolean;
  hideCompleted: boolean;
  deleting: string | null;
  sharing: boolean;
  carry: Carry | null;
  motion: Motion | null;
}

const EMPTY_VIEW: View = { rootId: null, root: null, ancestors: [], bullets: new Map(), kids: new Map(), seq: 0 };

interface Draft {
  text: string;
  /** The placement the person typed in; saves go through it, so a copy's original may stay out of sight. */
  via: string;
  saving: string | null;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export class OutlineController {
  state: ControllerState;
  private readonly listeners = new Set<() => void>();
  private readonly draftListeners = new Map<string, Set<() => void>>();
  private readonly drafts = new Map<string, Draft>();
  private readonly aliases = new Map<string, string>();
  private readonly resolved = new Map<string, string>();
  private queue: (() => Promise<void>)[] = [];
  private running = false;
  private stash: ChangeMessage[] = [];
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private searchToken = 0;
  private serial = 0;
  private focusNonce = 0;
  private loading = 0;

  constructor(private readonly me: () => MeResponse | null, private readonly applyMe: (me: MeResponse) => void) {
    this.state = {
      phase: "loading", view: EMPTY_VIEW, focusKey: null, focusRequest: null, titleRequest: 0,
      search: { query: "", result: null, error: null }, paused: false, hideCompleted: me()?.user.hideCompleted ?? false,
      deleting: null, sharing: false, carry: null, motion: null,
    };
  }

  // ---- store -----------------------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ControllerState => this.state;

  private set(change: Partial<ControllerState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  private setView(view: View, change: Partial<ControllerState> = {}): void {
    this.set({ view, ...change });
  }

  keyOf = (id: string): string => this.aliases.get(id) ?? id;

  rows(): { rows: RowNode[]; hidden: number } {
    return buildRows(this.state.view, {
      hideCompleted: this.state.hideCompleted, search: this.state.search.result, keyOf: this.keyOf,
    });
  }

  private flat(): RowNode[] {
    return flatten(this.rows().rows);
  }

  rowAt(key: string): RowNode | undefined {
    return this.flat().find((row) => row.key === key);
  }

  private bulletOf(id: string): Bullet | undefined {
    return this.state.view.bullets.get(this.rid(id));
  }

  private rid(id: string): string {
    return this.resolved.get(id) ?? id;
  }

  resolve(id: string): string {
    return this.rid(id);
  }

  private rules(): MoveRules {
    const { view } = this.state;
    const tops = new Set<string>();
    if (view.root !== null) {
      tops.add(view.root.id);
      tops.add(view.root.mirrorOf ?? view.root.id);
    }
    return { tree: new ViewTree(view), maxDepth: Number.POSITIVE_INFINITY, shareRoots: new Set(), viewTops: tops };
  }

  /** Where this person's share starts, when the view is inside someone else's branch. */
  shareTop(): string | null {
    const { view } = this.state;
    if (view.root === null) return null;
    const first = view.ancestors[0] ?? view.root;
    if (first.parentId !== null) return first.parentId;
    return this.me()?.shared.some((entry) => entry.bulletId === view.root?.id) === true ? view.root.id : null;
  }

  // ---- loading and live ------------------------------------------------------------------------------------

  /** Whether going to `next` from the current view is a zoom in, a zoom out, or neither. */
  direction(next: string | null): "in" | "out" | undefined {
    const { view, phase } = this.state;
    if (phase !== "ready" || next === view.rootId) return undefined;
    if (next === null || next === view.root?.parentId || view.ancestors.some((ancestor) => ancestor.id === next)) return "out";
    return view.bullets.has(next) ? "in" : undefined;
  }

  private arrived(rootId: string | null, motion: "in" | "out" | undefined, from: string | null): void {
    if (motion === undefined) return;
    const { root } = this.state.view;
    if (motion === "in") {
      announce(`Zoomed into ${this.label(rootId)}`);
      this.requestTitle();
    } else {
      announce(root === null ? "Zoomed out to Home" : `Zoomed out to ${bulletLabel(root.text)}`);
      if (from !== null) this.requestFocusOn(from, null);
    }
  }

  async open(rootId: string | null, options: { fromRect?: DOMRect | null } = {}): Promise<void> {
    this.flushAll();
    const current = this.state.view;
    if (this.state.phase === "ready" && current.rootId === rootId) return;
    const motion = this.direction(rootId);
    const from = current.rootId;
    const ticket = ++this.loading;
    if (rootId !== null && motion === "in") {
      const view = this.zoomInstant(rootId);
      this.setView(view, { motion: { kind: "in", fromRect: options.fromRect ?? null, from, nonce: ++this.serial }, search: { query: "", result: null, error: null }, carry: null });
      this.arrived(rootId, motion, from);
      setTimeout(() => void this.refetchQuiet(rootId, ticket), ZOOM_SETTLE_MS);
      return;
    }
    try {
      const outline = await get<OutlineView>(`/api/outline${rootId === null ? "" : `?root=${encodeURIComponent(rootId)}`}`);
      if (ticket !== this.loading) return;
      this.stash = [];
      this.setView(viewFrom(outline, rootId), {
        phase: "ready", motion: motion === undefined ? null : { kind: motion, fromRect: options.fromRect ?? null, from, nonce: ++this.serial },
        search: { query: "", result: null, error: null }, carry: null, deleting: null,
      });
      this.arrived(rootId, motion, from);
    } catch (error) {
      if (ticket !== this.loading) return;
      if (error instanceof ApiFailure && error.status === 404) this.set({ phase: "missing", view: { ...EMPTY_VIEW, rootId } });
      else throw error;
    }
  }

  private zoomInstant(rootId: string): View {
    const view = this.state.view;
    const root = view.bullets.get(rootId);
    if (root === undefined) return view;
    const ancestors: Bullet[] = [];
    for (let cursor = root.parentId; cursor !== null; cursor = view.bullets.get(cursor)?.parentId ?? null) {
      const bullet = view.bullets.get(cursor);
      if (bullet === undefined) break;
      if (view.root !== null && cursor === (view.root.mirrorOf ?? view.root.id) && cursor !== view.root.id) {
        ancestors.unshift(view.root, ...view.ancestors);
        break;
      }
      if (view.root !== null && cursor === view.root.id) {
        ancestors.unshift(bullet, ...view.ancestors);
        break;
      }
      ancestors.unshift(bullet);
    }
    return { ...view, rootId, root, ancestors };
  }

  private async refetchQuiet(rootId: string | null, ticket: number): Promise<void> {
    try {
      const outline = await get<OutlineView>(`/api/outline${rootId === null ? "" : `?root=${encodeURIComponent(rootId)}`}`);
      if (ticket === this.loading && this.queue.length === 0 && !this.running) this.setView(viewFrom(outline, rootId));
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) this.noAccess();
    }
  }

  async refresh(): Promise<void> {
    const { rootId } = this.state.view;
    try {
      const outline = await get<OutlineView>(`/api/outline${rootId === null ? "" : `?root=${encodeURIComponent(rootId)}`}`);
      this.stash = [];
      this.setView(viewFrom(outline, rootId), { phase: "ready" });
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) this.noAccess();
      else throw error;
    }
  }

  private noAccess(): void {
    this.set({ phase: this.shareTop() === null ? "missing" : "revoked" });
  }

  seq = (): number => this.state.view.seq;

  setPaused(paused: boolean): void {
    this.set({ paused });
    if (!paused) announce("Live sync is back.");
  }

  receive(message: LiveMessage): void {
    if (message.type === "revoked") {
      this.set({ phase: "revoked" });
    } else if (message.type === "reload") {
      announce("This branch was reloaded to catch up with recent changes.");
      void this.refresh();
    } else if (message.type === "change") {
      if (this.running || this.queue.length > 0) this.stash.push(message);
      else this.applyChange(message);
    }
  }

  private applyChange(message: ChangeMessage): void {
    let { view } = this.state;
    if (message.seq <= view.seq) return;
    let reload = false;
    for (const id of message.removed) {
      if (view.root !== null && view.root.id === id) {
        this.set({ phase: this.shareTop() === null ? "missing" : "revoked" });
        return;
      }
      view = withoutBullets(view, [id]);
    }
    for (const incoming of message.bullets) {
      const known = view.bullets.get(incoming.id);
      if (known === undefined) {
        if (incoming.childCount > 0) reload = true;
        view = withBullet(view, incoming);
        continue;
      }
      const drafting = this.drafts.has(this.textKey(known));
      view = withBullet(view, drafting ? { ...incoming, text: known.text, revision: known.revision } : incoming);
    }
    this.setView({ ...view, seq: message.seq });
    if (reload) void this.refresh();
  }

  private drained(): void {
    const messages = this.stash.sort((a, b) => a.seq - b.seq);
    this.stash = [];
    for (const message of messages) this.applyChange(message);
    if (this.state.paused) void this.refresh();
  }

  // ---- the save queue --------------------------------------------------------------------------------------

  private enqueue(task: () => Promise<void>): void {
    this.queue.push(task);
    if (!this.running) void this.pump();
  }

  private async pump(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task === undefined) break;
      for (;;) {
        try {
          await task();
          break;
        } catch (error) {
          if (error instanceof ApiFailure) {
            this.failed(error);
            break;
          }
          refuse(ALERTS.saveFailed);
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        }
      }
    }
    this.running = false;
    this.drained();
  }

  private failed(error: ApiFailure): void {
    if (error.status === 404) {
      this.noAccess();
      return;
    }
    const message = error.notice !== "" ? error.notice : Object.values(error.errors)[0] ?? "";
    if (message !== "") refuse(message);
    this.queue = [];
    void this.refresh();
  }

  // ---- text ------------------------------------------------------------------------------------------------

  /** Drafts are keyed by the original, under the id it had when it was first typed in. */
  textKey(bullet: Bullet): string {
    return this.keyOf(bullet.mirrorOf ?? bullet.id);
  }

  textOf(bullet: Bullet): string {
    return this.drafts.get(this.textKey(bullet))?.text ?? bullet.text;
  }

  subscribeDraft = (key: string, listener: () => void): (() => void) => {
    const set = this.draftListeners.get(key) ?? new Set();
    set.add(listener);
    this.draftListeners.set(key, set);
    return () => set.delete(listener);
  };

  draftSnapshot = (key: string): string | undefined => this.drafts.get(key)?.text;

  private tellDraft(key: string): void {
    for (const listener of this.draftListeners.get(key) ?? []) listener();
  }

  edit(bullet: Bullet, text: string): void {
    const key = this.textKey(bullet);
    const draft = this.drafts.get(key) ?? { text, via: bullet.id, saving: null, timer: undefined };
    draft.text = text;
    draft.via = bullet.id;
    clearTimeout(draft.timer);
    draft.timer = setTimeout(() => this.flush(key), SAVE_DELAY_MS);
    this.drafts.set(key, draft);
    this.tellDraft(key);
  }

  flush(key: string): void {
    const draft = this.drafts.get(key);
    if (draft === undefined) return;
    clearTimeout(draft.timer);
    draft.timer = undefined;
    const sending = draft.text;
    if (draft.saving === sending) return;
    const known = this.bulletOf(draft.via);
    if (known !== undefined && known.text === sending) {
      this.drafts.delete(key);
      this.tellDraft(key);
      return;
    }
    draft.saving = sending;
    this.enqueue(async () => {
      const current = this.bulletOf(draft.via);
      if (current === undefined) return;
      try {
        const response = await patch<{ bullet: Bullet }>(`/api/bullets/${this.rid(draft.via)}`, { text: sending, revision: current.revision });
        const { text, revision, tags, mentions, date } = response.bullet;
        this.setView(this.patchOriginal(key, { text, revision, tags, mentions, date }));
        const latest = this.drafts.get(key);
        if (latest !== undefined && latest.text === sending) {
          this.drafts.delete(key);
          this.tellDraft(key);
        } else if (latest !== undefined) latest.saving = null;
      } catch (error) {
        if (error instanceof ApiFailure && error.code === "stale_revision") {
          const winning = error.body.current as { text: string; revision: number };
          this.setView(this.patchOriginal(key, { text: winning.text, revision: winning.revision }));
          this.drafts.delete(key);
          this.tellDraft(key);
          refuse(error.notice);
          return;
        }
        const latest = this.drafts.get(key);
        if (latest !== undefined) latest.saving = null;
        throw error;
      }
    });
  }

  /** Applies a change to an original and to every placement of it. */
  private patchOriginal(key: string, change: Partial<Bullet>): View {
    const originalId = this.rid(key);
    let { view } = this.state;
    for (const entry of view.bullets.values()) {
      if (entry.id === originalId || entry.mirrorOf === originalId) view = patchBullet(view, entry.id, change);
    }
    return view;
  }

  flushAll(): void {
    for (const key of [...this.drafts.keys()]) this.flush(key);
  }

  // ---- focus -----------------------------------------------------------------------------------------------

  focusRow(key: string): void {
    if (this.state.focusKey !== key) this.set({ focusKey: key });
  }

  requestFocus(key: string, caret: "start" | "end" = "end"): void {
    this.set({ focusKey: key, focusRequest: { key, caret, nonce: ++this.focusNonce } });
  }

  private requestFocusOn(id: string, near: string | null, caret: "start" | "end" = "end"): void {
    const candidates = this.flat().filter((row) => row.bullet.id === id || this.keyOf(row.bullet.id) === this.keyOf(id));
    if (candidates.length === 0) return;
    const shared = (key: string) => {
      const a = key.split("/");
      const b = (near ?? "").split("/");
      let count = 0;
      while (count < a.length && a[count] === b[count]) count += 1;
      return count;
    };
    const best = candidates.reduce((winner, row) => (shared(row.key) > shared(winner.key) ? row : winner));
    this.requestFocus(best.key, caret);
  }

  consumeFocus(nonce: number): void {
    if (this.state.focusRequest?.nonce === nonce) this.set({ focusRequest: null });
  }

  consumeTitle(): void {
    if (this.state.titleRequest !== 0) this.set({ titleRequest: 0 });
  }

  /** Focus the title of the zoomed bullet. */
  requestTitle(): void {
    this.set({ titleRequest: ++this.focusNonce, focusKey: null });
  }

  neighbour(key: string, direction: -1 | 1): RowNode | undefined {
    const flat = this.flat();
    const at = flat.findIndex((row) => row.key === key);
    return flat[at + direction];
  }

  // ---- structure -------------------------------------------------------------------------------------------

  private label(id: string | null): string {
    return id === null ? "" : bulletLabel(this.bulletOf(id)?.text ?? "");
  }

  private temporary(parentId: string | null, text: string, index: number, base?: Bullet): Bullet {
    const id = `tmp:${++this.serial}`;
    const bullet: Bullet = {
      id, parentId, position: index, depth: 0, text, completed: false, collapsed: false, date: null, tags: [], mentions: [],
      mirrorOf: null, placeholder: false, revision: 1, childCount: 0, ...(base ?? {}),
    };
    bullet.id = id;
    return bullet;
  }

  /** Adds a bullet below `afterId` (or first under `parentId`) at once, and saves it in order. */
  private createBullet(parentId: string | null, afterId: string | null, text: string, near: string | null, caret: "start" | "end"): string {
    this.flushAll();
    const siblings = this.state.view.kids.get(parentId) ?? [];
    const index = afterId === null ? 0 : siblings.indexOf(afterId) + 1;
    const bullet = this.temporary(parentId, text, index);
    this.setView(inserted(this.state.view, bullet, index));
    this.requestFocusOn(bullet.id, near, caret);
    this.enqueue(async () => {
      const response = await post<{ bullet: Bullet }>("/api/bullets", {
        parentId: parentId === null ? null : this.rid(parentId),
        afterId: afterId === null ? null : this.rid(afterId),
        text,
      });
      const real = response.bullet.id;
      this.resolved.set(bullet.id, real);
      this.aliases.set(real, this.keyOf(bullet.id));
      const typed = this.drafts.has(this.keyOf(real));
      this.setView(patchBullet(renamed(this.state.view, bullet.id, real), real, { revision: response.bullet.revision, text: typed ? bullet.text : response.bullet.text }));
    });
    return bullet.id;
  }

  addFirstBullet(): void {
    const root = this.state.view.root;
    this.createBullet(root === null ? null : root.mirrorOf ?? root.id, null, "", null, "end");
  }

  addBelow(key: string): void {
    const row = this.rowAt(key);
    if (row === undefined) return;
    this.createBullet(row.bullet.parentId, row.bullet.id, "", key, "end");
  }

  addAbove(key: string): void {
    const row = this.rowAt(key);
    if (row === undefined) return;
    const siblings = this.state.view.kids.get(row.bullet.parentId) ?? [];
    const before = siblings[siblings.indexOf(row.bullet.id) - 1] ?? null;
    this.createBullet(row.bullet.parentId, before, "", key, "end");
    this.requestFocusOn(row.bullet.id, key, "start");
  }

  split(key: string, caret: number): void {
    const row = this.rowAt(key);
    if (row === undefined) return;
    const text = this.textOf(row.bullet);
    this.edit(row.bullet, text.slice(0, caret));
    this.flush(this.textKey(row.bullet));
    this.createBullet(row.bullet.parentId, row.bullet.id, text.slice(caret), key, "start");
  }

  structural(key: string, op: MoveOp): void {
    const row = this.rowAt(key);
    if (row === undefined) return;
    const id = row.bullet.id;
    const decision = decideMove(this.rules(), id, { op });
    if (!decision.ok) {
      if (decision.code !== "index" && decision.code !== "too_deep") refuse(MOVE_REFUSAL_COPY[decision.code]);
      return;
    }
    let view = placed(this.state.view, id, decision.parentId, decision.index);
    if (decision.expand !== null) view = patchBullet(view, decision.expand, { collapsed: false });
    this.setView(view);
    const siblings = view.kids.get(decision.parentId)?.length ?? 0;
    const parentText = this.label(decision.parentId === null ? null : decision.expand ?? decision.parentId);
    if (op === "indent") announce(`Indented under ${this.label(decision.expand)}`);
    else if (op === "outdent") announce(decision.parentId === null ? "Outdented to top level" : `Outdented under ${parentText}`);
    else announce(`Moved to position ${decision.index + 1} of ${siblings} ${decision.parentId === null ? "at top level" : `under ${this.label(decision.parentId)}`}`);
    this.requestFocusOn(id, key);
    this.enqueue(async () => {
      await post(`/api/bullets/${this.rid(id)}/move`, { op });
    });
  }

  /** Moves to an explicit place (board drops); the caller announces the result. */
  moveTo(id: string, parentId: string | null, index: number): boolean {
    const decision = decideMove(this.rules(), id, { parentId, index });
    if (!decision.ok) {
      if (decision.code === "inside_itself") refuse(MOVE_REFUSAL_COPY.inside_itself);
      return false;
    }
    this.setView(placed(this.state.view, id, decision.parentId, decision.index));
    this.enqueue(async () => {
      await post(`/api/bullets/${this.rid(id)}/move`, { parentId: decision.parentId === null ? null : this.rid(decision.parentId), index: decision.index });
    });
    return true;
  }

  toggleComplete(key: string): void {
    const row = this.rowAt(key);
    if (row === undefined || row.bullet.placeholder) return;
    const { bullet } = row;
    const completed = !bullet.completed;
    this.flush(this.textKey(bullet));
    this.setView(this.patchOriginal(this.textKey(bullet), { completed }));
    announce(completed ? `Completed ${bulletLabel(this.textOf(bullet))}` : `Marked ${bulletLabel(this.textOf(bullet))} not complete`);
    this.requestFocusOn(bullet.id, key);
    this.enqueue(async () => {
      const response = await patch<{ bullet: Bullet }>(`/api/bullets/${this.rid(bullet.id)}`, { completed });
      this.setView(this.patchOriginal(this.textKey(bullet), { revision: response.bullet.revision }));
    });
  }

  toggleCollapse(key: string): void {
    const row = this.rowAt(key);
    if (row === undefined || row.bullet.childCount + (this.state.view.kids.get(row.bullet.mirrorOf ?? row.bullet.id)?.length ?? 0) === 0) return;
    const { bullet } = row;
    const collapsed = !bullet.collapsed;
    this.setView(patchBullet(this.state.view, bullet.id, { collapsed }));
    announce(`${collapsed ? "Collapsed" : "Expanded"} ${bulletLabel(this.textOf(bullet))}`);
    this.requestFocusOn(bullet.id, key);
    this.enqueue(async () => {
      await patch(`/api/bullets/${this.rid(bullet.id)}`, { collapsed });
    });
  }

  mirror(key: string): void {
    const row = this.rowAt(key);
    if (row === undefined || row.bullet.placeholder) return;
    const { bullet } = row;
    const verdict = decideMirror(this.rules(), bullet.id, bullet.parentId);
    if (!verdict.ok) {
      refuse(MOVE_REFUSAL_COPY.inside_itself);
      return;
    }
    this.flushAll();
    const index = bullet.position + 1;
    const copy = this.temporary(bullet.parentId, bullet.text, index, { ...bullet, collapsed: false, mirrorOf: bullet.mirrorOf ?? bullet.id });
    this.setView(inserted(this.state.view, copy, index));
    announce(`Mirrored ${bulletLabel(this.textOf(bullet))}`);
    this.requestFocusOn(copy.id, key);
    this.enqueue(async () => {
      const response = await post<{ bullet: Bullet }>(`/api/bullets/${this.rid(bullet.id)}/mirror`, {});
      const real = response.bullet.id;
      this.resolved.set(copy.id, real);
      this.aliases.set(real, this.keyOf(copy.id));
      this.setView(renamed(this.state.view, copy.id, real));
    });
  }

  /** Delete from the keyboard or toolbar; a bullet with bullets inside asks first. */
  requestDelete(key: string): void {
    const row = this.rowAt(key);
    if (row === undefined) return;
    const inside = countInside(new ViewTree(this.state.view), row.bullet.id);
    if (row.bullet.mirrorOf === null && inside > 0) this.set({ deleting: row.bullet.id, focusKey: key });
    else this.remove(key, "Delete");
  }

  insideCount(id: string): number {
    return countInside(new ViewTree(this.state.view), id);
  }

  cancelDelete(): void {
    const id = this.state.deleting;
    this.set({ deleting: null });
    if (id !== null) this.requestFocusOn(id, this.state.focusKey);
  }

  confirmDelete(): void {
    const id = this.state.deleting;
    this.set({ deleting: null });
    const row = this.flat().find((entry) => entry.bullet.id === id);
    if (row !== undefined) this.remove(row.key, "Delete");
  }

  backspaceEmpty(key: string): void {
    const row = this.rowAt(key);
    if (row === undefined) return;
    if (this.insideCount(row.bullet.id) > 0) {
      refuse(ALERTS.backspaceWithChildren);
      return;
    }
    this.remove(key, "Backspace");
  }

  private remove(key: string, via: "Delete" | "Backspace"): void {
    const row = this.rowAt(key);
    if (row === undefined) return;
    const { bullet } = row;
    const flat = this.flat();
    const at = flat.findIndex((entry) => entry.key === key);
    const above = flat[at - 1];
    const below = flat.slice(at + 1).find((entry) => !entry.key.startsWith(`${key}/`));
    const label = bulletLabel(this.textOf(bullet));
    this.flushAll();
    this.setView(withoutBullets(this.state.view, [bullet.id]));
    announce(via === "Backspace" ? "Deleted empty bullet" : bullet.mirrorOf !== null ? `Removed copy of ${label}` : `Moved ${label} to trash`);
    const target = above ?? below;
    if (target !== undefined) this.requestFocus(target.key, "end");
    else if (this.state.view.root !== null) this.requestTitle();
    else this.set({ focusKey: null });
    this.enqueue(async () => {
      await del(`/api/bullets/${this.rid(bullet.id)}`);
    });
  }

  // ---- zoom ------------------------------------------------------------------------------------------------

  clearMotion(): void {
    if (this.state.motion !== null) this.set({ motion: null });
  }

  // ---- undo and redo ---------------------------------------------------------------------------------------

  undoOrRedo(direction: "undo" | "redo"): void {
    this.flushAll();
    this.enqueue(async () => {
      try {
        const done = await post<{ step: string }>(`/api/${direction}`);
        announce(`${direction === "undo" ? "Undid" : "Redid"} ${done.step}`);
        await this.refresh();
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 409) {
          refuse(error.notice);
          return;
        }
        throw error;
      }
    });
  }

  // ---- search and hide completed ---------------------------------------------------------------------------

  setSearch(query: string): void {
    clearTimeout(this.searchTimer);
    const token = ++this.searchToken;
    if (query === "") {
      this.set({ search: { query: "", result: null, error: null } });
      return;
    }
    this.set({ search: { ...this.state.search, query } });
    this.searchTimer = setTimeout(() => void this.runSearch(query, token), SEARCH_DELAY_MS);
  }

  private async runSearch(query: string, token: number): Promise<void> {
    const root = this.state.view.rootId;
    try {
      const result = await get<SearchResult>(`/api/search?q=${encodeURIComponent(query)}${root === null ? "" : `&root=${encodeURIComponent(root)}`}`);
      if (token !== this.searchToken) return;
      this.set({ search: { query, result, error: null } });
      announce(matchCount(result.count));
    } catch (error) {
      if (token !== this.searchToken) return;
      if (error instanceof ApiFailure && error.status === 422) {
        this.set({ search: { query, result: null, error: error.errors.q ?? "" } });
        return;
      }
      throw error;
    }
  }

  async setHideCompleted(hideCompleted: boolean): Promise<void> {
    this.set({ hideCompleted });
    const hidden = buildRows(this.state.view, { hideCompleted: true, search: null, keyOf: this.keyOf }).hidden;
    announce(hideCompleted ? hiddenCount(hidden) : "Showing completed bullets");
    this.applyMe(await patch<MeResponse>("/api/me", { hideCompleted }));
  }


  // ---- board -----------------------------------------------------------------------------------------------

  /** The cards of every column, with a carried card shown at the place it would drop. */
  boardLists(): { column: Bullet; container: string; cards: string[] }[] {
    const { view, carry } = this.state;
    return topIds(view).flatMap((id) => {
      const column = view.bullets.get(id);
      if (column === undefined) return [];
      const container = column.mirrorOf ?? column.id;
      const cards = (view.kids.get(container) ?? []).filter((card) => card !== carry?.id);
      if (carry !== null && carry.parent === container) cards.splice(carry.index, 0, carry.id);
      return [{ column, container, cards }];
    });
  }

  private carryText(id: string): string {
    const bullet = this.bulletOf(id);
    return bullet === undefined ? "" : bulletLabel(this.textOf(bullet));
  }

  pickUp(id: string): void {
    const bullet = this.bulletOf(id);
    if (bullet === undefined || bullet.parentId === null && this.state.view.root !== null) return;
    this.setCarry({ id, fromParent: bullet.parentId, fromIndex: bullet.position, parent: bullet.parentId, index: bullet.position });
    announce(`Picked up ${this.carryText(id)}. Use the arrow keys to move it, Space to drop, Escape to cancel.`);
  }

  carryTo(parent: string | null, index: number): void {
    const { carry } = this.state;
    if (carry === null || (carry.parent === parent && carry.index === index)) return;
    this.setCarry({ ...carry, parent, index });
  }

  carryStep(direction: "up" | "down" | "left" | "right"): void {
    const { carry } = this.state;
    if (carry === null) return;
    const lists = this.boardLists().map((entry) => ({ container: entry.container, length: entry.cards.filter((card) => card !== carry.id).length }));
    const at = lists.findIndex((entry) => entry.container === carry.parent);
    const here = lists[at];
    if (here === undefined) return;
    let parent = carry.parent;
    let index = carry.index;
    if (direction === "up") index = Math.max(0, index - 1);
    else if (direction === "down") index = Math.min(here.length, index + 1);
    else {
      const next = lists[at + (direction === "left" ? -1 : 1)];
      if (next === undefined) return;
      parent = next.container;
      index = Math.min(index, next.length);
    }
    if (parent === carry.parent && index === carry.index) return;
    this.setCarry({ ...carry, parent, index });
    const total = lists.find((entry) => entry.container === parent)?.length ?? 0;
    announce(`${this.carryText(carry.id)}: position ${index + 1} of ${total + 1} in ${this.label(parent)}`);
  }

  drop(): void {
    const { carry } = this.state;
    if (carry === null) return;
    this.setCarry(null);
    const total = (this.state.view.kids.get(carry.parent)?.filter((card) => card !== carry.id).length ?? 0) + 1;
    if (carry.parent !== carry.fromParent || carry.index !== carry.fromIndex) this.moveTo(carry.id, carry.parent, carry.index);
    announce(`Dropped ${this.carryText(carry.id)} in ${this.label(carry.parent)}, position ${carry.index + 1} of ${total}`);
  }

  cancelCarry(): void {
    const { carry } = this.state;
    if (carry === null) return;
    this.setCarry(null);
    announce(`Move cancelled. ${this.carryText(carry.id)} is back in ${this.label(carry.fromParent)}.`);
  }

  // ---- misc ------------------------------------------------------------------------------------------------

  /** Takes the saved setting from the account when it changes elsewhere. */
  adoptHideCompleted(hideCompleted: boolean): void {
    if (this.state.hideCompleted !== hideCompleted) this.set({ hideCompleted });
  }

  setSharing(sharing: boolean): void {
    this.set({ sharing });
  }

  setCarry(carry: Carry | null): void {
    this.set({ carry });
  }

  topIds(): readonly string[] {
    return topIds(this.state.view);
  }

  topContainer(): string | null {
    return topContainer(this.state.view);
  }

}
