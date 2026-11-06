import { FIELD_MESSAGES } from "../../shared/catalogue";
import { deriveCounts } from "../../shared/counts";
import {
  STATUS_LABELS,
  TRADE_LABELS,
  type BulkAction,
  type EditableField,
  type ErrorBody,
  type FieldChanges,
  type Item,
  type ItemAction,
  type ItemFields,
  type Job,
  type Note,
  type NoteAudience,
  type Photo,
  type PhotoKind,
  type Pin,
  type Progress,
  type Reply,
  type Room,
  type SyncOp,
  type SyncResponse,
  type Trade,
  type User,
} from "../../shared/domain";
import { applyFieldPatch, type FieldPatch } from "../../shared/fields";
import { roomForPin } from "../../shared/geometry";
import { provisionalStatus } from "../../shared/lifecycle";
import { ApiFailure, NetworkError, api } from "../api";
import { cache, type JobSnapshot, type StoredQueue } from "../cache";
import { COPY, numberText } from "../copy";

// One open job in the browser: the last server snapshot, the changes still in flight or
// queued on the device, and the view the list and plan draw — the snapshot with every
// pending change applied on top, so the screen shows work before the server answers. The
// job's event stream keeps the snapshot in step with every other device.

type Phase = "loading" | "ready" | "not_found" | "role_ended" | "unavailable";

const SYNC_BATCH = 200;
const RECONNECT_MS = 2_000;
const PUBLISHED_FIELD_MESSAGES: readonly string[] = Object.values(FIELD_MESSAGES);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewOp = DistributiveOmit<SyncOp, "op_id" | "seq">;

function newId(): string {
  return crypto.randomUUID();
}

/** The editable fields of an item; a role that never sees costs holds none. */
function fieldsOf(item: Item): ItemFields {
  return {
    title: item.title,
    room_id: item.room_id,
    trade: item.trade,
    cost_note: item.cost_note ?? null,
    quantity: item.quantity ?? null,
    unit_cost: item.unit_cost ?? null,
    pin: item.pin,
  };
}

function itemOf(op: SyncOp): string {
  return op.type === "create_item" ? op.client_item_id : op.item_id;
}

/** The text a refusal shows: its published field message when it carries one, else the catalogue message. */
function refusalText(error: ErrorBody): string {
  return Object.values(error.fields ?? {}).find((message) => PUBLISHED_FIELD_MESSAGES.includes(message)) ?? error.message;
}

/** The longest common start, then the longest common end of what remains, in code points: one edit. */
function noteEdit(before: string, after: string): { pos: number; delete: number; insert: string } | null {
  const a = [...before];
  const b = [...after];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;
  const removed = a.length - start - end;
  const inserted = b.slice(start, b.length - end).join("");
  if (removed === 0 && inserted === "") return null;
  return { pos: start, delete: removed, insert: inserted };
}

function spliceNote(body: string, edit: { pos: number; delete: number; insert: string }): string {
  const points = [...body];
  points.splice(edit.pos, edit.delete, ...edit.insert);
  return points.join("");
}

/** Open sessions; the moment the connection returns, each sends its queue and catches up. */
const openSessions = new Set<JobSession>();
window.addEventListener("online", () => {
  for (const session of openSessions) session.reconnect();
});

interface JobView {
  items: Item[];
  rooms: Room[];
  progress: Progress;
  waiting: Set<string>;
}

type LiveTopic = "visits" | "costs";

export class JobSession {
  phase: Phase = "loading";
  snapshot: JobSnapshot | null = null;
  /** Bumped whenever the plan image changes, so the plan pane reloads it. */
  planVersion = 0;
  readonly rowNotes = new Map<string, string>();
  readonly uploading = new Set<string>();
  private queue: StoredQueue;
  private inflight: SyncOp[] = [];
  private syncing = false;
  private refreshing = false;
  private settledChanges = 0;
  private version = 0;
  private cachedView: { version: number; view: JobView } | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly topics = new Map<LiveTopic, Set<() => void>>();
  private stream: EventSource | null = null;
  private lastSeq: number | null = null;
  private reconnectTimer = 0;
  private closed = false;

