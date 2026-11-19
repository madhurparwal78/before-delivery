import { ApiFailure, patch } from '../api';
import { editConflict, editorStatus } from '../../shared/copy';
import type { LiveEvent, Limits } from '../../shared/types';
import { dialogButtons, openDialog } from '../dialog';
import { h } from '../dom';
import type { Status } from '../status';
import { same, type EditorState } from './state';
import type { UndoStack } from './undo';

/** A control bound to one field path: it knows its committed value, whether it holds uncommitted text, and how to show a value. */
export interface Binding {
  path: string;
  label: string;
  show(value: unknown): void;
  pending(): boolean;
  /** The value the control holds now, when it differs from the committed one. */
  current(): unknown;
  flush(): Promise<void>;
}

export interface CommitHost {
  state: EditorState;
  guideId: string;
  status: Status;
  undo: UndoStack;
  limits: Limits;
  onApplied(path: string, remote: boolean): void;
  onTotal(total: number, text: string): void;
}

interface Options { undoLabel?: string; basedOn?: number; binding?: Binding }

/** Every field change is one commit with the revision it was based on; refusals keep the typed text. */
export class Committer {
  private readonly bindings = new Map<string, Binding>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly conflicts = new Set<string>();
  private total: number;

  constructor(private readonly host: CommitHost) {
    this.total = host.state.work.guide_total;
  }

  register(binding: Binding): void {
    this.bindings.set(binding.path, binding);
  }

  unregister(path: string): void {
    this.bindings.delete(path);
  }

  bindingFor(path: string): Binding | undefined {
    return this.bindings.get(path);
  }

  async flushAll(): Promise<void> {
    for (const binding of [...this.bindings.values()]) if (binding.pending()) await binding.flush();
  }

  /** Counts commits started and still in flight, so a fetched working copy older than one of them can be told apart. */
  private started = 0;
  private active = 0;

  get activity(): { started: number; active: number } {
    return { started: this.started, active: this.active };
  }

  commit(path: string, value: unknown, options: Options = {}): Promise<boolean> {
    const previous = this.chains.get(path) ?? Promise.resolve();
    const next = previous.then(() => this.send(path, value, options));
    this.chains.set(path, next.catch(() => undefined));
    return next;
  }

  private async send(path: string, value: unknown, options: Options): Promise<boolean> {
    const { state, status } = this.host;
    const binding = options.binding ?? this.bindings.get(path);
    if (this.conflicts.has(path)) return false;
    const before = state.read(path);
    if (same(before, value)) return true;
    const revision = state.revision(path);
    const totalBefore = this.total;
    state.write(path, value, revision);
    this.host.onApplied(path, false);
    this.started += 1;
    this.active += 1;
    try {
      const reply = await patch<{ field_revision: number; guide_total: number; guide_total_text: string }>(
        `/api/guides/${this.host.guideId}/working`,
        { field: path, value, based_on: options.basedOn ?? state.revision(path) },
      );
      state.write(path, value, reply.field_revision);
      state.lastBy.delete(path);
      if (options.undoLabel) this.host.undo.record({ kind: 'field', path, before, after: value, label: options.undoLabel });
      this.host.onApplied(path, false);
      this.total = reply.guide_total;
      this.host.onTotal(reply.guide_total, reply.guide_total_text);
      if (reply.guide_total !== totalBefore) status.flash(editorStatus.totalChanged(reply.guide_total_text));
      return true;
    } catch (error) {
      state.write(path, before, revision);
      this.host.onApplied(path, false);
      this.refuse(path, value, error, binding);
      return false;
    } finally {
      this.active -= 1;
    }
  }

  private refuse(path: string, value: unknown, error: unknown, binding: Binding | undefined): void {
    const { status, limits } = this.host;
    const label = binding?.label ?? path;
    if (error instanceof ApiFailure && error.code === 'edit_conflict') {
      const theirs = error.body.theirs as { value: unknown; revision: number; by: string };
      this.openConflict(path, label, value, theirs.value, theirs.revision, theirs.by);
    } else if (error instanceof ApiFailure && error.code === 'too_long') status.flash(editorStatus.textOverLimit(label, Number(error.body.limit)), 'error');
    else if (error instanceof ApiFailure && error.code === 'too_many' && path.endsWith('/callouts'))
      status.flash(editorStatus.tooManyCallouts(this.host.state.stepNumber(path.split('/')[1]!), limits.step_callout_max), 'error');
    else if (error instanceof ApiFailure && error.code === 'too_many') status.flash(editorStatus.tooManyTags(limits.guide_tag_max), 'error');
    else status.flash(editorStatus.commitFailed, 'error');
  }

  /** The two sides of a same-field change: the person chooses; Escape leaves the text uncommitted. */
  openConflict(path: string, label: string, yours: unknown, theirs: unknown, revision: number, by: string): void {
    if (this.conflicts.has(path)) return;
    this.conflicts.add(path);
    const shown = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));
    const keep = h('button', { type: 'button', class: 'button' }, 'Keep mine');
    const take = h('button', { type: 'button', class: 'button quiet' }, 'Take theirs');
    const dialog = openDialog('Edit conflict', [
      h('h2', {}, 'Edit conflict'),
      h('p', {}, editConflict(by, label)),
      h('h3', {}, 'Yours'), h('pre', { class: 'conflict-text' }, shown(yours)),
      h('h3', {}, 'Theirs'), h('pre', { class: 'conflict-text' }, shown(theirs)),
      dialogButtons(keep, take),
    ], { alert: true, onClose: () => this.conflicts.delete(path) });
    keep.addEventListener('click', async () => {
      dialog.close();
      if (await this.commit(path, yours, { basedOn: revision })) this.host.status.flash(editorStatus.keptYours(label));
    });
    take.addEventListener('click', () => {
      dialog.close();
      this.host.state.write(path, theirs, revision);
      this.host.state.lastBy.set(path, by);
      this.bindings.get(path)?.show(theirs);
      this.host.onApplied(path, true);
      this.host.status.flash(editorStatus.tookTheirs(by, label));
    });
  }

  /** A change made by someone else: applied at once unless this page holds uncommitted text in that field. */
  applyRemote(event: Extract<LiveEvent, { type: 'field' }>): void {
    const { state } = this.host;
    const binding = this.bindings.get(event.field);
    this.total = event.guide_total;
    this.host.onTotal(event.guide_total, event.guide_total_text);
    if (same(state.read(event.field), event.value)) {
      state.work.field_revisions[event.field] = Math.max(state.revision(event.field), event.field_revision);
      return;
    }
    if (binding?.pending() && !same(binding.current(), event.value)) {
      this.openConflict(event.field, binding.label, binding.current(), event.value, event.field_revision, event.by.name);
      return;
    }
    state.write(event.field, event.value, event.field_revision);
    state.lastBy.set(event.field, event.by.name);
    binding?.show(event.value);
    this.host.onApplied(event.field, true);
  }
}
