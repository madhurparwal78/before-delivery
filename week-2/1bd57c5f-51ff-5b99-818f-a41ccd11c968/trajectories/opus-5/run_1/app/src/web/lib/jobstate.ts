import { COPY, type ItemStatus, type Trade } from '../../shared/domain.js';
import { getJson, Offline, RequestFailed, sendJson } from './api.js';
import { announce, setOffline } from './shell.js';
import type {
  ChangeOrder,
  Costs,
  Item,
  Job,
  LocalItem,
  Member,
  OutboxEntry,
  PlanRevision,
  Point,
  Reveal,
  Room,
  SyncResult,
  Visit,
} from './types.js';

export type QueuedOp = {
  op_id: string;
  seq: number;
  type: 'create_item' | 'update_item' | 'item_action' | 'add_note' | 'edit_note';
  plan_revision?: number;
  client_item_id?: string;
  client_note_id?: string;
  item_id?: string;
  note_id?: string;
  action?: string;
  reason?: string;
  body?: string;
  audience?: 'crew' | 'everyone';
  parent_id?: string;
  base_rev?: number;
  pos?: number;
  delete?: number;
  insert?: string;
  fields?: Record<string, unknown>;
  changes?: Record<string, { from: unknown; to: unknown }>;
};

export type JobData = {
  job: Job;
  rooms: Room[];
  items: LocalItem[];
  members: Member[];
  visits: Visit[];
  revisions: PlanRevision[];
  costs: Costs | null;
  changeOrders: ChangeOrder[];
  outbox: OutboxEntry[];
  reveals: Reveal[];
  planImage: string | null;
};

const SEQ_KEY = 'snaglight.seq';

function nextSeq(): number {
  const current = Number(window.localStorage.getItem(SEQ_KEY) ?? '0') + 1;
  window.localStorage.setItem(SEQ_KEY, String(current));
  return current;
}

function uuid(): string {
  return crypto.randomUUID();
}

const NEXT_STATUS: Record<string, ItemStatus> = {
  start: 'in_progress',
  mark_done: 'ready_for_check',
  verify: 'verified',
  send_back: 'in_progress',
  reopen: 'open',
};

export class JobState {
  data: JobData | null = null;
  queue: QueuedOp[] = [];
  lastSeq = 0;
  private listeners = new Set<() => void>();
  private stream: EventSource | null = null;
  private timers: number[] = [];
  private roleEnded = false;
  private signedOut = false;