  constructor(
    readonly jobId: string,
    readonly user: User,
    private readonly announce: (message: string) => void,
  ) {
    this.queue = cache.queue(user.email, jobId);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Listens for live changes a tab shows beside the punch list (visits, costs). */
  watch(topic: LiveTopic, listener: () => void): () => void {
    const set = this.topics.get(topic) ?? new Set();
    set.add(listener);
    this.topics.set(topic, set);
    return () => set.delete(listener);
  }

  /** Starts loading and keeps the queue syncing and the stream open until the returned function closes the session. */
  open(): () => void {
    openSessions.add(this);
    void this.start();
    return () => {
      this.closed = true;
      openSessions.delete(this);
      this.closeStream();
      window.clearTimeout(this.reconnectTimer);
    };
  }

  getVersion = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private saveQueue(): void {
    cache.saveQueue(this.user.email, this.jobId, this.queue);
  }

  private saveSnapshot(): void {
    if (this.snapshot) cache.saveJob(this.user.email, this.snapshot);
  }

  /** The id an item has on the server, following a queued creation once it has synced. */
  serverId(id: string): string {
    return this.queue.ids[id] ?? id;
  }

  private isUnsynced(id: string): boolean {
    return this.queue.ids[id] === undefined && this.queue.ops.some((op) => op.type === "create_item" && op.client_item_id === id);
  }

  // ---------- The view ----------

  view(): JobView {
    if (this.cachedView?.version === this.version) return this.cachedView.view;
    const snapshot = this.snapshot;
    const rooms = snapshot?.rooms ?? [];
    const items = this.overlay(snapshot?.items ?? [], [...this.queue.ops, ...this.inflight], rooms);
    const counts = deriveCounts(items, rooms.map((room) => room.id));
    const view: JobView = {
      items,
      rooms: rooms.map((room) => ({ ...room, counts: counts.rooms.get(room.id) ?? { verified: 0, total: 0 } })),
      progress: counts.progress,
      waiting: new Set(this.queue.ops.map((op) => this.serverId(itemOf(op)))),
    };
    this.cachedView = { version: this.version, view };
    return view;
  }

  private overlay(serverItems: Item[], ops: SyncOp[], rooms: Room[]): Item[] {
    const items = serverItems.map((item) => ({ ...item }));
    const find = (id: string) => items.find((item) => item.id === this.serverId(id));
    const order = new Map(rooms.map((room, index) => [room.id, index]));
    const author = { name: this.user.name, role: this.snapshot?.job.my_role ?? "owner" };
    for (const op of ops) {
      if (op.type === "create_item") {
        if (find(op.client_item_id)) continue;
        items.push({
          id: op.client_item_id,
          number: 0,
          title: op.fields.title ?? "",
          room_id: op.fields.room_id ?? rooms[0]?.id ?? "",
          trade: op.fields.trade ?? null,
          status: "open",
          pin: op.fields.pin ?? null,
          pin_status: op.fields.pin ? "placed" : "unpinned",
          blocked_by: [],
          created_by: author,
          photos: [],
          notes: [],
          updated_at: new Date().toISOString(),
        });
        continue;
      }
      const item = find(op.item_id);
      if (!item) continue;
      if (op.type === "update_item") {
        const patch = Object.fromEntries(Object.entries(op.changes).map(([field, change]) => [field, change?.to])) as FieldPatch;
        const outcome = applyFieldPatch({ fields: fieldsOf(item), pinStatus: item.pin_status }, patch, rooms);
        if (outcome.ok) {
          Object.assign(item, Object.fromEntries(outcome.changed.map((field) => [field, outcome.fields[field]])));
          item.pin_status = outcome.pinStatus;
        }
      } else if (op.type === "item_action") {
        item.status = provisionalStatus(op.action, item.status) ?? item.status;
      } else if (op.type === "add_note") {
        const note: Reply = { id: op.client_note_id, body: op.body, audience: op.audience, author, rev: 0, created_at: new Date().toISOString() };
        item.notes = op.parent_id
          ? item.notes.map((parent) => (parent.id === op.parent_id ? { ...parent, replies: [...parent.replies, note] } : parent))
          : [...item.notes, { ...note, replies: [] }];
      } else {
        item.notes = item.notes.map((note) =>
          note.id === op.note_id ? { ...note, body: spliceNote(note.body, op) } : note,
        );
      }
    }
    return items.sort((a, b) => (order.get(a.room_id) ?? 0) - (order.get(b.room_id) ?? 0) || (a.number || Infinity) - (b.number || Infinity));
  }

  // ---------- Loading, refreshing and the live stream ----------

  private async start(): Promise<void> {
    const cached = cache.job(this.user.email, this.jobId);
    if (cached) {
      this.snapshot = cached;
      this.phase = "ready";
      this.changed();
    }
    if (navigator.onLine) {
      await this.refresh();
      this.connect();
    }
    if (this.phase === "loading") {
      this.phase = cached ? "ready" : "unavailable";
      this.changed();
    }
    void this.flush();
  }

  /** Re-reads the job, rooms and items. Changes settled while it ran keep their newer items. */
  async refresh(): Promise<void> {
    if (!navigator.onLine || this.refreshing || this.phase === "role_ended") return;
    this.refreshing = true;
    const settled = this.settledChanges;
    try {
      const base = `/api/jobs/${this.jobId}`;
      const [job, { rooms }, { items }] = await Promise.all([
        api<Job>("GET", base),
        api<{ rooms: Room[] }>("GET", `${base}/rooms`),
        api<{ items: Item[] }>("GET", `${base}/items`),
      ]);
      const keepItems = settled !== this.settledChanges && this.snapshot;
      if (this.snapshot?.job.plan_url !== job.plan_url || this.snapshot?.job.plan_revision !== job.plan_revision) this.planVersion += 1;
      this.snapshot = { job, rooms, items: keepItems ? this.snapshot!.items : items };
      this.phase = "ready";
      this.saveSnapshot();
      this.changed();
      for (const topic of this.topics.values()) for (const listener of topic) listener();
    } catch (error) {
      this.handleJobFailure(error);
    } finally {
      this.refreshing = false;
    }
  }

  private handleJobFailure(error: unknown): void {
    if (error instanceof NetworkError) return;
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === "role_ended") {
      this.phase = "role_ended";
      this.closeStream();
    } else if (error.code === "not_found") this.phase = "not_found";
    this.changed();
  }

