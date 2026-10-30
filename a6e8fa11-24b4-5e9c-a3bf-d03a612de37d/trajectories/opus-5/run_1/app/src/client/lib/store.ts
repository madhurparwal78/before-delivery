import {
  ConflictDto,
  SessionUser,
  SyncResponse,
  WorkbookSnapshotDto,
} from '../../shared/api';
import { Evaluation, evaluateWorkbook } from '../../shared/formula/evaluate';
import { LIMITS } from '../../shared/limits';
import { ClientOp } from '../../shared/ops';
import { applyOp } from '../../shared/ops';
import { cellKey, parseRangeRef, qualifiedRef, rangeCells } from '../../shared/refs';
import { WorkbookState, findSheetById } from '../../shared/workbook';
import { ApiFailure, NetworkFailure, api, newUuid, requestKey } from './api';
import { plural, reasonText } from './copy';
import { notify } from './notices';
import { stateFromSnapshot } from './workbookState';

export interface PendingEntry {
  op: ClientOp;
  baseSeq: number;
}

export interface FurrowEntry {
  sheetId: string;
  ref: string;
  depth: number;
  from: string;
  to: string;
  fromValue: number | null;
  toValue: number | null;
}

export interface ChangedCell {
  ref: string;
  from: string;
  to: string;
}

const WAVE_MS = 60;
const FADE_DELAY_MS = 600;
const FADE_MS = 600;
const STATIC_OUTLINE_MS = 1500;

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Listener = () => void;

export class WorkbookStore {
  snapshot: WorkbookSnapshotDto | null = null;
  conflicts: ConflictDto[] = [];
  pending: PendingEntry[] = [];
  syncing = false;
  syncFailed = false;
  online = navigator.onLine;
  notFound = false;
  state: WorkbookState | null = null;
  evaluation: Evaluation | null = null;
  furrowEntries: FurrowEntry[] = [];
  furrowLanded = new Set<string>();
  furrowFading = false;
  changedCells: ChangedCell[] = [];
  recalcMessage = '';
  rollbackCells = new Set<string>();
  readonly deviceId: string;

  private listeners = new Set<Listener>();
  private batchKey: string | null = null;
  private timers: number[] = [];
  private storageKey: string;
  private snapshotKey: string;

  constructor(
    readonly workbookId: string,
    readonly member: SessionUser,
  ) {
    this.storageKey = `furrowbook:pending:${member.id}:${workbookId}`;
    this.snapshotKey = `furrowbook:snapshot:${member.id}:${workbookId}`;
    const deviceKey = 'furrowbook:device';
    let device = window.localStorage.getItem(deviceKey);
    if (!device) {
      device = newUuid();
      window.localStorage.setItem(deviceKey, device);
    }
    this.deviceId = device;
    this.readPending();
    this.readCachedSnapshot();
  }

  /** The last read of the workbook is kept per member, so a reload with no signal still shows the grid. */
  private readCachedSnapshot(): void {
    const raw = window.localStorage.getItem(this.snapshotKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { workbook: WorkbookSnapshotDto; conflicts: ConflictDto[] };
      this.snapshot = parsed.workbook;
      this.conflicts = parsed.conflicts ?? [];
      this.recompute();
    } catch {
      window.localStorage.removeItem(this.snapshotKey);
    }
  }

