import { WorkCalendar, type IsoDate } from "../shared/calendar";
import { canonicalPredecessors } from "../shared/predecessors";
import type {
  AppConfig,
  ChangeNote,
  Comment,
  Item,
  LinkType,
  LiveEvent,
  Moved,
  Person,
  PresencePerson,
  Project,
  ProjectSummary,
  Role,
  StoredExport,
} from "../shared/types";
import { ApiFailure, call, type ApiResult } from "./api";
import * as say from "./messages";

export interface Pending {
  start: IsoDate;
  end: IsoDate;
}

export interface KnockOnSignal {
  seq: number;
  editedId: string | null;
  previous: Project;
  previousLinks: { from: string; to: string }[];
}

export interface SessionState {
  phase: "loading" | "missing" | "ready";
  project: Project | null;
  rev: number;
  signal: KnockOnSignal | null;
  shifted: ReadonlySet<string>;
  pending: Readonly<Record<string, Pending>>;
  busy: ReadonlySet<string>;
  people: PresencePerson[];
  workspaceId: string;
  role: Role;
  scheduleStatus: string;
  updatesStatus: string;
  exportStatus: string;
  pageAlert: string;
  exports: StoredExport[];
  workloadTick: number;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; message: string; failure: ApiFailure };

export interface PatchResult {
  item: Item;
  moved: Moved[];
  finish: IsoDate | null;
  constraint: { predecessor: string } | null;
}

interface EditPlan {
  payload: Record<string, unknown>;
  preview?: Pending;
  sentence: (result: PatchResult) => string | null;
  /** Messages for the fields this edit sends, where the grid or the bar words them differently. */
  own?: Record<string, string>;
}

type Planner = (item: Item, calendar: WorkCalendar) => EditPlan | { announce: string } | null;

interface Spec<T> {
  itemId?: string | null;
  preview?: Pending;
  request: () => Promise<ApiResult<T>>;
  note?: (value: T) => Pick<ChangeNote, "kind" | "itemId" | "itemName" | "schedule" | "moved">;
  own?: Record<string, string>;
  /** The name the person knows the item by, for a conflict notice. */
  itemName?: string;
}

const RECONNECT_MS = 1000;

const EMPTY: SessionState = {
  phase: "loading",
  project: null,
  rev: -1,
  signal: null,
  shifted: new Set(),
  pending: {},
  busy: new Set(),
  people: [],
  workspaceId: "",
  role: "viewer",
  scheduleStatus: "",
  updatesStatus: "",
  exportStatus: "",
  pageAlert: "",
  exports: [],
  workloadTick: 0,
};

/** Everything one open project page knows: the server's snapshot, pending edits, announcements and the live channel. */
export class ProjectSession {
  private current: SessionState = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readonly commentListeners = new Set<(itemId: string, comment: Comment) => void>();
  private readonly queues = new Map<string, Promise<boolean>>();
  private socket: WebSocket | null = null;
  private reconnect = 0;
  private focus: string | null = null;
  private signalSeq = 0;

