import { api, ApiError } from "./api.ts";
import type {
  Channel,
  Cycle,
  DocSummary,
  Issue,
  Message,
  Person,
  Room,
  ServiceStatus,
  UnreadBody,
  Workspace,
  Knock,
} from "./types.ts";

export interface AppSnapshot {
  me: Person | null;
  workspace: Workspace | null;
  members: Person[];
  channels: Channel[];
  unread: UnreadBody;
  projects: { id: string; key: string; name: string }[];
  issues: Record<string, Issue>;
  docs: DocSummary[];
  rooms: Room[];
  myRoomId: string | null;
  status: ServiceStatus | null;
  knocksWaiting: Knock[];
}

export type Listener = () => void;

export class AppStore {
  me: Person | null = null;
  workspace: Workspace | null = null;
  members: Person[] = [];
  channels: Channel[] = [];
  unread: UnreadBody = { channels: {}, inbox: 0 };
  projects: { id: string; key: string; name: string }[] = [];
  issues: Record<string, Issue> = {};
  docs: DocSummary[] = [];
  rooms: Room[] = [];
  myRoomId: string | null = null;
  status: ServiceStatus | null = null;
  cycle: Cycle | null = null;
  myKnock: Record<string, Knock> = {};

  announcements: string[] = [];
  docDraft: { docId: string; title: string; body: string; baseVersion: number; personId: string } | null = null;

