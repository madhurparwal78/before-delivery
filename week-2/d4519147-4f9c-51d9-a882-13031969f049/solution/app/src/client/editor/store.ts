import { useSyncExternalStore } from "react";
import { derivePage } from "../../shared/derive.ts";
import type { Derived, PageDoc } from "../../shared/model.ts";
import { announce } from "../announce.tsx";
import { editorRequest, errorBody, readJson, request } from "../api.ts";
import { Emitter } from "../emitter.ts";
import { boundarySentences, buildSequence, qualifies, type Frame } from "./boundary.ts";
import { withGroups } from "./edits.ts";

const AUTOSAVE_MS = 1200;
const AUTOSAVE_MIN_AGE_MS = 1000;
const HISTORY = 200;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

export interface View {
  /** Canvas point at the pane's top-left corner. */
  x: number;
  y: number;
  zoom: number;
}

interface PageHooks {
  diagramId: string;
  onForbidden(): void;
  onNotFound(): void;
}

type Failure = null | "generic" | "conflict";

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** One open page: its document, undo history, selection, view, boundary sequence and save queue. */
export class PageStore {
  readonly changes = new Emitter();
  doc: PageDoc;
  /** A drag in progress, drawn instead of `doc` until it is committed or cancelled. */
  preview: PageDoc | null = null;
  private past: PageDoc[] = [];
  private future: PageDoc[] = [];
  selection = new Set<string>();
  view: View = { x: 0, y: 0, zoom: 1 };
  readOnly: boolean;
  downgraded = false;
  frame: Frame | null = null;
  connectFrom: string | null = null;
  /** A canvas item to focus after the next render. */
  focusRequest: string | null = null;
  private derivedCache: { doc: PageDoc; derived: Derived } | null = null;
  private serverDerived: { doc: PageDoc; derived: Derived } | null = null;
  private sequence: { raf: number; sentence: string } | null = null;

  /* Save queue state */
  private version: number;
  dirty = false;
  inFlight = false;
  runActive = false;
  failure: Failure = null;
  private lastEditAt = 0;
  private saveRequested = false;
  private timer: number | null = null;
  private waiters: ((ok: boolean) => void)[] = [];

  constructor(page: PageDoc, derived: Derived, readOnly: boolean, private readonly hooks: PageHooks) {
    this.doc = page;
    this.version = page.version;
    this.readOnly = readOnly;
    this.serverDerived = { doc: page, derived };
  }

  private emit(): void {
    this.changes.emit();
  }

  get display(): PageDoc {
    return this.preview ?? this.doc;
  }

  /** Derived values for what is on screen: the server's when they describe the current document, else derived locally by the same rule. */
  get derived(): Derived {
    const doc = this.display;
    if (this.serverDerived?.doc === doc) return this.serverDerived.derived;
    if (this.derivedCache?.doc !== doc) this.derivedCache = { doc, derived: derivePage(doc) };
    return this.derivedCache.derived;
  }

  get canUndo(): boolean {
    return this.past.length > 0 && !this.readOnly;
  }

  get canRedo(): boolean {
    return this.future.length > 0 && !this.readOnly;
  }

  /* Selection */

  select(ids: Iterable<string>): void {
    this.selection = withGroups(this.doc, ids);
    this.emit();
  }

  toggle(id: string): void {
    const unit = withGroups(this.doc, [id]);
    const next = new Set(this.selection);
    const on = !next.has(id);
    for (const u of unit) {
      if (on) next.add(u);
      else next.delete(u);
    }
    this.selection = next;
    this.emit();
  }

  clearSelection(): void {
    this.selection = new Set();
    this.emit();
  }

  /* Edits */

  private finishSequence(): void {
    if (!this.sequence) return;
    cancelAnimationFrame(this.sequence.raf);
    const { sentence } = this.sequence;
    this.sequence = null;
    this.frame = null;
    announce(sentence);
  }

  private play(before: PageDoc, after: PageDoc, reverse: boolean): void {
    const beforeD = derivePage(before), afterD = derivePage(after);
    if (!qualifies(beforeD, afterD)) return;
    const sentence = boundarySentences(before, after, beforeD, afterD);
    if (prefersReducedMotion()) {
      announce(sentence);
      return;
    }
    const seq = buildSequence(before, after, reverse);
    const start = performance.now();
    this.frame = seq.frame(0);
    const tick = () => {
      if (!this.sequence) return;
      const elapsed = performance.now() - start;
      if (elapsed >= seq.duration) {
        this.sequence = null;
        this.frame = null;
        announce(sentence);
      } else {
        this.frame = seq.frame(elapsed);
        this.sequence.raf = requestAnimationFrame(tick);
      }
      this.emit();
    };
    this.sequence = { raf: requestAnimationFrame(tick), sentence };
  }

  private commit(next: PageDoc, kind: "edit" | "undo" | "redo"): void {
    this.finishSequence();
    const before = this.doc;
    this.doc = next;
    this.preview = null;
    const live = new Set([...next.zones, ...next.shapes, ...next.connectors].map((i) => i.id));
    this.selection = new Set([...this.selection].filter((id) => live.has(id)));
    if (this.connectFrom && !live.has(this.connectFrom)) this.connectFrom = null;
    this.play(before, next, kind === "undo");
    this.edited();
    this.emit();
  }