  constructor(readonly jobId: string) {
    this.queue = this.readQueue();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  get isRoleEnded(): boolean {
    return this.roleEnded;
  }

  get isSignedOut(): boolean {
    return this.signedOut;
  }

  /* ----------------------------------------------------------- persistence */

  private queueKey(): string {
    return `snaglight.queue.${this.jobId}`;
  }

  private cacheKey(): string {
    return `snaglight.cache.${this.jobId}`;
  }

  private readQueue(): QueuedOp[] {
    try {
      return JSON.parse(window.localStorage.getItem(this.queueKey()) ?? '[]') as QueuedOp[];
    } catch {
      return [];
    }
  }

  private writeQueue(): void {
    window.localStorage.setItem(this.queueKey(), JSON.stringify(this.queue));
  }

  private writeCache(): void {
    if (this.data === null) return;
    try {
      window.localStorage.setItem(
        this.cacheKey(),
        JSON.stringify({
          job: this.data.job,
          rooms: this.data.rooms,
          items: this.data.items.filter((item) => item.local !== true),
          members: this.data.members,
          visits: this.data.visits,
          planImage: this.data.planImage,
        }),
      );
    } catch {
      // A full store simply means the next offline load falls back to the network.
    }
  }

  private readCache(): Partial<JobData> | null {
    try {
      const raw = window.localStorage.getItem(this.cacheKey());
      return raw === null ? null : (JSON.parse(raw) as Partial<JobData>);
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------------- loading */

  async load(): Promise<void> {
    try {
      const job = await getJson<Job>(`/api/jobs/${this.jobId}`);
      const [rooms, items, members] = await Promise.all([
        getJson<{ rooms: Room[] }>(`/api/jobs/${this.jobId}/rooms`),
        getJson<{ items: Item[] }>(`/api/jobs/${this.jobId}/items`),
        getJson<{ members: Member[] }>(`/api/jobs/${this.jobId}/members`),
      ]);
      const data: JobData = {
        job,
        rooms: rooms.rooms,
        items: items.items,
        members: members.members,
        visits: [],
        revisions: [],
        costs: null,
        changeOrders: [],
        outbox: [],
        reveals: [],
        planImage: this.data?.planImage ?? this.readCache()?.planImage ?? null,
      };
      if (job.my_role !== 'homeowner') {
        try {
          data.visits = (await getJson<{ visits: Visit[] }>(`/api/jobs/${this.jobId}/visits`)).visits;
        } catch {
          data.visits = [];
        }
      }
      if (job.my_role === 'owner' || job.my_role === 'lead') {
        data.costs = await getJson<Costs>(`/api/jobs/${this.jobId}/costs`);
        data.changeOrders = (
          await getJson<{ change_orders: ChangeOrder[] }>(`/api/jobs/${this.jobId}/change-orders`)
        ).change_orders;
        data.revisions = (
          await getJson<{ revisions: PlanRevision[] }>(`/api/jobs/${this.jobId}/plan/revisions`)
        ).revisions;
      }
      if (job.my_role === 'owner') {
        data.outbox = (
          await getJson<{ entries: OutboxEntry[] }>(`/api/jobs/${this.jobId}/outbox`)
        ).entries;
        data.reveals = (
          await getJson<{ reveals: Reveal[] }>(`/api/jobs/${this.jobId}/access/reveals`)
        ).reveals;
      }
      this.data = data;
      setOffline(false);
      await this.cachePlanImage();
      this.replayQueueLocally();
      this.writeCache();
      this.emit();
    } catch (error) {
      if (error instanceof Offline) {
        setOffline(true);
        const cached = this.readCache();
        if (cached !== null && cached.job !== undefined) {
          this.data = {
            job: cached.job,
            rooms: cached.rooms ?? [],
            items: (cached.items ?? []) as LocalItem[],
            members: cached.members ?? [],
            visits: cached.visits ?? [],
            revisions: [],
            costs: null,
            changeOrders: [],
            outbox: [],
            reveals: [],
            planImage: cached.planImage ?? null,
          };
          this.replayQueueLocally();
          this.emit();
          return;
        }
      }
      if (error instanceof RequestFailed && error.body.error === 'role_ended') {
        this.roleEnded = true;
        this.emit();
        return;
      }
      if (error instanceof RequestFailed && error.status === 401) {
        this.signedOut = true;
        this.emit();
        return;
      }
      throw error;
    }
  }

  private async cachePlanImage(): Promise<void> {
    if (this.data === null || this.data.job.plan_url === null) return;
    try {
      const response = await fetch(`${this.data.job.plan_url}?r=${this.data.job.plan_revision}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      const blob = await response.blob();
      this.data.planImage = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(blob);
      });
    } catch {
      // The plan pane shows its unavailable copy when no image is held.
    }
  }

  /* -------------------------------------------------------------- the queue */

  private replayQueueLocally(): void {
    for (const op of this.queue) this.applyLocally(op);
  }

  itemByAnyId(id: string): LocalItem | undefined {
    return this.data?.items.find((item) => item.id === id || item.clientItemId === id);
  }

  private applyLocally(op: QueuedOp, markPending = true): void {
    const data = this.data;
    if (data === null) return;
    const mark = (item: LocalItem, key: string): void => {
      if (!markPending) return;
      item.pendingKeys = item.pendingKeys ?? [];
      item.pendingKeys.push(key);
    };
    if (op.type === 'create_item') {
      if (data.items.some((item) => item.clientItemId === op.client_item_id)) return;
      const fields = op.fields ?? {};
      data.items.push({
        id: op.client_item_id!,
        clientItemId: op.client_item_id,
        local: true,
        number: 0,
        title: String(fields.title ?? ''),
        room_id: String(fields.room_id ?? ''),
        trade: (fields.trade as Trade | null) ?? null,
        status: 'open',
        pin: (fields.pin as Point | null) ?? null,
        pin_status: fields.pin === undefined || fields.pin === null ? 'unpinned' : 'placed',
        blocked_by: [],
        created_by: { name: '', role: data.job.my_role },
        photos: [],
        notes: [],
        updated_at: new Date().toISOString(),
        cost_note: (fields.cost_note as string | null) ?? null,
        quantity: (fields.quantity as string | null) ?? null,
        unit_cost: (fields.unit_cost as string | null) ?? null,
        line_total: '0.00',
        conflicts: [],
        pendingKeys: markPending ? ['*'] : [],
      });
      return;
    }
    const item = op.item_id === undefined ? undefined : this.itemByAnyId(op.item_id);
    if (item === undefined) return;
    if (op.type === 'update_item') {
      for (const [key, change] of Object.entries(op.changes ?? {})) {
        mark(item, key);
        if (key === 'title') item.title = String(change.to);
        if (key === 'room_id') item.room_id = String(change.to);
        if (key === 'trade') item.trade = change.to as Trade | null;
        if (key === 'cost_note') item.cost_note = change.to as string | null;
        if (key === 'quantity') item.quantity = change.to as string | null;
        if (key === 'unit_cost') item.unit_cost = change.to as string | null;
        if (key === 'pin') {
          item.pin = change.to as Point | null;
          item.pin_status = change.to === null ? 'unpinned' : 'placed';
        }
      }
    } else if (op.type === 'item_action') {
      const next = NEXT_STATUS[op.action ?? ''];
      if (next !== undefined) item.status = next;
      mark(item, 'status');
    } else if (op.type === 'add_note') {
      item.notes.push({
        id: op.client_note_id!,
        body: op.body ?? '',
        audience: op.audience ?? 'everyone',
        author: { name: '', role: this.data!.job.my_role },
        rev: 0,
        created_at: new Date().toISOString(),
        replies: [],
      });
      mark(item, 'notes');
    } else if (op.type === 'edit_note') {
      const note = findNote(item, op.note_id ?? '');
      if (note !== undefined) {
        const points = Array.from(note.body);
        const head = points.slice(0, op.pos ?? 0).join('');
        const tail = points.slice((op.pos ?? 0) + (op.delete ?? 0)).join('');
        note.body = head + (op.insert ?? '') + tail;
      }
      mark(item, 'notes');
    }
  }

  /** Shows a change on screen before the server answers, without queueing it. */
  applyOptimistic(op: Omit<QueuedOp, 'op_id' | 'seq'>): void {
    this.applyLocally({ op_id: '', seq: 0, ...op }, false);
    this.emit();
  }

  enqueue(op: Omit<QueuedOp, 'op_id' | 'seq'>): QueuedOp {
    const full: QueuedOp = { op_id: uuid(), seq: nextSeq(), ...op };
    if (full.plan_revision === undefined && this.data?.job.plan_revision !== null) {
      if (full.type === 'create_item' || full.type === 'update_item') {
        full.plan_revision = this.data?.job.plan_revision ?? undefined;
      }
    }
    this.queue.push(full);
    this.writeQueue();
    this.applyLocally(full);
    this.emit();
    void this.scheduleSync();
    return full;
  }

  newClientItemId(): string {
    return uuid();
  }

  hasQueued(): boolean {
    return this.queue.length > 0;
  }

  pendingFor(item: LocalItem): boolean {
    return (item.pendingKeys ?? []).length > 0;
  }

  private syncing = false;

  async scheduleSync(): Promise<void> {
    if (this.queue.length === 0 || this.syncing) return;
    if (document.body.classList.contains('is-offline')) return;
    await this.sync();
  }

  async sync(): Promise<void> {
    if (this.queue.length === 0 || this.syncing) return;
    this.syncing = true;
    const sending = this.queue.slice(0, 200);
    try {
      const response = await sendJson<{
        results: SyncResult[];
        synced: number;
        conflicts: number;
      }>('POST', `/api/jobs/${this.jobId}/sync`, { ops: sending });
      setOffline(false);
      const removals: string[] = [];
      for (const result of response.results) {
        const op = sending.find((candidate) => candidate.op_id === result.op_id);
        if (op === undefined) continue;
        if (result.outcome !== 'rejected') continue;
        const message = rejectionMessage(result);
        if (op.type === 'create_item') {
          removals.push(`Item ${localNumberFor(this, op)} removed. Not saved: ${message}`);
          this.dropLocalItem(op.client_item_id ?? '');
        } else if (result.error?.error === 'not_found') {
          const item = op.item_id === undefined ? undefined : this.itemByAnyId(op.item_id);
          removals.push(
            `Item ${item?.number ?? localNumberFor(this, op)} removed. Not saved: ${message}`,
          );
          if (item !== undefined) this.dropLocalItem(item.id);
        } else {
          const item = op.item_id === undefined ? undefined : this.itemByAnyId(op.item_id);
          if (item !== undefined) item.notSaved = `Not saved: ${message}`;
        }
      }
      this.queue = this.queue.filter(
        (op) => !sending.some((sent) => sent.op_id === op.op_id),
      );
      this.writeQueue();
      const notSaved = new Map<string, string>();
      for (const item of this.data?.items ?? []) {
        if (item.notSaved) notSaved.set(item.id, item.notSaved);
      }
      await this.load();
      for (const item of this.data?.items ?? []) {
        const message = notSaved.get(item.id);
        if (message !== undefined) item.notSaved = message;
      }
      const sentence = `Sync complete: ${response.synced} synced, ${response.conflicts} to review.`;
      announce([sentence, ...removals].join(' '));
      this.emit();
    } catch (error) {
      if (error instanceof Offline) setOffline(true);
      else if (error instanceof RequestFailed && error.status === 401) this.signedOut = true;
      this.emit();
    } finally {
      this.syncing = false;
    }
  }

  private dropLocalItem(id: string): void {
    if (this.data === null) return;
    this.data.items = this.data.items.filter(
      (item) => item.id !== id && item.clientItemId !== id,
    );
    this.queue = this.queue.filter((op) => op.item_id !== id && op.client_item_id !== id);
    this.writeQueue();
  }

  /* ------------------------------------------------------------ live events */

  startStream(): void {
    this.stopStream();
    const source = new EventSource(
      `/api/jobs/${this.jobId}/events${this.lastSeq > 0 ? `?after=${this.lastSeq}` : ''}`,
    );
    this.stream = source;
    const handle = (type: string) => (event: MessageEvent<string>) => {
      this.lastSeq = Number(event.lastEventId || this.lastSeq);
      this.onEvent(type, JSON.parse(event.data) as Record<string, unknown>);
    };
    for (const type of [
      'item',
      'item_deleted',
      'room',
      'counts',
      'note',
      'plan',
      'visit',
      'visit_deleted',
      'costs',
      'job',
      'role_ended',
      'reset',
    ]) {
      source.addEventListener(type, handle(type) as EventListener);
    }
    source.addEventListener('open', () => setOffline(false));
    source.addEventListener('error', () => {
      if (!navigator.onLine) setOffline(true);
    });
  }

  stopStream(): void {
    this.stream?.close();
    this.stream = null;
  }

  private onEvent(type: string, payload: Record<string, unknown>): void {
    const data = this.data;
    if (data === null) return;
    switch (type) {
      case 'item': {
        const incoming = payload.item as Item;
        const at = data.items.findIndex((item) => item.id === incoming.id);
        const local = at === -1 ? undefined : data.items[at];
        const merged: LocalItem = { ...incoming };
        if (local !== undefined) {
          merged.pendingKeys = local.pendingKeys;
          merged.notSaved = local.notSaved;
        }
        if (at === -1) data.items.push(merged);
        else data.items[at] = merged;
        for (const op of this.queue) this.applyLocally(op);
        break;
      }
      case 'item_deleted':
        data.items = data.items.filter((item) => item.id !== payload.id);
        break;
      case 'room': {
        const incoming = payload.room as Room;
        const at = data.rooms.findIndex((room) => room.id === incoming.id);
        if (at === -1) data.rooms.push(incoming);
        else data.rooms[at] = incoming;
        break;
      }
      case 'counts': {
        data.job.progress = payload.progress as Job['progress'];
        for (const entry of payload.rooms as { id: string; counts: Room['counts'] }[]) {
          const room = data.rooms.find((candidate) => candidate.id === entry.id);
          if (room !== undefined) room.counts = entry.counts;
        }
        break;
      }
      case 'note': {
        const item = data.items.find((candidate) => candidate.id === payload.item_id);
        if (item === undefined) break;
        const incoming = payload.note as { id: string };
        const top = item.notes.findIndex((note) => note.id === incoming.id);
        if (top !== -1) item.notes[top] = payload.note as never;
        else {
          let placed = false;
          for (const note of item.notes) {
            const at = (note.replies ?? []).findIndex((reply) => reply.id === incoming.id);
            if (at !== -1) {
              note.replies![at] = payload.note as never;
              placed = true;
            }
          }
          if (!placed) item.notes.push(payload.note as never);
        }
        break;
      }
      case 'plan':
        data.job.plan_revision = payload.revision as number;
        data.job.plan_url = payload.plan_url as string;
        void this.cachePlanImage().then(() => this.emit());
        break;
      case 'visit': {
        const incoming = payload.visit as Visit;
        const at = data.visits.findIndex((visit) => visit.id === incoming.id);
        if (at === -1) data.visits.push(incoming);
        else data.visits[at] = incoming;
        break;
      }
      case 'visit_deleted':
        data.visits = data.visits.filter((visit) => visit.id !== payload.id);
        break;
      case 'costs':
        data.costs = payload as unknown as Costs;
        break;
      case 'job':
        data.job = payload.job as Job;
        break;
      case 'role_ended':
        this.roleEnded = true;
        this.stopStream();
        break;
      case 'reset':
        void this.load();
        break;
    }
    this.writeCache();
    this.emit();
  }

  /* --------------------------------------------------------------- refresh */

  startBackground(): void {
    this.timers.push(
      window.setInterval(() => {
        void this.refresh();
      }, 15_000),
    );
    this.timers.push(
      window.setInterval(() => {
        void this.scheduleSync();
      }, 3000),
    );
    const onFocus = (): void => void this.refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', () => {
      setOffline(false);
      void this.refresh();
      void this.scheduleSync();
      this.startStream();
    });
    window.addEventListener('offline', () => setOffline(true));
  }

  stop(): void {
    for (const timer of this.timers) window.clearInterval(timer);
    this.timers = [];
    this.stopStream();
  }

  async refresh(): Promise<void> {
    if (this.roleEnded || this.signedOut) return;
    try {
      await this.load();
    } catch {
      // The refresh is a fallback; the stream and the next tick keep trying.
    }
  }
}

function findNote(item: LocalItem, noteId: string): { body: string } | undefined {
  for (const note of item.notes) {
    if (note.id === noteId) return note;
    for (const reply of note.replies ?? []) if (reply.id === noteId) return reply;
  }
  return undefined;
}

function rejectionMessage(result: SyncResult): string {
  const error = result.error;
  if (error === null) return 'Not found.';
  const fields = error.fields;
  if (fields !== undefined) {
    const first = Object.values(fields)[0];
    if (typeof first === 'string') return first;
  }
  return error.message;
}

function localNumberFor(state: JobState, op: QueuedOp): string {
  const item =
    op.client_item_id !== undefined
      ? state.itemByAnyId(op.client_item_id)
      : op.item_id !== undefined
        ? state.itemByAnyId(op.item_id)
        : undefined;
  if (item === undefined) return 'new';
  return item.local === true ? 'new' : String(item.number);
}

export const OFFLINE_BANNER = COPY.offlineBanner;