  constructor(
    readonly projectId: string,
    readonly me: Person,
    readonly config: AppConfig,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionState => this.current;

  private set(changes: Partial<SessionState>): void {
    this.current = { ...this.current, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  get readOnly(): boolean {
    return this.current.role === "viewer";
  }

  calendar(): WorkCalendar {
    return new WorkCalendar((this.current.project?.holidays ?? []).map((holiday) => holiday.date));
  }

  item(itemId: string): Item | undefined {
    return this.current.project?.items.find((candidate) => candidate.id === itemId);
  }

  async start(): Promise<void> {
    this.connect();
    await this.refresh(true);
  }

  /** Opens the live channel, and opens it again after a dropped connection. */
  private connect(): void {
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${window.location.host}/api/projects/${this.projectId}/live`);
    socket.onmessage = (message) => this.receive(JSON.parse(String(message.data)));
    socket.onopen = () => this.sendFocus();
    socket.onclose = () => {
      if (this.socket === socket) this.reconnect = window.setTimeout(() => this.connect(), RECONNECT_MS);
    };
    this.socket = socket;
  }

  stop(): void {
    const socket = this.socket;
    this.socket = null;
    window.clearTimeout(this.reconnect);
    socket?.close();
  }

  private sendFocus(): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "select", selected: this.focus }));
  }

  private receive(event: LiveEvent): void {
    switch (event.type) {
      case "ready":
        this.set({ people: event.people });
        void this.refresh(false);
        return;
      case "presence":
        this.set({ people: event.people });
        return;
      case "workload":
        this.set({ workloadTick: this.current.workloadTick + 1 });
        return;
      case "comment":
        this.commentListeners.forEach((listener) => listener(event.itemId, event.comment));
        if (event.actor.id !== this.me.id) this.set({ updatesStatus: say.updateSentence("comment", event.actor.name, event.itemName) });
        return;
      case "project":
        this.apply(event.project, event.rev, event.change);
        if (event.change.actor.id !== this.me.id && event.change.kind !== "comment") {
          this.set({ updatesStatus: say.updateSentence(event.change.kind, event.change.actor.name, event.change.itemName) });
        }
    }
  }

  /** Reads the project (and, the first time, the person's role and the exports) from the server. */
  async refresh(first: boolean): Promise<void> {
    try {
      if (first) {
        const [me, projects] = await Promise.all([
          call<{ workspaces: { id: string; role: Role }[] }>("GET", "/api/me"),
          call<{ projects: ProjectSummary[] }>("GET", "/api/projects"),
        ]);
        const summary = projects.body.projects.find((candidate) => candidate.id === this.projectId);
        const membership = me.body.workspaces.find((candidate) => candidate.id === summary?.workspace.id);
        if (!summary || !membership) {
          this.set({ phase: "missing" });
          return;
        }
        this.set({ workspaceId: membership.id, role: membership.role });
      }
      const [fresh, exported] = await Promise.all([
        call<Project>("GET", `/api/projects/${this.projectId}`),
        call<{ exports: StoredExport[] }>("GET", `/api/projects/${this.projectId}/exports`),
      ]);
      this.apply(fresh.body, fresh.rev ?? 0, undefined);
      this.set({ phase: "ready", exports: exported.body.exports, workloadTick: this.current.workloadTick + 1 });
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 404) this.set({ phase: "missing" });
    }
  }

  /** Takes a snapshot once, in order: a snapshot at or below the one on screen is already shown. */
  private apply(project: Project, rev: number, note: ChangeNote | undefined): void {
    const before = this.current;
    if (before.project && rev <= before.rev) return;
    const signal =
      note?.schedule && before.project
        ? { seq: ++this.signalSeq, editedId: note.itemId, previous: before.project, previousLinks: [...note.previousLinks, ...before.project.links] }
        : before.signal;
    this.set({ project, rev, signal, shifted: note?.schedule ? new Set(note.moved) : before.shifted, workloadTick: before.workloadTick + 1 });
  }

  onComment(listener: (itemId: string, comment: Comment) => void): () => void {
    this.commentListeners.add(listener);
    return () => this.commentListeners.delete(listener);
  }

  setAlert(message: string): void {
    this.set({ pageAlert: message });
  }

  announceSchedule(message: string): void {
    this.set({ scheduleStatus: message });
  }

  announceReadOnly(): void {
    this.set({ scheduleStatus: say.READ_ONLY });
  }

  /** The person's focus, shared with everyone else who has the project open. */
  select(itemId: string | null): void {
    this.focus = itemId;
    this.sendFocus();
  }

  private async perform<T>(spec: Spec<T>): Promise<Outcome<T>> {
    const itemId = spec.itemId ?? null;
    this.set({
      pageAlert: "",
      pending: itemId && spec.preview ? { ...this.current.pending, [itemId]: spec.preview } : this.current.pending,
      busy: itemId ? new Set([...this.current.busy, itemId]) : this.current.busy,
    });
    const settle = () => {
      const pending = { ...this.current.pending };
      const busy = new Set(this.current.busy);
      if (itemId) {
        delete pending[itemId];
        busy.delete(itemId);
      }
      this.set({ pending, busy });
    };
    try {
      const result = await spec.request();
      if (result.rev !== null && result.rev > this.current.rev) {
        const fresh = await call<Project>("GET", `/api/projects/${this.projectId}`);
        const noted = spec.note?.(result.body);
        this.apply(
          fresh.body,
          fresh.rev ?? result.rev,
          noted && { ...noted, actor: { id: this.me.id, name: this.me.name }, previousLinks: [] },
        );
      }
      settle();
      return { ok: true, value: result.body };
    } catch (failure) {
      settle();
      if (!(failure instanceof ApiFailure)) throw failure;
      if (failure.status === 0 || failure.status >= 500 || failure.status === 409) void this.refresh(false);
      return { ok: false, message: say.refusal(failure, spec.own, spec.itemName), failure };
    }
  }

  private report<T>(outcome: Outcome<T>): void {
    if (!outcome.ok) this.set({ pageAlert: outcome.message });
  }

  /** Edits to one item are sent one after the other, each planned against the item as the last answer left it. */
  edit(itemId: string, plan: Planner): Promise<boolean> {
    if (this.readOnly) {
      this.announceReadOnly();
      return Promise.resolve(false);
    }
    const run = (this.queues.get(itemId) ?? Promise.resolve(true)).then(async () => {
      const item = this.item(itemId);
      const planned = item && plan(item, this.calendar());
      if (!item || !planned) return false;
      if ("announce" in planned) {
        this.announceSchedule(planned.announce);
        return false;
      }
      const outcome = await this.perform<PatchResult>({
        itemId,
        preview: planned.preview,
        request: () => call("PATCH", `/api/items/${itemId}`, { baseVersion: item.version, ...planned.payload }),
        note: (value) => ({ kind: "edit", itemId, itemName: value.item.name, schedule: true, moved: value.moved.map((entry) => entry.id) }),
        own: planned.own,
        itemName: item.name,
      });
      if (outcome.ok) {
        const sentence = planned.sentence(outcome.value);
        if (sentence) this.announceSchedule(sentence);
      } else this.report(outcome);
      return outcome.ok;
    });
    this.queues.set(itemId, run);
    return run;
  }

  async createRow(name: string, kind: "task" | "group"): Promise<Outcome<PatchResult>> {
    const outcome = await this.perform<PatchResult>({
      request: () => call("POST", `/api/projects/${this.projectId}/items`, { name, kind }),
      note: (value) => ({ kind: "add", itemId: value.item.id, itemName: value.item.name, schedule: true, moved: [] }),
      own: { name: "Name must be 1 to 120 characters." },
    });
    if (outcome.ok) this.announceSchedule(say.addedRowSentence(outcome.value.item));
    else this.report(outcome);
    return outcome;
  }

  async setPredecessors(item: Item, text: string): Promise<Outcome<PatchResult>> {
    const outcome = await this.perform<PatchResult>({
      itemId: item.id,
      request: () => call("PUT", `/api/items/${item.id}/predecessors`, { baseVersion: item.version, text }),
      note: (value) => ({ kind: "edit", itemId: item.id, itemName: value.item.name, schedule: true, moved: value.moved.map((entry) => entry.id) }),
    });
    if (outcome.ok) {
      const project = this.current.project;
      const canonical = project ? canonicalPredecessors(item.id, project.items, project.links) : "";
      this.announceSchedule(say.predecessorsSentence(outcome.value, canonical));
    } else this.report(outcome);
    return outcome;
  }

  async reorder(item: Item, direction: "up" | "down"): Promise<void> {
    if (this.readOnly) return this.announceReadOnly();
    const outcome = await this.perform<{ changed: boolean; rows: { id: string; row: number }[] }>({
      itemId: item.id,
      request: () => call("POST", `/api/items/${item.id}/reorder`, { direction }),
      note: () => ({ kind: "edit", itemId: item.id, itemName: item.name, schedule: true, moved: [] }),
    });
    if (!outcome.ok) return this.report(outcome);
    const row = outcome.value.rows.find((entry) => entry.id === item.id);
    if (outcome.value.changed && row) this.announceSchedule(say.movedRowSentence({ ...item, row: row.row }));
  }

  regroup(item: Item, group: Item | null): Promise<boolean> {
    return this.edit(item.id, (current) => ({
      payload: { group: group ? group.id : null },
      sentence: () => say.groupedSentence(current, group ? group.name : null),
    }));
  }

  async deleteItem(item: Item): Promise<Outcome<{ moved: Moved[]; finish: IsoDate | null }>> {
    const outcome = await this.perform<{ moved: Moved[]; finish: IsoDate | null }>({
      itemId: item.id,
      request: () => call("DELETE", `/api/items/${item.id}`),
      note: (value) => ({ kind: "delete", itemId: item.id, itemName: item.name, schedule: true, moved: value.moved.map((entry) => entry.id) }),
    });
    if (outcome.ok) this.announceSchedule(say.deletedSentence(item.name, outcome.value));
    else this.report(outcome);
    return outcome;
  }

  async addLink(from: Item, toId: string, type: LinkType, lag: number): Promise<Outcome<PatchResult>> {
    const outcome = await this.perform<PatchResult & { link: { to: string } }>({
      request: () => call("POST", `/api/projects/${this.projectId}/links`, { from: from.id, to: toId, type, lag }),
      note: (value) => ({ kind: "edit", itemId: from.id, itemName: from.name, schedule: true, moved: value.moved.map((entry) => entry.id) }),
      own: { to: "Choose the task that comes next." },
    });
    const successor = this.item(toId);
    if (outcome.ok && successor) {
      this.announceSchedule(say.linkSentence(from.name, successor.name, type, lag, { item: from, moved: outcome.value.moved, finish: outcome.value.finish }));
    }
    return outcome;
  }

  async addHoliday(date: string, name: string): Promise<Outcome<{ moved: Moved[]; finish: IsoDate | null }>> {
    const outcome = await this.perform<{ moved: Moved[]; finish: IsoDate | null }>({
      request: () => call("POST", `/api/projects/${this.projectId}/holidays`, { date, name }),
      note: (value) => ({ kind: "holidays", itemId: null, itemName: null, schedule: true, moved: value.moved.map((entry) => entry.id) }),
      own: { date: "Enter a date as YYYY-MM-DD.", name: "Holiday name must be 1 to 60 characters." },
    });
    if (outcome.ok) this.announceSchedule(say.holidaySentence("added", name, outcome.value));
    return outcome;
  }

  async removeHoliday(date: string, name: string): Promise<Outcome<{ moved: Moved[]; finish: IsoDate | null }>> {
    const outcome = await this.perform<{ moved: Moved[]; finish: IsoDate | null }>({
      request: () => call("DELETE", `/api/projects/${this.projectId}/holidays/${date}`),
      note: (value) => ({ kind: "holidays", itemId: null, itemName: null, schedule: true, moved: value.moved.map((entry) => entry.id) }),
    });
    if (outcome.ok) this.announceSchedule(say.holidaySentence("removed", name, outcome.value));
    return outcome;
  }

  async saveBaseline(name: string, replace: boolean): Promise<Outcome<unknown>> {
    const outcome = await this.perform<unknown>({
      request: () => call("POST", `/api/projects/${this.projectId}/baseline`, replace ? { name, replace: true } : { name }),
      note: () => ({ kind: "baseline", itemId: null, itemName: null, schedule: false, moved: [] }),
      own: { name: "Baseline name must be 1 to 60 characters." },
    });
    if (outcome.ok) this.announceSchedule(say.baselineSentence(name));
    return outcome;
  }

  async assign(item: Item, person: { userId: string; name: string }, hours: number): Promise<Outcome<{ item: Item }>> {
    const outcome = await this.perform<{ item: Item }>({
      request: () => call("POST", `/api/items/${item.id}/assignees`, { userId: person.userId, hours }),
      note: () => ({ kind: "edit", itemId: item.id, itemName: item.name, schedule: true, moved: [] }),
      own: { already_assigned: `${person.name} is already assigned to this task.` },
    });
    if (outcome.ok) this.announceSchedule(say.assignedSentence(person.name, item.name, hours));
    return outcome;
  }

  async unassign(item: Item, assignee: { userId: string; name: string }): Promise<Outcome<{ item: Item }>> {
    const outcome = await this.perform<{ item: Item }>({
      request: () => call("DELETE", `/api/items/${item.id}/assignees/${assignee.userId}`),
      note: () => ({ kind: "edit", itemId: item.id, itemName: item.name, schedule: true, moved: [] }),
    });
    if (outcome.ok) this.announceSchedule(say.unassignedSentence(assignee.name, item.name));
    return outcome;
  }

  /** The Task details save: every field is sent; the dialog gets the answer to show or to adopt. */
  async saveDetails(item: Item, version: number, fields: Record<string, unknown>, sentence: (result: PatchResult) => string): Promise<Outcome<PatchResult>> {
    const outcome = await this.perform<PatchResult>({
      itemId: item.id,
      itemName: item.name,
      request: () => call("PATCH", `/api/items/${item.id}`, { baseVersion: version, ...fields }),
      note: (value) => ({ kind: "edit", itemId: item.id, itemName: value.item.name, schedule: true, moved: value.moved.map((entry) => entry.id) }),
    });
    if (outcome.ok) this.announceSchedule(sentence(outcome.value));
    return outcome;
  }

  async postComment(item: Item, text: string): Promise<Outcome<{ comment: Comment }>> {
    const outcome = await this.perform<{ comment: Comment }>({ request: () => call("POST", `/api/items/${item.id}/comments`, { text }) });
    if (outcome.ok) this.announceSchedule("Comment posted.");
    return outcome;
  }

  async exportAs(format: "csv" | "pdf"): Promise<void> {
    this.set({ pageAlert: "", exportStatus: `Preparing the ${format.toUpperCase()} export.` });
    try {
      const made = await call<StoredExport>("POST", `/api/projects/${this.projectId}/exports`, { format });
      const listed = await call<{ exports: StoredExport[] }>("GET", `/api/projects/${this.projectId}/exports`);
      this.set({ exports: listed.body.exports, exportStatus: `${made.body.filename} is ready to download.` });
    } catch (failure) {
      this.set({ exportStatus: "", pageAlert: failure instanceof ApiFailure ? say.refusal(failure) : say.SAVE_FAILED });
    }
  }
}
