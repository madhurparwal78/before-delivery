import { deriveFromPage } from '../../shared/derive';
import { clonePage } from '../../shared/editing';
import type { Derived, DiagramDetail, PageDocument, Role } from '../../shared/types';
import { ApiFailure, api } from '../api';
import { showNotFound } from '../router';
import { isGateOpen, keepForSignIn } from './sessionGate';

export type SaveStateText = 'Read only' | 'Saving...' | 'Not saved' | 'Saved' | 'Unsaved changes';

export interface EditMeta {
  movedShapeIds?: string[];
  zoneAction?: { zoneId: string; kind: 'moved' | 'resized' };
  silent?: boolean;
}

interface UndoEntry {
  before: PageDocument;
  after: PageDocument;
  meta: EditMeta;
}

export type Banner = null | 'conflict' | 'downgrade' | 'generic';

export interface EditorChange {
  doc?: boolean;
  selection?: boolean;
  save?: boolean;
  motion?: {
    beforeDoc: PageDocument;
    beforeDerived: Derived;
    meta: EditMeta;
    reverse: boolean;
  };
}

export class EditorState {
  readonly diagram: DiagramDetail;
  readonly pageId: string;
  role: Role;
  doc: PageDocument;
  derived: Derived;
  selection = new Set<string>();
  focusedId: string | null = null;
  connectFrom: string | null = null;
  storageDown = false;
  banner: Banner = null;
  downgraded = false;
  conflicted = false;

  private pendingEdits = false;
  private lastEditAt = 0;
  private inFlight = false;
  private runActive = false;
  private failed = false;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private listeners = new Set<(change: EditorChange) => void>();

  constructor(diagram: DiagramDetail, pageId: string, doc: PageDocument, derived: Derived) {
    this.diagram = diagram;
    this.pageId = pageId;
    this.role = diagram.role;
    this.doc = doc;
    this.derived = derived;
  }

  get readOnly(): boolean {
    return this.role === 'viewer' || this.downgraded;
  }

  get canEdit(): boolean {
    return !this.readOnly && !this.conflicted;
  }

  subscribe(listener: (change: EditorChange) => void): void {
    this.listeners.add(listener);
  }

  notify(change: EditorChange): void {
    for (const listener of this.listeners) listener(change);
  }

  saveStateText(): SaveStateText {
    if (this.readOnly) return 'Read only';
    if (this.runActive) return 'Saving...';
    if (this.failed) return 'Not saved';
    if (this.pendingEdits) return 'Unsaved changes';
    return 'Saved';
  }

  hasPendingWork(): boolean {
    return this.pendingEdits || this.inFlight;
  }

  select(ids: Iterable<string>, focusedId?: string | null): void {
    this.selection = new Set(ids);
    if (focusedId !== undefined) this.focusedId = focusedId;
    this.notify({ selection: true });
  }

  /** Records one edit: it enters the undo stack, marks the page unsaved and plays its motion. */
  applyEdit(next: PageDocument, meta: EditMeta = {}): void {
    const before = clonePage(this.doc);
    const beforeDerived = this.derived;
    this.undoStack.push({ before, after: clonePage(next), meta });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.setDoc(next);
    this.markEdited();
    this.notify({
      doc: true,
      selection: true,
      save: true,
      motion: { beforeDoc: before, beforeDerived, meta, reverse: false },
    });
  }

  /** Shows a drag in progress without recording an edit. */
  preview(next: PageDocument): void {
    this.setDoc(next);
  }

  private setDoc(next: PageDocument): void {
    next.version = this.doc.version;
    this.doc = next;
    this.derived = deriveFromPage(next);
  }

  private markEdited(): void {
    this.pendingEdits = true;
    this.lastEditAt = Date.now();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    const before = clonePage(this.doc);
    const beforeDerived = this.derived;
    this.redoStack.push(entry);
    this.setDoc(clonePage(entry.before));
    this.markEdited();
    this.pruneSelection();
    this.notify({
      doc: true,
      selection: true,
      save: true,
      motion: { beforeDoc: before, beforeDerived, meta: entry.meta, reverse: true },
    });
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    const before = clonePage(this.doc);
    const beforeDerived = this.derived;
    this.undoStack.push(entry);
    this.setDoc(clonePage(entry.after));
    this.markEdited();
    this.pruneSelection();
    this.notify({
      doc: true,
      selection: true,
      save: true,
      motion: { beforeDoc: before, beforeDerived, meta: entry.meta, reverse: false },
    });
  }

