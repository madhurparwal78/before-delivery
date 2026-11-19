import { editorStatus } from '../shared/copy.js';
import type { GuideWorking } from '../shared/types.js';
import { call } from './api.js';

export interface Conflict {
  field: string;
  yours: unknown;
  theirs: { value: unknown; revision: number; by: string };
}

export interface CommitOutcome {
  ok: boolean;
  conflict?: Conflict;
}

export interface FieldEdit {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
}

/**
 * One undoable thing the person did on this page: a field edit or a step
 * change. A field edit carries the field revision it produced, so an edit
 * someone else has overwritten since can be recognised.
 */
export interface Action {
  label: string;
  run: (direction: 'undo' | 'redo') => Promise<ActionResult>;
  guard: { field: string; revisionAfter: number } | null;
}

export interface ActionResult {
  ok: boolean;
  /** Set for a field edit, so the editor can write the control back. */
  field?: string;
  value?: unknown;
  /** Set when the step order or set changed, so the rows are rebuilt. */
  structural?: boolean;
  focusStepId?: string | null;
}

export interface RemoteFieldChange {
  field: string;
  revision: number;
  byId: string;
  byName: string;
}

export interface HistoryOutcome {
  message: string;
  result?: ActionResult;
}

/**
 * The open editor page's working-copy state. One commit is one field change
 * carrying the field revision it was based on; undo re-sends the field's
 * earlier value as a normal commit, so it reaches other people like any edit.
 */
export class EditorState {
  revision: number;
  latestVersion: number | null;
  guideTotalText: string;
  private readonly fieldRevisions = new Map<string, number>();
  private readonly lastChangedBy = new Map<string, { id: string; name: string }>();
  private readonly undoStack: Action[] = [];
  private readonly redoStack: Action[] = [];

  constructor(
    readonly guideId: string,
    working: GuideWorking,
    private readonly me: { id: string; name: string },
  ) {
    this.revision = working.revision;
    this.latestVersion = working.latest_version;
    this.guideTotalText = working.guide_total_text;
    for (const [field, revision] of Object.entries(working.field_revisions)) {
      this.fieldRevisions.set(field, revision);
    }
  }

  revisionOf(field: string): number {
    return this.fieldRevisions.get(field) ?? 0;
  }

  noteRemoteChange(change: RemoteFieldChange): void {
    this.fieldRevisions.set(change.field, change.revision);
    this.lastChangedBy.set(change.field, { id: change.byId, name: change.byName });
  }

  /** Sends one field change; `record` adds it to this page's undo history. */
  async commit(edit: FieldEdit, record: boolean): Promise<CommitOutcome> {
    const reply = await call<{
      revision: number;
      field_revision: number;
      guide_total_text: string;
      error?: string;
      field?: string;
      yours?: unknown;
      theirs?: { value: unknown; revision: number; by: string };
    }>('PATCH', `/api/guides/${this.guideId}/working`, {
      field: edit.field,
      value: edit.after,
      based_on: this.revisionOf(edit.field),
    });

    if (reply.status === 200) {
      this.revision = reply.body.revision;
      this.fieldRevisions.set(edit.field, reply.body.field_revision);
      this.guideTotalText = reply.body.guide_total_text;
      this.lastChangedBy.set(edit.field, this.me);
      if (record) this.record(this.fieldAction(edit, reply.body.field_revision));
      return { ok: true };
    }
    if (reply.status === 409 && reply.body.error === 'edit_conflict' && reply.body.theirs) {
      this.fieldRevisions.set(edit.field, reply.body.theirs.revision);
      this.lastChangedBy.set(edit.field, { id: '', name: reply.body.theirs.by });
      return {
        ok: false,
        conflict: {
          field: reply.body.field ?? edit.field,
          yours: reply.body.yours,
          theirs: reply.body.theirs,
        },
      };
    }
    return { ok: false };
  }

  /** Re-sends a value on top of theirs, as Keep mine does. */
  async overwrite(field: string, value: unknown, label: string): Promise<CommitOutcome> {
    return await this.commit({ field, label, before: undefined, after: value }, false);
  }

  private fieldAction(edit: FieldEdit, revisionAfter: number): Action {
    return {
      label: edit.label,
      guard: { field: edit.field, revisionAfter },
      run: async (direction) => {
        const value = direction === 'undo' ? edit.before : edit.after;
        const outcome = await this.commit(
          { field: edit.field, label: edit.label, before: undefined, after: value },
          false,
        );
        return { ok: outcome.ok, field: edit.field, value };
      },
    };
  }

  record(action: Action): void {
    this.undoStack.push(action);
    this.redoStack.length = 0;
  }

  private blockedBy(action: Action): string | null {
    const guard = action.guard;
    if (guard === null) return null;
    if (this.revisionOf(guard.field) === guard.revisionAfter) return null;
    const changer = this.lastChangedBy.get(guard.field);
    if (changer === undefined || changer.id === this.me.id) return null;
    return changer.name;
  }

  /** Covers only this page's own entries, newest first. */
  async undo(): Promise<HistoryOutcome> {
    const action = this.undoStack.pop();
    if (action === undefined) return { message: editorStatus.nothingToUndo };
    const changer = this.blockedBy(action);
    if (changer !== null) return { message: editorStatus.undoBlocked(changer) };
    const result = await action.run('undo');
    if (!result.ok) return { message: editorStatus.commitFailed };
    this.redoStack.push(this.refresh(action));
    return { message: editorStatus.undid(action.label), result };
  }

  async redo(): Promise<HistoryOutcome> {
    const action = this.redoStack.pop();
    if (action === undefined) return { message: editorStatus.nothingToRedo };
    const result = await action.run('redo');
    if (!result.ok) return { message: editorStatus.commitFailed };
    this.undoStack.push(this.refresh(action));
    return { message: editorStatus.redid(action.label), result };
  }

  /** Keeps the guard pointing at the revision the action has just produced. */
  private refresh(action: Action): Action {
    if (action.guard === null) return action;
    return {
      ...action,
      guard: { field: action.guard.field, revisionAfter: this.revisionOf(action.guard.field) },
    };
  }
}