  /** Records one undoable edit. */
  edit(next: PageDoc): void {
    if (this.readOnly || next === this.doc) return;
    this.past.push(this.doc);
    if (this.past.length > HISTORY) this.past.shift();
    this.future = [];
    this.commit(next, "edit");
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev || this.readOnly) return;
    this.future.push(this.doc);
    this.commit(prev, "undo");
  }

  redo(): void {
    const next = this.future.pop();
    if (!next || this.readOnly) return;
    this.past.push(this.doc);
    this.commit(next, "redo");
  }

  setPreview(doc: PageDoc | null): void {
    this.preview = doc;
    this.emit();
  }

  setView(view: View): void {
    this.view = { ...view, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom)) };
    this.emit();
  }

  setConnectFrom(id: string | null): void {
    this.connectFrom = id;
    this.emit();
  }

  requestFocus(id: string): void {
    this.focusRequest = id;
    this.emit();
  }

  /* Save queue: one save in flight per page, versions chained, and the save-run rule for the save state. */

  get saveState(): string {
    if (this.readOnly) return "Read only";
    if (this.runActive) return "Saving...";
    if (this.failure) return "Not saved";
    if (this.dirty) return "Unsaved changes";
    return "Saved";
  }

  private edited(): void {
    this.dirty = true;
    this.lastEditAt = performance.now();
    if (this.failure === "conflict") return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.startSave();
    }, AUTOSAVE_MS);
  }

  /** Ctrl+S, Save and leaving skip the autosave delay but still wait for the save in flight. */
  saveNow(): void {
    if (this.readOnly || this.failure === "conflict" || !this.dirty) return;
    this.saveRequested = true;
    this.startSave();
  }

  private startSave(): void {
    if (this.inFlight || !this.dirty || this.readOnly || this.failure === "conflict") return;
    if (!this.saveRequested && performance.now() - this.lastEditAt < AUTOSAVE_MIN_AGE_MS) return;
    if (!this.runActive) {
      this.runActive = true;
      this.failure = null;
    }
    this.inFlight = true;
    this.dirty = false;
    this.saveRequested = false;
    const sent = this.doc;
    const body = { ...sent, version: this.version };
    this.emit();
    void editorRequest({ method: "PUT", path: `/api/diagrams/${this.hooks.diagramId}/pages/${sent.id}`, json: body }).then((res) => this.saved(res, sent));
  }

  private async saved(res: Response, sent: PageDoc): Promise<void> {
    this.inFlight = false;
    if (res.ok) {
      const body = await readJson<{ page: PageDoc; derived: Derived }>(res);
      this.version = body.page.version;
      if (this.dirty) {
        if (this.saveRequested || performance.now() - this.lastEditAt >= AUTOSAVE_MIN_AGE_MS) this.startSave();
      } else {
        this.runActive = false;
        if (this.doc === sent) this.serverDerived = { doc: sent, derived: body.derived };
        this.resolveWaiters(true);
      }
      this.emit();
      return;
    }
    const code = (await errorBody(res))?.error;
    this.runActive = false;
    this.dirty = true;
    if (res.status === 403 && code === "forbidden") {
      this.dirty = false;
      this.resolveWaiters(true);
      this.hooks.onForbidden();
      return;
    }
    if (res.status === 404) {
      this.resolveWaiters(false);
      this.hooks.onNotFound();
      return;
    }
    this.failure = res.status === 409 && code === "version_conflict" ? "conflict" : "generic";
    this.resolveWaiters(false);
    this.emit();
  }

  private resolveWaiters(ok: boolean): void {
    for (const w of this.waiters.splice(0)) w(ok);
  }

  /** True while leaving must wait for a save. */
  get pending(): boolean {
    return !this.readOnly && (this.dirty || this.inFlight);
  }

  /** Starts a pending save at once and resolves when the run ends: true on success. */
  settle(): Promise<boolean> {
    if (!this.pending) return Promise.resolve(true);
    if (this.failure === "conflict") return Promise.resolve(false);
    const done = new Promise<boolean>((resolve) => this.waiters.push(resolve));
    if (this.dirty && !this.inFlight) {
      this.saveRequested = true;
      this.startSave();
    } else this.saveRequested = this.saveRequested || this.dirty;
    this.emit();
    return done;
  }

  /** A forbidden save: the server's page replaces local edits and the canvas becomes read-only for good. */
  becomeReadOnly(page: PageDoc, derived: Derived): void {
    this.finishSequence();
    if (this.timer !== null) clearTimeout(this.timer);
    this.readOnly = true;
    this.downgraded = true;
    this.dirty = false;
    this.preview = null;
    this.doc = page;
    this.serverDerived = { doc: page, derived };
    this.past = [];
    this.future = [];
    this.connectFrom = null;
    this.emit();
  }

  /** Reload page: the server's page replaces local edits and ends the failed state. */
  async reload(): Promise<boolean> {
    const res = await request({ method: "GET", path: `/api/diagrams/${this.hooks.diagramId}/pages/${this.doc.id}` });
    if (!res.ok) {
      if (res.status === 404) this.hooks.onNotFound();
      return false;
    }
    const body = await readJson<{ page: PageDoc; derived: Derived }>(res);
    this.finishSequence();
    if (this.timer !== null) clearTimeout(this.timer);
    this.doc = body.page;
    this.version = body.page.version;
    this.serverDerived = { doc: body.page, derived: body.derived };
    this.preview = null;
    this.past = [];
    this.future = [];
    this.dirty = false;
    this.failure = null;
    this.runActive = false;
    const live = new Set([...body.page.zones, ...body.page.shapes, ...body.page.connectors].map((i) => i.id));
    this.selection = new Set([...this.selection].filter((id) => live.has(id)));
    this.emit();
    return true;
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.sequence) cancelAnimationFrame(this.sequence.raf);
    this.sequence = null;
  }
}

export function useStore(store: PageStore): void {
  useSyncExternalStore(store.changes.subscribe, store.changes.snapshot);
}