  /** Called when the connection returns: resend the queue, resume the stream, catch up. */
  reconnect(): void {
    void this.flush();
    if (!this.stream) this.connect();
    void this.refresh();
  }

  private connect(): void {
    if (this.closed || this.stream || !navigator.onLine || this.phase === "role_ended" || this.phase === "not_found") return;
    const resume = this.lastSeq === null ? "" : `?after=${this.lastSeq}`;
    const stream = new EventSource(`/api/jobs/${this.jobId}/events${resume}`);
    this.stream = stream;
    const fresh = this.lastSeq === null;
    stream.onopen = () => {
      // The server is reachable again: a queue whose last send never arrived goes now.
      void this.flush();
      // Without a resume point the stream carries only later commits; a read now covers the rest.
      if (fresh && this.lastSeq === null) void this.refresh();
    };
    stream.onerror = () => {
      if (stream.readyState !== EventSource.CLOSED) return;
      if (this.stream === stream) this.stream = null;
      // A refused reconnect means the session or the role ended: a read now says which.
      void this.refresh();
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => this.connect(), RECONNECT_MS);
    };
    const types = ["item", "item_deleted", "room", "counts", "note", "plan", "visit", "visit_deleted", "costs", "job", "role_ended", "reset"];
    for (const type of types) {
      stream.addEventListener(type, (event) => {
        const message = event as MessageEvent<string>;
        if (message.lastEventId) this.lastSeq = Number(message.lastEventId);
        this.apply(type, JSON.parse(message.data) as Record<string, unknown>);
      });
    }
  }

  private closeStream(): void {
    this.stream?.close();
    this.stream = null;
  }

  private notify(topic: LiveTopic): void {
    for (const listener of this.topics.get(topic) ?? []) listener();
  }

  /** Applies one event in place; nothing here closes a row's details, a dialog or a draft. */
  private apply(type: string, data: Record<string, unknown>): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    switch (type) {
      case "item":
        this.upsert(data.item as Item);
        break;
      case "item_deleted":
        this.removeItem(data.id as string);
        break;
      case "room": {
        const room = data.room as Room;
        const rooms = snapshot.rooms.some((existing) => existing.id === room.id)
          ? snapshot.rooms.map((existing) => (existing.id === room.id ? room : existing))
          : [...snapshot.rooms, room];
        this.snapshot = { ...snapshot, rooms };
        this.saveSnapshot();
        break;
      }
      case "note": {
        const note = data.note as Note | Reply;
        const itemId = data.item_id as string;
        if ("replies" in note) {
          this.patchItem(itemId, (item) => ({
            ...item,
            notes: item.notes.some((existing) => existing.id === note.id)
              ? item.notes.map((existing) => (existing.id === note.id ? note : existing))
              : [...item.notes, note],
          }));
        } else void this.reloadItem(itemId);
        break;
      }
      case "plan":
        this.snapshot = { ...snapshot, job: { ...snapshot.job, plan_url: data.plan_url as string | null, plan_revision: data.revision as number | null } };
        this.planVersion += 1;
        this.saveSnapshot();
        break;
      case "job":
        this.snapshot = { ...snapshot, job: data.job as Job };
        this.saveSnapshot();
        break;
      case "visit":
      case "visit_deleted":
        this.notify("visits");
        return;
      case "costs":
        this.notify("costs");
        return;
      case "role_ended":
        this.phase = "role_ended";
        this.closeStream();
        break;
      case "reset":
        void this.refresh();
        return;
      default:
        return;
    }
    this.changed();
  }

  private async reloadItem(itemId: string): Promise<void> {
    try {
      this.upsert(await api<Item>("GET", `/api/jobs/${this.jobId}/items/${itemId}`));
      this.changed();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "not_found") {
        this.removeItem(itemId);
        this.changed();
      }
    }
  }

  /** Applies job-level changes made elsewhere in the view (stage moves, plan upload, new rooms). */
  setSnapshot(update: Partial<JobSnapshot>): void {
    if (!this.snapshot) return;
    if (update.job && (update.job.plan_url !== this.snapshot.job.plan_url || update.job.plan_revision !== this.snapshot.job.plan_revision)) {
      this.planVersion += 1;
    }
    this.snapshot = { ...this.snapshot, ...update };
    this.saveSnapshot();
    this.changed();
  }

  private upsert(item: Item): void {
    if (!this.snapshot) return;
    const items = this.snapshot.items.filter((existing) => existing.id !== item.id);
    this.snapshot = { ...this.snapshot, items: [...items, item] };
    this.saveSnapshot();
  }

  private removeItem(itemId: string): void {
    if (!this.snapshot) return;
    this.snapshot = { ...this.snapshot, items: this.snapshot.items.filter((item) => item.id !== itemId) };
    this.saveSnapshot();
  }

  private patchItem(itemId: string, change: (item: Item) => Item): void {
    if (!this.snapshot) return;
    this.snapshot = { ...this.snapshot, items: this.snapshot.items.map((item) => (item.id === itemId ? change(item) : item)) };
    this.saveSnapshot();
  }

  // ---------- Changes ----------

  private stamp(op: NewOp): SyncOp {
    const seq = this.queue.nextSeq;
    this.queue.nextSeq = seq + 1;
    this.saveQueue();
    return { ...op, op_id: newId(), seq } as SyncOp;
  }

  private enqueue(op: SyncOp): void {
    const target = this.snapshot?.items.find((item) => item.id === this.serverId(itemOf(op)));
    if (target) this.queue.numbers[target.id] = target.number;
    this.queue.ops.push(op);
    this.saveQueue();
    this.changed();
    void this.flush();
  }

  /**
   * Makes a change: online it goes straight to its endpoint; offline, or behind queued work,
   * it joins the queue. Answers the server's refusal, if any, for the caller to show.
   */
  private async run<T>(op: SyncOp, call: () => Promise<T>, success: (result: T) => string): Promise<ApiFailure | null> {
    this.rowNotes.delete(this.serverId(itemOf(op)));
    const target = itemOf(op);
    if (!navigator.onLine || this.queue.ops.length > 0 || (op.type !== "create_item" && this.isUnsynced(target))) {
      this.enqueue(op);
      return null;
    }
    this.inflight.push(op);
    this.changed();
    this.announce(COPY.saving);
    try {
      const result = await call();
      this.settledChanges += 1;
      this.announce(success(result));
      return null;
    } catch (error) {
      if (error instanceof NetworkError) {
        this.queue.ops.push(op);
        this.saveQueue();
        return null;
      }
      if (error instanceof ApiFailure) {
        if (error.code === "role_ended") this.handleJobFailure(error);
        return error;
      }
      throw error;
    } finally {
      this.inflight = this.inflight.filter((pending) => pending !== op);
      this.changed();
    }
  }

  private refuse(itemId: string, failure: ApiFailure | null): void {
    if (!failure) return;
    const text = `Not saved: ${refusalText(failure.body)}`;
    this.rowNotes.set(itemId, text);
    this.announce(text);
    this.changed();
  }

  private stampRevision(): { plan_revision?: number } {
    const revision = this.snapshot?.job.plan_revision;
    return typeof revision === "number" ? { plan_revision: revision } : {};
  }

  private saveItem = async (path: string, method: string, body: unknown): Promise<Item> => {
    const item = await api<Item>(method, path, body);
    this.upsert(item);
    return item;
  };

  async addItem(title: string, roomId: string): Promise<void> {
    const op = this.stamp({ type: "create_item", client_item_id: newId(), fields: { title, room_id: roomId } });
    const failure = await this.run(
      op,
      () => this.saveItem(`/api/jobs/${this.jobId}/items`, "POST", { title, room_id: roomId }),
      (item) => `Item ${item.number} saved.`,
    );
    if (failure) this.announce(`Not saved: ${refusalText(failure.body)}`);
  }

  async edit(item: Item, patch: FieldPatch): Promise<void> {
    const current = fieldsOf(item);
    const changes = Object.fromEntries(
      (Object.keys(patch) as EditableField[]).map((field) => [field, { from: current[field], to: patch[field] }]),
    ) as FieldChanges;
    const op = this.stamp({ type: "update_item", item_id: item.id, ...("pin" in patch ? this.stampRevision() : {}), changes });
    const failure = await this.run(
      op,
      () => this.saveItem(`/api/jobs/${this.jobId}/items/${this.serverId(item.id)}`, "PATCH", patch),
      (saved) => `Item ${saved.number} saved.`,
    );
    this.refuse(item.id, failure);
  }

  /** Drops a pin; answers the refusal message when no room contains it. */
  async dropPin(item: Item, pin: Pin): Promise<string | null> {
    const rooms = this.snapshot?.rooms ?? [];
    const local = roomForPin(rooms, pin, [item.room_id]);
    if (!navigator.onLine && !local) {
      this.announce(FIELD_MESSAGES.pin);
      return FIELD_MESSAGES.pin;
    }
    const op = this.stamp({ type: "update_item", item_id: item.id, ...this.stampRevision(), changes: { pin: { from: item.pin, to: pin } } });
    const failure = await this.run(
      op,
      () => this.saveItem(`/api/jobs/${this.jobId}/items/${this.serverId(item.id)}`, "PATCH", { pin }),
      (saved) => `Pin dropped for item ${saved.number} in ${rooms.find((room) => room.id === saved.room_id)?.name ?? ""}.`,
    );
    if (!failure) {
      if (this.queue.ops.includes(op)) this.announce(`Pin dropped for item ${numberText(item.number)} in ${local?.name ?? ""}.`);
      return null;
    }
    const message = refusalText(failure.body);
    this.announce(message);
    return message;
  }

  async act(item: Item, action: ItemAction, reason?: string): Promise<boolean> {
    const extra = reason !== undefined ? { reason } : {};
    const op = this.stamp({ type: "item_action", item_id: item.id, action, ...extra });
    const failure = await this.run(
      op,
      async () => {
        const saved = await api<Item & { reopened_dependents?: number[] }>(
          "POST",
          `/api/jobs/${this.jobId}/items/${this.serverId(item.id)}/actions`,
          { action, ...extra },
        );
        this.upsert(saved);
        if (saved.reopened_dependents?.length) void this.refresh();
        return saved;
      },
      (saved) => `Item ${saved.number}: ${STATUS_LABELS[saved.status]}.`,
    );
    this.refuse(item.id, failure);
    return failure === null;
  }

  async note(item: Item, body: string, audience: NoteAudience, parentId: string | null): Promise<boolean> {
    const op = this.stamp({ type: "add_note", item_id: item.id, client_note_id: newId(), body, audience, parent_id: parentId });
    const failure = await this.run(
      op,
      async () => {
        await api<Note | Reply>("POST", `/api/jobs/${this.jobId}/items/${this.serverId(item.id)}/notes`, { body, audience, parent_id: parentId });
        await this.reloadItem(this.serverId(item.id));
      },
      () => "Note posted.",
    );
    this.refuse(item.id, failure);
    return failure === null;
  }

  /** Saves a note editor's text as one edit against the revision it opened at. Answers false to keep the draft. */
  async editNote(item: Item, note: Reply, baseRev: number, original: string, text: string): Promise<boolean> {
    const edit = noteEdit(original, text);
    if (!edit) return true;
    const op = this.stamp({ type: "edit_note", item_id: item.id, note_id: note.id, base_rev: baseRev, ...edit });
    const failure = await this.run(
      op,
      async () => {
        await api<Note | Reply>("POST", `/api/jobs/${this.jobId}/items/${this.serverId(item.id)}/notes/${note.id}/edits`, {
          base_rev: baseRev,
          ...edit,
        });
        await this.reloadItem(this.serverId(item.id));
      },
      () => "Note updated.",
    );
    this.refuse(item.id, failure);
    return failure === null;
  }

  async undoRedo(item: Item, note: Reply, which: "undo" | "redo"): Promise<void> {
    this.announce(COPY.saving);
    try {
      await api<Note | Reply>("POST", `/api/jobs/${this.jobId}/items/${this.serverId(item.id)}/notes/${note.id}/${which}`);
      await this.reloadItem(this.serverId(item.id));
      this.announce(which === "undo" ? "Edit undone." : "Edit redone.");
    } catch (error) {
      this.announce(`Not saved: ${error instanceof ApiFailure ? refusalText(error.body) : COPY.needsConnection}`);
    }
  }

  async uploadPhoto(item: Item, kind: PhotoKind, file: File): Promise<void> {
    const id = this.serverId(item.id);
    this.uploading.add(item.id);
    this.changed();
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file);
    try {
      const photo = await api<Photo>("POST", `/api/jobs/${this.jobId}/items/${id}/photos`, form);
      this.patchItem(id, (current) => ({ ...current, photos: [...current.photos.filter((existing) => existing.id !== photo.id), photo] }));
      this.settledChanges += 1;
      this.announce("Photo saved.");
    } catch (error) {
      this.announce(error instanceof ApiFailure ? error.message : COPY.photosOffline);
    } finally {
      this.uploading.delete(item.id);
      this.changed();
    }
  }

  async removePhoto(item: Item, photo: Photo): Promise<void> {
    this.announce(COPY.saving);
    try {
      await api("DELETE", `/api/jobs/${this.jobId}/photos/${photo.id}`);
      this.patchItem(item.id, (current) => ({ ...current, photos: current.photos.filter((existing) => existing.id !== photo.id) }));
      this.settledChanges += 1;
      this.announce("Photo removed.");
      this.changed();
    } catch (error) {
      this.announce(error instanceof ApiFailure ? error.message : COPY.photosOffline);
    }
  }

  async resolve(item: Item, field: EditableField, value: Item[EditableField]): Promise<void> {
    this.announce(COPY.saving);
    try {
      this.upsert(await api<Item>("POST", `/api/jobs/${this.jobId}/items/${item.id}/resolve`, { field, value }));
      this.settledChanges += 1;
      this.announce("Conflict resolved.");
      this.changed();
    } catch (error) {
      this.announce(error instanceof ApiFailure ? refusalText(error.body) : COPY.needsConnection);
    }
  }

  async deleteItem(item: Item): Promise<boolean> {
    this.announce(COPY.saving);
    try {
      await api("DELETE", `/api/jobs/${this.jobId}/items/${item.id}`);
      this.removeItem(item.id);
      this.settledChanges += 1;
      this.announce(`Item ${item.number} deleted.`);
      this.changed();
      return true;
    } catch (error) {
      this.announce(`Not saved: ${error instanceof ApiFailure ? refusalText(error.body) : COPY.needsConnection}`);
      return false;
    }
  }

  async setBlockers(item: Item, itemIds: string[]): Promise<boolean> {
    this.announce(COPY.saving);
    try {
      const saved = await this.saveItem(`/api/jobs/${this.jobId}/items/${item.id}/blocked-by`, "PUT", { item_ids: itemIds });
      this.settledChanges += 1;
      this.announce(`Item ${saved.number} saved.`);
      this.changed();
      return true;
    } catch (error) {
      const text = `Not saved: ${error instanceof ApiFailure ? refusalText(error.body) : COPY.needsConnection}`;
      this.rowNotes.set(item.id, text);
      this.announce(text);
      this.changed();
      return false;
    }
  }

  /** An all-or-nothing bulk action; answers the failure lines when nothing changed. */
  async bulk(action: BulkAction, items: Item[], trade?: Trade | null): Promise<string[] | null> {
    this.announce(COPY.saving);
    try {
      const { items: saved } = await api<{ items: Item[] }>("POST", `/api/jobs/${this.jobId}/items/bulk`, {
        action,
        item_ids: items.map((item) => item.id),
        ...(action === "set_trade" ? { trade: trade ?? null } : {}),
      });
      for (const item of saved) this.upsert(item);
      this.settledChanges += 1;
      this.changed();
      this.announce(
        action === "set_trade"
          ? `${items.length} items assigned to ${trade ? TRADE_LABELS[trade] : "No trade"}.`
          : `${items.length} items checked off.`,
      );
      return null;
    } catch (error) {
      if (!(error instanceof ApiFailure)) {
        this.announce(COPY.needsConnection);
        return null;
      }
      this.announce(`Not saved: ${refusalText(error.body)}`);
      const failures = (error.body as ErrorBody & { failures?: { number: number; message: string }[] }).failures ?? [];
      return failures.map((failure) => `Item ${failure.number}: ${failure.message}`);
    }
  }

  // ---------- Syncing the queue ----------

  /**
   * Sends queued changes through the sync endpoint and settles each row. A rejected change
   * reverts its row to the server's values with the not-saved text, or removes the row when
   * its item never came to be or is gone. When the request never arrives, the queue waits
   * for the next retry; the server's operation log makes resending safe.
   */
  async flush(): Promise<void> {
    if (this.syncing || !navigator.onLine || this.queue.ops.length === 0 || this.phase !== "ready") return;
    this.syncing = true;
    const batch = this.queue.ops.slice(0, SYNC_BATCH);
    let delivered = false;
    try {
      const response = await api<SyncResponse>("POST", `/api/jobs/${this.jobId}/sync`, { ops: batch });
      const removed: string[] = [];
      const gone = new Set<string>();
      for (const result of response.results) {
        const op = batch.find((candidate) => candidate.op_id === result.op_id);
        if (!op) continue;
        if (result.item) {
          if (op.type === "create_item") this.queue.ids[op.client_item_id] = result.item.id;
          this.upsert(result.item);
        }
        if (result.outcome !== "rejected" || !result.error) continue;
        const target = this.serverId(itemOf(op));
        const message = refusalText(result.error);
        if (result.item) this.rowNotes.set(target, `Not saved: ${message}`);
        else if (!gone.has(target)) {
          gone.add(target);
          removed.push(`Item ${numberText(this.queue.numbers[target] ?? 0)} removed. Not saved: ${message}`);
          this.removeItem(target);
        }
      }
      const done = new Set(response.results.map((result) => result.op_id));
      this.queue.ops = this.queue.ops.filter((op) => !done.has(op.op_id) && !gone.has(this.serverId(itemOf(op))));
      const queued = new Set(this.queue.ops.map((op) => this.serverId(itemOf(op))));
      for (const id of Object.keys(this.queue.numbers)) if (!queued.has(id)) delete this.queue.numbers[id];
      this.saveQueue();
      this.settledChanges += 1;
      this.changed();
      this.announce([`Sync complete: ${response.synced} synced, ${response.conflicts} to review.`, ...removed].join(" "));
      delivered = true;
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "job_closed") {
        for (const op of batch) this.rowNotes.set(this.serverId(itemOf(op)), `Not saved: ${error.message}`);
        this.queue.ops = this.queue.ops.filter((op) => !batch.includes(op));
        this.saveQueue();
        this.changed();
      } else this.handleJobFailure(error);
    } finally {
      this.syncing = false;
    }
    if (!delivered) return;
    await this.refresh();
    if (this.queue.ops.length > 0) void this.flush();
  }
}