  private writeCachedSnapshot(): void {
    if (!this.snapshot) return;
    try {
      window.localStorage.setItem(
        this.snapshotKey,
        JSON.stringify({ workbook: this.snapshot, conflicts: this.conflicts }),
      );
    } catch {
      window.localStorage.removeItem(this.snapshotKey);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private readPending(): void {
    const raw = window.localStorage.getItem(this.storageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { pending: PendingEntry[]; batchKey: string | null };
      this.pending = parsed.pending ?? [];
      this.batchKey = parsed.batchKey ?? null;
    } catch {
      this.pending = [];
    }
  }

  private writePending(): void {
    window.localStorage.setItem(
      this.storageKey,
      JSON.stringify({ pending: this.pending, batchKey: this.batchKey }),
    );
  }

  get headSeq(): number {
    return this.snapshot?.headSeq ?? 0;
  }

  get sheets(): WorkbookSnapshotDto['sheets'] {
    return this.snapshot?.sheets ?? [];
  }

  sheetName(sheetId: string): string {
    return this.state ? findSheetById(this.state, sheetId)?.name ?? '' : '';
  }

  refOf(sheetId: string, cell: string): string {
    return qualifiedRef(this.sheetName(sheetId), cell);
  }

  async load(): Promise<void> {
    try {
      const [workbook, conflicts] = await Promise.all([
        api<{ workbook: WorkbookSnapshotDto }>(`/api/workbooks/${this.workbookId}`),
        api<{ conflicts: ConflictDto[] }>(`/api/workbooks/${this.workbookId}/conflicts`),
      ]);
      this.snapshot = workbook.workbook;
      this.conflicts = conflicts.conflicts;
      this.online = true;
      this.writeCachedSnapshot();
      this.recompute();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 404) {
        this.notFound = true;
      } else if (failure instanceof NetworkFailure) {
        this.online = false;
      }
      this.emit();
    }
  }

  recompute(): void {
    if (!this.snapshot) return;
    const state = stateFromSnapshot(this.snapshot);
    let seq = this.snapshot.headSeq;
    for (const entry of this.pending) {
      seq += 1;
      applyOp(state, entry.op, seq, this.member.id);
    }
    this.state = state;
    this.evaluation = evaluateWorkbook(state, { timeZone: this.timeZone, nowMs: Date.now() });
    this.emit();
  }

  get timeZone(): string {
    return this.snapshot?.timeZone ?? this.member.timeZone;
  }

  pendingCells(): Set<string> {
    const marked = new Set<string>();
    for (const entry of this.pending) {
      const op = entry.op;
      if (op.type === 'setCell') marked.add(cellKey(op.sheetId, op.cell));
      if (op.type === 'setFormat') {
        const range = parseRangeRef(op.range);
        if (range) for (const ref of rangeCells(range)) marked.add(cellKey(op.sheetId, ref));
      }
    }
    return marked;
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  syncStatusText(): string {
    const count = this.pending.length;
    if (this.syncing) return `Syncing ${plural(count, 'edit', 'edits')}…`;
    if (!this.online) {
      return count > 0
        ? `Offline · ${plural(count, 'edit', 'edits')} waiting`
        : "Offline · edits will sync when you're back in range";
    }
    if (this.syncFailed) return 'Sync failed · retrying';
    return 'All edits synced';
  }

  /** A committed edit shows its effect at once and plays the recalc furrow. */
  commit(op: ClientOp, options: { furrow?: { sheetId: string; cell: string } } = {}): void {
    const baseSeq = this.pending.length > 0 ? (this.pending[0] as PendingEntry).baseSeq : this.headSeq;
    const before = options.furrow && this.evaluation ? this.snapshotDisplays() : null;
    this.pending = [...this.pending, { op, baseSeq }];
    this.writePending();
    this.recompute();
    if (options.furrow && before) this.playFurrow(options.furrow.sheetId, options.furrow.cell, before);
    void this.sync();
  }

  private snapshotDisplays(): Map<string, { display: string; value: number | null }> {
    const displays = new Map<string, { display: string; value: number | null }>();
    if (!this.state || !this.evaluation) return displays;
    for (const sheet of this.state.sheets) {
      for (const ref of sheet.cells.keys()) {
        const cell = this.evaluation.cell(sheet.id, ref);
        if (!cell) continue;
        displays.set(cellKey(sheet.id, ref), {
          display: cell.display,
          value: typeof cell.value === 'number' ? cell.value : null,
        });
      }
    }
    return displays;
  }

  private clearTimers(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers = [];
  }

  private playFurrow(
    sheetId: string,
    cell: string,
    before: Map<string, { display: string; value: number | null }>,
  ): void {
    if (!this.evaluation || !this.state) return;
    this.clearTimers();
    const closure = this.evaluation.closure(sheetId, cell);
    const entries: FurrowEntry[] = closure.map((entry) => {
      const key = cellKey(entry.sheetId, entry.ref);
      const now = this.evaluation?.cell(entry.sheetId, entry.ref);
      const previous = before.get(key);
      return {
        sheetId: entry.sheetId,
        ref: entry.ref,
        depth: Math.min(entry.depth, 8),
        from: previous?.display ?? '',
        to: now?.display ?? '',
        fromValue: previous?.value ?? null,
        toValue: now && typeof now.value === 'number' ? now.value : null,
      };
    });
    this.furrowEntries = entries;
    this.furrowLanded = new Set();
    this.furrowFading = false;
    this.changedCells = entries.map((entry) => ({
      ref: this.refOf(entry.sheetId, entry.ref),
      from: entry.from,
      to: entry.to,
    }));
    const sheetCount = new Set(entries.map((entry) => entry.sheetId)).size;
    const editedRef = this.refOf(sheetId, cell);
    this.recalcMessage =
      entries.length === 0
        ? `Edit to ${editedRef} changed no other cells.`
        : `Edit to ${editedRef} updated ${plural(entries.length, 'cell', 'cells')} on ` +
          `${plural(sheetCount, 'sheet', 'sheets')}.`;

    if (entries.length === 0) {
      this.emit();
      return;
    }

    if (reducedMotion()) {
      this.furrowLanded = new Set(entries.map((entry) => cellKey(entry.sheetId, entry.ref)));
      this.emit();
      this.timers.push(
        window.setTimeout(() => {
          this.furrowEntries = [];
          this.furrowLanded = new Set();
          this.emit();
        }, STATIC_OUTLINE_MS),
      );
      return;
    }

    const depths = [...new Set(entries.map((entry) => entry.depth))].sort((a, b) => a - b);
    for (const depth of depths) {
      const delay = (depth - 1) * WAVE_MS;
      this.timers.push(
        window.setTimeout(() => {
          for (const entry of entries) {
            if (entry.depth === depth) this.furrowLanded.add(cellKey(entry.sheetId, entry.ref));
          }
          this.emit();
        }, delay),
      );
    }
    const lastWave = (depths[depths.length - 1] - 1) * WAVE_MS;
    this.timers.push(
      window.setTimeout(() => {
        this.furrowFading = true;
        this.emit();
      }, lastWave + FADE_DELAY_MS),
    );
    this.timers.push(
      window.setTimeout(() => {
        this.furrowEntries = [];
        this.furrowLanded = new Set();
        this.furrowFading = false;
        this.emit();
      }, lastWave + FADE_DELAY_MS + FADE_MS),
    );
    this.emit();
  }

  furrowEntry(sheetId: string, ref: string): FurrowEntry | undefined {
    const key = cellKey(sheetId, ref);
    if (!this.furrowLanded.has(key)) return undefined;
    return this.furrowEntries.find((entry) => entry.sheetId === sheetId && entry.ref === ref);
  }

  isOutlined(sheetId: string, ref: string): boolean {
    return this.furrowLanded.has(cellKey(sheetId, ref));
  }

  /** Tab badges rise as waves land and end at that sheet's closure count. */
  badgeFor(sheetId: string): number {
    let count = 0;
    for (const entry of this.furrowEntries) {
      if (entry.sheetId !== sheetId) continue;
      if (this.furrowLanded.has(cellKey(entry.sheetId, entry.ref))) count += 1;
    }
    return count;
  }

  clearBadges(): void {
    this.furrowEntries = [];
    this.furrowLanded = new Set();
    this.emit();
  }

  async sync(): Promise<void> {
    if (this.syncing || this.pending.length === 0 || !this.snapshot) return;
    if (!this.batchKey) {
      this.batchKey = requestKey();
      this.writePending();
    }
    const batch = this.pending.slice(0, LIMITS.maxOpsPerBatch);
    const baseSeq = Math.min(batch[0].baseSeq, this.snapshot.headSeq);
    this.syncing = true;
    this.emit();
    try {
      const response = await api<SyncResponse>(`/api/workbooks/${this.workbookId}/sync`, {
        method: 'POST',
        key: this.batchKey,
        body: { deviceId: this.deviceId, baseSeq, ops: batch.map((entry) => entry.op) },
      });
      this.pending = this.pending.slice(batch.length);
      this.batchKey = null;
      this.writePending();
      this.syncFailed = false;
      this.online = true;
      this.handleResults(response, batch);
      await this.load();
    } catch (failure) {
      if (failure instanceof NetworkFailure) {
        this.online = false;
        this.syncFailed = false;
      } else if (failure instanceof ApiFailure) {
        this.syncFailed = true;
        if (failure.status === 422 || failure.status === 409 || failure.status === 404) {
          this.pending = this.pending.slice(batch.length);
          this.batchKey = null;
          this.writePending();
          notify(`Some edits could not be sent: ${failure.text}`);
          this.recompute();
        }
      }
    } finally {
      this.syncing = false;
      this.emit();
    }
  }

  private handleResults(response: SyncResponse, batch: PendingEntry[]): void {
    const rolledBack: string[] = [];
    for (const result of response.results) {
      const entry = batch.find((candidate) => candidate.op.opId === result.opId);
      if (!entry) continue;
      if (result.status === 'applied') continue;
      const op = entry.op;
      if (result.status === 'conflict' && op.type === 'setCell') {
        rolledBack.push(cellKey(op.sheetId, op.cell));
        notify(
          `${this.refOf(op.sheetId, op.cell)} conflicted with ${result.current.author.name}'s edit. ` +
            'Your value is in the conflict tray.',
        );
        continue;
      }
      if (result.status === 'rejected') {
        const target = this.targetOf(op);
        if (op.type === 'setCell') rolledBack.push(cellKey(op.sheetId, op.cell));
        notify(`Edit to ${target} was rolled back: ${reasonText(result.reason)}.`);
      }
    }
    if (rolledBack.length > 0) {
      this.rollbackCells = new Set(rolledBack);
      this.emit();
      window.setTimeout(() => {
        this.rollbackCells = new Set();
        this.emit();
      }, 500);
    }
  }

  private targetOf(op: ClientOp): string {
    switch (op.type) {
      case 'setCell':
        return this.refOf(op.sheetId, op.cell);
      case 'setFormat':
        return `${this.sheetName(op.sheetId)}!${op.range}`;
      case 'addSheet':
      case 'renameSheet':
        return op.name;
      case 'addChart':
        return op.title;
      case 'removeChart':
        return this.state?.charts.find((chart) => chart.id === op.chartId)?.title ?? 'a chart';
    }
  }

  async resolveConflict(conflict: ConflictDto, choice: 'reapply' | 'keep_current'): Promise<void> {
    try {
      await api(`/api/workbooks/${this.workbookId}/conflicts/${conflict.id}/resolve`, {
        method: 'POST',
        body: { choice },
      });
      notify(
        choice === 'reapply'
          ? `Your value is back in ${conflict.ref}.`
          : `Kept the current value in ${conflict.ref}.`,
      );
      await this.load();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        notify(`Can't re-apply: ${reasonText(failure.code)}.`);
      } else {
        notify("Can't re-apply: the network is unavailable.");
      }
    }
  }

  dispose(): void {
    this.clearTimers();
    this.listeners.clear();
  }
}