  private listeners = new Set<Listener>();
  private es: EventSource | null = null;
  private lastEventId = 0;
  private seq = 0;
  private eventHandlers: ((name: string, data: unknown) => void)[] = [];
  signedOutCopy = false;
  bootstrapped = false;
  justJoined = false;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStreamEvent(fn: (name: string, data: unknown) => void): () => void {
    this.eventHandlers.push(fn);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== fn);
    };
  }

  emitChange(): void {
    for (const fn of this.listeners) fn();
  }

  announce(text: string): void {
    this.announcements = [...this.announcements, text];
    this.emitChange();
  }

  clearAnnouncement(text: string): void {
    this.announcements = this.announcements.filter((a) => a !== text);
    this.emitChange();
  }

  async refreshWorkspace(): Promise<void> {
    try {
      const { data } = await api.workspace();
      const prev = this.workspace;
      this.workspace = data;
      if (
        prev &&
        (prev.time_zone !== data.time_zone ||
          JSON.stringify(prev.working_weekdays) !== JSON.stringify(data.working_weekdays) ||
          JSON.stringify(prev.holidays) !== JSON.stringify(data.holidays) ||
          prev.cycle_anchor !== data.cycle_anchor)
      ) {
        this.calendarChanged = true;
      }
      this.emitChange();
    } catch (e) {
      this.handleAuthError(e);
    }
  }

  calendarChanged = false;

  async refreshStatus(): Promise<void> {
    try {
      const { data } = await api.status();
      this.status = data;
      this.emitChange();
    } catch {
      // keep the last status
    }
  }

  async bootstrap(): Promise<void> {
    try {
      const { data } = await api.me();
      this.me = data.person;
      this.workspace = data.workspace;
      if (data.workspace) {
        await Promise.all([
          this.refreshMembers(),
          this.refreshChannels(),
          this.refreshUnread(),
          this.refreshProjects(),
          this.refreshFloor(),
        ]);
        this.openStream();
      }
    } catch (e) {
      this.handleAuthError(e);
    } finally {
      this.bootstrapped = true;
      this.emitChange();
    }
  }

  async refreshMembers(): Promise<void> {
    if (!this.workspace) return;
    const { data } = await api.members();
    this.members = data.members;
    this.emitChange();
  }

  async refreshChannels(): Promise<void> {
    if (!this.workspace) return;
    const { data } = await api.channels();
    this.channels = data.channels;
    this.emitChange();
  }

  async refreshUnread(): Promise<void> {
    if (!this.workspace) return;
    const { data } = await api.unread();
    this.unread = data;
    this.emitChange();
  }

  async refreshProjects(): Promise<void> {
    if (!this.workspace) return;
    const { data } = await api.projects();
    this.projects = data.projects;
    this.emitChange();
  }

  async refreshDocs(): Promise<void> {
    if (!this.workspace) return;
    const { data } = await api.docs();
    this.docs = data.docs;
    this.emitChange();
  }

  async refreshFloor(): Promise<void> {
    if (!this.workspace) return;
    const { data } = await api.floor();
    this.rooms = data.rooms;
    this.myRoomId = data.me.room_id;
    this.emitChange();
  }

  upsertIssue(issue: Issue): void {
    this.issues = { ...this.issues, [issue.key]: issue };
    this.emitChange();
  }

  personById(id: string | null): Person | null {
    if (!id) return null;
    return this.members.find((m) => m.id === id) ?? null;
  }

  personName(id: string | null): string {
    const p = this.personById(id);
    return p ? p.name : "";
  }

  openStream(): void {
    this.closeStream();
    if (!this.me || !this.workspace) return;
    const es = new EventSource(`/api/events`);
    this.es = es;
    es.onmessage = () => undefined;
    const handle = (name: string, data: unknown) => {
      this.lastEventId = Math.max(this.lastEventId, 0);
      for (const fn of this.eventHandlers) fn(name, data);
    };
    for (const name of [
      "message",
      "thread_reply",
      "message_deleted",
      "unread",
      "typing",
      "presence",
      "room",
      "knock",
      "issue",
      "doc",
      "notice",
      "revoked",
      "reset",
    ]) {
      es.addEventListener(name, (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          if (name === "reset") {
            this.handleReset();
            return;
          }
          if (name === "revoked") {
            this.handleRevoked(data as { scope: string; id: string });
            return;
          }
          this.applyEvent(name, data);
          handle(name, data);
        } catch {
          // ignore malformed events
        }
      });
    }
    es.onerror = () => {
      // Reconnect; the EventSource keeps the last id and replays the missed events.
    };
  }

  closeStream(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
  }

  private applyingEvent = false;

  applyEvent(name: string, data: unknown): void {
    this.applyingEvent = true;
    try {
      switch (name) {
        case "unread": {
          this.unread = data as UnreadBody;
          this.emitChange();
          break;
        }
        case "room": {
          const room = data as Room;
          this.rooms = this.rooms.map((r) => (r.id === room.id ? room : r));
          this.emitChange();
          break;
        }
        case "presence": {
          const p = data as { person_id: string; status: "active" | "away" };
          this.rooms = this.rooms.map((r) => ({
            ...r,
            occupants: r.occupants.map((o) => (o.person_id === p.person_id ? { ...o, status: p.status } : o)),
          }));
          this.emitChange();
          break;
        }
        case "knock": {
          const k = data as Knock;
          if (k.person_id === this.me?.id) {
            this.myKnock = { ...this.myKnock, [k.room_id]: k };
          }
          this.emitChange();
          break;
        }
        case "issue": {
          const issue = data as Issue;
          this.upsertIssue(issue);
          break;
        }
        case "doc": {
          this.emitChange();
          break;
        }
        case "notice": {
          void this.refreshStatus();
          break;
        }
      }
    } finally {
      this.applyingEvent = false;
    }
  }

  private handleReset(): void {
    void this.refreshChannels();
    void this.refreshUnread();
    void this.refreshFloor();
    void this.refreshProjects();
    void this.refreshDocs();
    for (const fn of this.eventHandlers) fn("reset", {});
  }

  private handleRevoked(data: { scope: string; id: string }): void {
    if (data.scope === "workspace") {
      this.signOutLocally();
      return;
    }
    if (data.scope === "channel") {
      this.channels = this.channels.filter((c) => c.id !== data.id);
      const unread = { ...this.unread };
      delete unread.channels[data.id];
      this.unread = unread;
    }
    if (data.scope === "project") {
      this.projects = this.projects.filter((p) => p.id !== data.id);
    }
    this.emitChange();
    for (const fn of this.eventHandlers) fn("revoked", data);
  }

  async handleResetAsync(): Promise<void> {
    await this.refreshChannels();
    await this.refreshUnread();
    await this.refreshFloor();
  }

  signOutLocally(): void {
    this.closeStream();
    this.bootstrapped = true;
    this.me = null;
    this.workspace = null;
    this.members = [];
    this.channels = [];
    this.unread = { channels: {}, inbox: 0 };
    this.projects = [];
    this.issues = {};
    this.docs = [];
    this.rooms = [];
    this.myRoomId = null;
    this.cycle = null;
    this.myKnock = {};
    this.signedOutCopy = true;
    this.emitChange();
  }

  async signOut(): Promise<void> {
    try {
      await api.signOut();
    } catch {
      // the session cookie is cleared either way
    }
    this.docDraft = null;
    this.signOutLocally();
    sessionStorage.removeItem("tr_doc_draft");
  }

  handleAuthError(e: unknown): void {
    if (e instanceof ApiError && (e.code === "unauthenticated" || e.code === "invalid_credentials")) {
      // Only an unauthenticated answer clears the page state.
      if (e.code === "unauthenticated") {
        this.signOutLocally();
      }
    }
  }
}

export const store = new AppStore();