  private pruneSelection(): void {
    const ids = new Set<string>([
      ...this.doc.zones.map((zone) => zone.id),
      ...this.doc.shapes.map((shape) => shape.id),
      ...this.doc.connectors.map((connector) => connector.id),
    ]);
    this.selection = new Set([...this.selection].filter((id) => ids.has(id)));
    if (this.focusedId && !ids.has(this.focusedId)) this.focusedId = null;
  }

  /** The autosave rule: at most one save in flight, the next one carrying the version it returned. */
  tick(): void {
    if (!this.pendingEdits || this.inFlight) return;
    if (!this.canEdit || isGateOpen()) return;
    if (Date.now() - this.lastEditAt < 1000) return;
    void this.save();
  }

  async saveNow(): Promise<void> {
    if (!this.pendingEdits || !this.canEdit) return;
    if (this.inFlight) return;
    await this.save();
  }

  private async save(): Promise<void> {
    const snapshot = clonePage(this.doc);
    this.inFlight = true;
    this.runActive = true;
    this.pendingEdits = false;
    this.failed = false;
    if (this.banner === 'generic') this.banner = null;
    this.notify({ save: true });
    const path = `/api/diagrams/${this.diagram.id}/pages/${this.pageId}`;
    try {
      const body = await keepForSignIn(() =>
        api.put<{ page: PageDocument; derived: Derived }>(path, snapshot),
      );
      this.inFlight = false;
      this.doc.version = body.page.version;
      if (!this.pendingEdits) {
        this.doc = body.page;
        this.derived = body.derived;
        this.runActive = false;
        this.failed = false;
        this.notify({ doc: true, save: true });
      } else {
        this.notify({ save: true });
      }
    } catch (error) {
      this.inFlight = false;
      this.handleSaveFailure(error);
    }
  }

  private handleSaveFailure(error: unknown): void {
    this.runActive = false;
    this.failed = true;
    if (error instanceof ApiFailure) {
      if (error.code === 'version_conflict') {
        this.conflicted = true;
        this.banner = 'conflict';
        this.notify({ save: true });
        return;
      }
      if (error.code === 'forbidden') {
        this.applyDowngrade();
        return;
      }
      if (error.code === 'not_found') {
        showNotFound('diagram');
        return;
      }
    }
    this.banner = 'generic';
    this.notify({ save: true });
  }

  /** A save refused as forbidden turns the tab read-only for good. */
  applyDowngrade(): void {
    this.downgraded = true;
    this.role = 'viewer';
    this.banner = 'downgrade';
    this.failed = false;
    this.runActive = false;
    this.pendingEdits = false;
    void api
      .get<{ page: PageDocument; derived: Derived }>(`/api/diagrams/${this.diagram.id}/pages/${this.pageId}`)
      .then((body) => {
        this.doc = body.page;
        this.derived = body.derived;
        this.notify({ doc: true, save: true, selection: true });
      })
      .catch(() => undefined);
    this.notify({ doc: true, save: true, selection: true });
  }

  async reloadFromServer(): Promise<void> {
    const body = await api.get<{ page: PageDocument; derived: Derived }>(
      `/api/diagrams/${this.diagram.id}/pages/${this.pageId}`,
    );
    this.doc = body.page;
    this.derived = body.derived;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = new Set();
    this.focusedId = null;
    this.conflicted = false;
    this.failed = false;
    this.pendingEdits = false;
    this.runActive = false;
    this.banner = null;
    this.notify({ doc: true, save: true, selection: true });
  }

  /** Leaving the editor settles the save first and stays on the page if it fails. */
  async settle(): Promise<boolean> {
    if (this.readOnly) return true;
    if (this.pendingEdits && !this.inFlight) await this.save();
    while (this.inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return !this.failed;
  }
}
