import { docFromPayload } from '../../shared/api.js';
import { copy } from '../../shared/copy.js';
import { deriveAll } from '../../shared/derive.js';
import { layoutMap } from '../../shared/layout.js';
import { applyGroup, type OpsContext } from '../../shared/ops.js';
import { can } from '../../shared/permissions.js';
import {
  ancestors,
  branchIds,
  hiddenSet,
  visibleTopics,
  type MapView,
} from '../../shared/tree.js';
import { diffTitles } from '../../shared/titlemerge.js';
import type { TitleEdit } from '../../shared/titlemerge.js';
import type {
  DerivedTopic,
  LayoutResult,
  MapDoc,
  MapPayload,
  Operation,
  OpsResponse,
  RecoveredEntry,
  Role,
} from '../../shared/types.js';
import { api, RequestFailed } from '../api.js';
import { announce, notify, refreshInbox, setToastLifetime } from '../shell.js';

export interface Person {
  key: string;
  name: string;
  guest: boolean;
  role: Role;
  colour: string;
  cursor: { x: number; y: number; topic_id: string | null } | null;
  view: { zoom: number; pan_x: number; pan_y: number; width: number; height: number } | null;
}

export interface ActivityRow {
  seq: number;
  user: string;
  sentence: string;
  topic_id: string | null;
  at: string;
}

export interface QueuedGroup {
  group_id: string;
  base_revision: number;
  ops: Operation[];
}

export type Listener = () => void;

let counter = 0;

export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}`.slice(0, 40);
}

export interface SendOptions {
  /** Announce this sentence once the group is accepted. */
  announce?: string;
  silent?: boolean;
}

export class Editor {
  payload: MapPayload;
  doc: MapDoc;
  revision: number;
  role: Role;
  me: string;
  collapsed = new Set<string>();
  selection = new Set<string>();
  focusId: string;
  zoom = 1;
  panX = 0;
  panY = 0;
  canvasWidth = 1280;
  canvasHeight = 800;
  offline = false;
  connectionLost = false;
  queue: QueuedGroup[] = [];
  /** Each topic's title when I last went offline, used to combine queued edits. */
  private offlineTitles = new Map<string, string>();
  people: Person[] = [];
  /** Usernames holding a role on this map, for mentions and assignees. */
  members: string[] = [];
  following: string | null = null;
  activity: ActivityRow[] = [];
  recovered: RecoveredEntry[] = [];
  counts = new Map<string, { comments: number; votes: number; voted: boolean }>();
  dimmed = new Set<string>();
  focusBranch: string | null = null;
  diff = new Map<string, string>();
  slides: string[] = [];
  serverDate: string;
  sessionExpired = false;
  /** True while this person is presenting, which makes Fit to screen glide. */
  presenting = false;
  stopped = false;
  dropTarget: string | null = null;
  editingTopic: string | null = null;
  private socket: WebSocket | null = null;
  private lastSeq = 0;
  private backoffStep = 0;
  private listeners = new Set<Listener>();
  private myGroups = new Set<string>();
  private layoutCache: { key: string; layout: LayoutResult } | null = null;
  private derivedCache: { key: string; values: Map<string, DerivedTopic> } | null = null;
  private stamp = 0;

  constructor(payload: MapPayload) {
    this.payload = payload;
    this.doc = docFromPayload(payload);
    this.revision = payload.map.revision;
    this.role = payload.map.role;
    this.me = '';
    this.focusId = payload.topics[0]?.id ?? this.doc.root;
    this.collapsed = new Set(payload.collapsed);
    this.recovered = payload.recovered;
    this.slides = payload.slides;
    this.serverDate = payload.server_date;
    setToastLifetime(payload.settings.toast_ms);
    this.readCounts(payload);
    this.queue = this.readQueue();
  }

  private readCounts(payload: MapPayload): void {
    this.counts.clear();
    for (const topic of payload.topics) {
      this.counts.set(topic.id, {
        comments: topic.comment_count,
        votes: topic.vote_count,
        voted: topic.voted,
      });
    }
  }

  get mapId(): string {
    return this.payload.map.id;
  }

  get canEdit(): boolean {
    return can(this.role, 'edit');
  }

  get canComment(): boolean {
    return can(this.role, 'comment');
  }

  get canManage(): boolean {
    return can(this.role, 'manage');
  }

  onChange(listener: Listener): void {
    this.listeners.add(listener);
  }

  changed(): void {
    this.stamp += 1;
    for (const listener of this.listeners) listener();
  }

  view(): MapView {
    return {
      doc: this.doc,
      collapsed: this.collapsed,
      hidden: hiddenSet(this.doc, can(this.role, 'see_restricted')),
    };
  }

  layout(): LayoutResult {
    const key = `${this.stamp}:${this.doc.layout}`;
    if (this.layoutCache?.key === key) return this.layoutCache.layout;
    const layout = layoutMap(this.view(), this.doc.layout);
    this.layoutCache = { key, layout };
    return layout;
  }

  derived(): Map<string, DerivedTopic> {
    const key = `${this.stamp}:${this.doc.theme}:${this.serverDate}`;
    if (this.derivedCache?.key === key) return this.derivedCache.values;
    const values = deriveAll({
      ...this.view(),
      theme: this.doc.theme,
      today: this.serverDate,
    });
    this.derivedCache = { key, values };
    return values;
  }

  visible(): string[] {
    const all = visibleTopics(this.view());
    if (this.focusBranch === null) return all;
    const branch = new Set<string>();
    const walk = (id: string): void => {
      branch.add(id);
      for (const child of this.doc.topics[id]?.children ?? []) walk(child);
    };
    if (this.doc.topics[this.focusBranch]) walk(this.focusBranch);
    return all.filter((id) => branch.has(id));
  }

  countsFor(id: string): { comments: number; votes: number; voted: boolean } {
    return this.counts.get(id) ?? { comments: 0, votes: 0, voted: false };
  }

  // ---- operations -------------------------------------------------------

  context(): OpsContext {
    return {
      user: this.me,
      role: this.role,
      revision: this.revision,
      members: new Set([this.me, ...this.members, ...this.people.map((person) => person.name)]),
    };
  }

  async loadMembers(): Promise<void> {
    if (this.stopped) return;
    try {
      const answer = await api.get<{ members: { username: string }[] }>(
        `/api/maps/${this.mapId}/members`,
      );
      this.members = answer.members.map((member) => member.username);
      this.changed();
    } catch {
      /* the list loads again after the next role change */
    }
  }

  /** Applies a group locally and sends it, or queues it while offline. */
  send(ops: Operation[], options: SendOptions = {}): boolean {
    if (ops.length === 0) return false;
    if (!this.canEdit) {
      notify(copy.readOnly);
      return false;
    }
    const group = { group_id: nextId('g'), base_revision: this.revision, ops };
    if (this.offline || this.connectionLost) {
      for (const op of ops) {
        if (op.kind !== 'title') continue;
        const id = op.topic_id as string;
        if (!this.offlineTitles.has(id)) {
          this.offlineTitles.set(id, this.doc.topics[id]?.title ?? '');
        }
      }
    }
    let applied;
    try {
      applied = applyGroup(this.doc, group, this.context());
    } catch (error) {
      notify(error instanceof Error ? error.message : copy.missingTopic, 'warning');
      return false;
    }
    if (applied.outcome.status === 'rejected' || applied.outcome.status === 'recovered') {
      notify(applied.outcome.notice ?? '', 'warning');
      return false;
    }
    this.doc = applied.doc;
    this.revision = applied.outcome.revision;
    this.myGroups.add(group.group_id);
    if (options.announce) announce(options.announce);
    this.changed();
    if (this.offline || this.connectionLost) {
      this.enqueue(group);
      this.changed();
      return true;
    }
    void this.post(group);
    return true;
  }

  /** Title edits of one topic made offline combine into one queued edit. */
  private enqueue(group: QueuedGroup): void {
    const only = group.ops.length === 1 ? group.ops[0] : null;
    if (only && only.kind === 'title') {
      const topicId = only.topic_id as string;
      const index = this.queue.findIndex(
        (queued) =>
          queued.ops.length === 1 &&
          queued.ops[0].kind === 'title' &&
          queued.ops[0].topic_id === topicId,
      );
      if (index >= 0) {
        const baseline = this.offlineTitles.get(topicId);
        const current = this.doc.topics[topicId]?.title ?? '';
        if (baseline !== undefined) {
          const combined = diffTitles(baseline, current);
          this.queue[index] = {
            group_id: this.queue[index].group_id,
            base_revision: this.queue[index].base_revision,
            ops: [
              {
                ...this.queue[index].ops[0],
                offset: combined.offset,
                delete: combined.delete,
                insert: combined.insert,
              },
            ],
          };
          this.writeQueue();
          return;
        }
      }
    }
    this.queue.push(group);
    this.writeQueue();
  }

  private async post(group: QueuedGroup): Promise<void> {
    try {
      const answer = await api.post<OpsResponse>(`/api/maps/${this.mapId}/ops`, group);
      this.revision = Math.max(this.revision, answer.revision);
      if (answer.notice) notify(answer.notice, 'warning');
      if (
        answer.status !== 'applied' ||
        answer.results.some((result) => result.reason !== null)
      ) {
        await this.resync();
      }
      this.changed();
    } catch (error) {
      if (error instanceof RequestFailed) {
        if (error.body.error === 'session_expired') {
          this.sessionExpired = true;
          this.queue.push(group);
          this.writeQueue();
          this.changed();
          return;
        }
        notify(error.body.message, 'warning');
        await this.resync();
        return;
      }
      this.connectionLost = true;
      this.queue.push(group);
      this.writeQueue();
      this.changed();
    }
  }

  /** Stops every request and the live connection once access ends. */
  stop(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }

  async resync(): Promise<void> {
    if (this.stopped) return;
    try {
      const payload = await api.get<MapPayload>(`/api/maps/${this.mapId}`);
      this.payload = payload;
      this.doc = docFromPayload(payload);
      this.revision = payload.map.revision;
      this.role = payload.map.role;
      this.recovered = payload.recovered;
      this.slides = payload.slides;
      this.serverDate = payload.server_date;
      this.collapsed = new Set(payload.collapsed);
      this.readCounts(payload);
      if (!this.doc.topics[this.focusId]) this.focusId = this.doc.root;
      this.changed();
    } catch {
      this.connectionLost = true;
      this.changed();
    }
  }

  async undo(): Promise<void> {
    if (this.offline || this.connectionLost) {
      const last = this.queue.pop();
      this.writeQueue();
      if (!last) {
        notify(copy.nothingToUndo);
        return;
      }
      await this.resyncOffline();
      notify(copy.undone);
      return;
    }
    const answer = await api.post<{
      status: 'undone' | 'skipped' | 'empty';
      revision: number;
      focus_topic_id: string | null;
      notice: string | null;
    }>(`/api/maps/${this.mapId}/undo`);
    await this.afterUndo(answer);
  }

  async redo(): Promise<void> {
    const answer = await api.post<{
      status: 'undone' | 'skipped' | 'empty';
      revision: number;
      focus_topic_id: string | null;
      notice: string | null;
    }>(`/api/maps/${this.mapId}/redo`);
    await this.afterUndo(answer);
  }

  private async afterUndo(answer: {
    status: string;
    focus_topic_id: string | null;
    notice: string | null;
  }): Promise<void> {
    await this.resync();
    if (answer.focus_topic_id && this.doc.topics[answer.focus_topic_id]) {
      this.focusId = answer.focus_topic_id;
    }
    if (answer.notice) notify(answer.notice, answer.status === 'skipped' ? 'warning' : 'plain');
    this.changed();
  }

  /** Rebuilds the local document from the server, then replays the offline queue locally. */
  private async resyncOffline(): Promise<void> {
    const queued = [...this.queue];
    await this.resync();
    for (const group of queued) {
      try {
        const applied = applyGroup(this.doc, group, this.context());
        this.doc = applied.doc;
      } catch {
        /* a queued group that no longer fits is dropped from the local view */
      }
    }
    this.changed();
  }

  // ---- offline ----------------------------------------------------------

  private queueKey(): string {
    return `sprig-offline-${this.mapId}`;
  }

  private readQueue(): QueuedGroup[] {
    try {
      const raw = window.localStorage.getItem(this.queueKey());
      return raw === null ? [] : (JSON.parse(raw) as QueuedGroup[]);
    } catch {
      return [];
    }
  }

  writeQueue(): void {
    try {
      window.localStorage.setItem(this.queueKey(), JSON.stringify(this.queue));
    } catch {
      /* a full store only costs the queue its durability */
    }
  }

  async setOffline(offline: boolean): Promise<void> {
    this.offline = offline;
    if (offline) {
      this.socket?.close();
      this.socket = null;
      this.changed();
      return;
    }
    this.connect();
    await this.flushQueue();
  }

  async flushQueue(): Promise<void> {
    const groups = [...this.queue];
    this.queue = [];
    this.offlineTitles.clear();
    this.writeQueue();
    let sent = 0;
    let conflicts = 0;
    for (const group of groups) {
      try {
        const answer = await api.post<OpsResponse>(`/api/maps/${this.mapId}/ops`, group);
        sent += 1;
        if (
          answer.status === 'merged' ||
          answer.status === 'rejected' ||
          answer.status === 'recovered' ||
          answer.results.some((result) => result.reason !== null)
        ) {
          conflicts += 1;
        }
        if (answer.notice) notify(answer.notice, 'warning');
      } catch (error) {
        if (error instanceof RequestFailed) conflicts += 1;
        else {
          this.queue.push(group);
          this.writeQueue();
        }
      }
    }
    await this.resync();
    if (groups.length > 0 || sent > 0) {
      notify(copy.backOnline(sent, conflicts));
    }
    this.changed();
  }

  // ---- live connection --------------------------------------------------

  connect(): void {
    if (this.offline || this.stopped) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const since = this.lastSeq > 0 ? `?since=${this.lastSeq}` : '';
    const socket = new WebSocket(
      `${protocol}://${window.location.host}/api/maps/${this.mapId}/live${since}`,
    );
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.backoffStep = 0;
      if (this.connectionLost) {
        this.connectionLost = false;
        void this.flushQueue();
      }
      this.changed();
    });
    socket.addEventListener('message', (event) => {
      this.handleMessage(JSON.parse(String(event.data)) as Record<string, unknown>);
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.offline) return;
      this.connectionLost = true;
      this.changed();
      const waits = [1000, 2000, 4000, 8000, 30000];
      const wait = waits[Math.min(this.backoffStep, waits.length - 1)];
      this.backoffStep += 1;
      window.setTimeout(() => {
        if (!this.offline && this.socket === null) this.connect();
      }, wait);
    });
  }

  private handleMessage(message: Record<string, unknown>): void {
    const seq = Number(message.seq ?? 0);
    if (seq > this.lastSeq) this.lastSeq = seq;
    const type = String(message.type ?? '');
    switch (type) {
      case 'hello':
        break;
      case 'op':
        this.applyRemote(message);
        break;
      case 'presence':
        this.people = (message.people as Person[]) ?? [];
        this.changed();
        break;
      case 'cursor':
        this.applyCursor(message);
        break;
      case 'notice':
        notify(String(message.text ?? ''), 'warning');
        break;
      case 'comment':
        void this.refreshCounts();
        if (((message.mentions as string[]) ?? []).includes(this.me)) refreshInbox();
        if (typeof message.sentence === 'string') announce(message.sentence);
        break;
      case 'vote':
        this.applyVote(message);
        break;
      case 'role':
        this.role = message.role as Role;
        notify(String(message.notice ?? ''));
        void this.resync();
        void this.loadMembers();
        break;
      case 'access_removed':
        this.stop();
        this.onAccessRemoved?.();
        break;
      case 'session_expired':
        this.sessionExpired = true;
        this.changed();
        break;
      case 'link_expired':
        this.stop();
        this.onLinkEnded?.('expired');
        break;
      case 'link_revoked':
        this.stop();
        this.onLinkEnded?.('revoked');
        break;
      case 'version':
        this.onVersion?.(message);
        break;
      case 'export':
        this.onExport?.(message);
        break;
      case 'presentation':
        this.onPresentation?.(message);
        break;
      case 'derived':
        this.serverDate = String(message.server_date ?? this.serverDate);
        this.changed();
        break;
      default:
        break;
    }
  }

  onAccessRemoved: (() => void) | null = null;
  onLinkEnded: ((reason: 'expired' | 'revoked') => void) | null = null;
  onVersion: ((message: Record<string, unknown>) => void) | null = null;
  onExport: ((message: Record<string, unknown>) => void) | null = null;
  onPresentation: ((message: Record<string, unknown>) => void) | null = null;
  onRemoteTitle: ((topicId: string, edit: TitleEdit) => void) | null = null;
  onTopicsDeleted: ((ids: string[]) => void) | null = null;

  /** Sends a group the local document can no longer apply, such as an edit under a delete. */
  sendDespiteDelete(ops: Operation[], baseRevision: number): void {
    const group = { group_id: nextId('g'), base_revision: baseRevision, ops };
    if (this.offline || this.connectionLost) {
      this.queue.push(group);
      this.writeQueue();
      this.changed();
      return;
    }
    void this.post(group);
  }

  async copyToClipboard(ids: string[]): Promise<number> {
    const answer = await api.post<{ topics: number }>('/api/clipboard', {
      map_id: this.mapId,
      topic_ids: ids,
    });
    return answer.topics;
  }

  async pasteClipboard(parentId: string): Promise<number | null> {
    const before = Object.keys(this.doc.topics).length;
    try {
      await api.post<OpsResponse>(`/api/maps/${this.mapId}/paste`, {
        parent_id: parentId,
        group_id: nextId('g'),
        base_revision: this.revision,
      });
    } catch (error) {
      if (error instanceof RequestFailed && error.body.error === 'clipboard_empty') return null;
      if (error instanceof RequestFailed) {
        notify(error.body.message, 'warning');
        return null;
      }
      throw error;
    }
    await this.resync();
    return Object.keys(this.doc.topics).length - before;
  }

  private applyRemote(message: Record<string, unknown>): void {
    const groupId = String(message.group_id ?? '');
    const revision = Number(message.revision ?? 0);
    if (this.myGroups.has(groupId)) {
      this.myGroups.delete(groupId);
      this.revision = Math.max(this.revision, revision);
      this.recordActivity(message);
      this.changed();
      return;
    }
    const ops = (message.ops as Operation[]) ?? [];
    const actor = String(message.actor ?? '');
    for (const op of ops) {
      if (op.kind === 'title' && op.topic_id === this.editingTopic) {
        this.onRemoteTitle?.(op.topic_id, {
          offset: op.offset ?? 0,
          delete: op.delete ?? 0,
          insert: op.insert ?? '',
        });
      }
    }
    const removed: string[] = [];
    for (const op of ops) {
      if (op.kind === 'delete' && op.topic_id) {
        removed.push(...branchIds(this.doc, op.topic_id));
      }
    }
    if (removed.length > 0) this.onTopicsDeleted?.(removed);
    try {
      const applied = applyGroup(
        this.doc,
        { group_id: groupId, base_revision: revision - 1, ops },
        { user: actor, role: 'owner', revision: revision - 1, members: new Set([actor]), internal: true },
      );
      if (applied.outcome.status === 'applied' || applied.outcome.status === 'merged') {
        this.doc = applied.doc;
        this.revision = revision;
      } else {
        void this.resync();
      }
    } catch {
      void this.resync();
    }
    const sentence = String(message.sentence ?? '');
    if (sentence !== '') announce(sentence);
    this.recordActivity(message);
    if (!this.doc.topics[this.focusId]) {
      this.focusId = this.doc.root;
    }
    this.recovered = this.recovered.filter((entry) => entry);
    void this.refreshRecovered();
    this.changed();
  }

  private recordActivity(message: Record<string, unknown>): void {
    const sentence = String(message.sentence ?? '');
    if (sentence === '') return;
    this.activity.unshift({
      seq: Number(message.seq ?? 0),
      user: String(message.actor ?? ''),
      sentence,
      topic_id: typeof message.topic_id === 'string' ? message.topic_id : null,
      at: String(message.at ?? ''),
    });
  }

  private applyCursor(message: Record<string, unknown>): void {
    const key = String(message.key ?? '');
    const person = this.people.find((each) => each.key === key);
    if (!person) return;
    person.cursor = {
      x: Number(message.x ?? 0),
      y: Number(message.y ?? 0),
      topic_id: typeof message.topic_id === 'string' ? message.topic_id : null,
    };
    person.view = (message.view as Person['view']) ?? person.view;
    this.changed();
  }

  private applyVote(message: Record<string, unknown>): void {
    const topicId = String(message.topic_id ?? '');
    const current = this.countsFor(topicId);
    this.counts.set(topicId, {
      ...current,
      votes: Number(message.vote_count ?? current.votes),
    });
    if (typeof message.sentence === 'string') announce(message.sentence);
    this.changed();
  }

  async refreshCounts(): Promise<void> {
    if (this.stopped) return;
    try {
      const payload = await api.get<MapPayload>(`/api/maps/${this.mapId}`);
      this.readCounts(payload);
      this.changed();
    } catch {
      /* counts refresh again with the next message */
    }
  }

  async refreshRecovered(): Promise<void> {
    if (this.stopped) return;
    try {
      const payload = await api.get<MapPayload>(`/api/maps/${this.mapId}`);
      this.recovered = payload.recovered;
      this.changed();
    } catch {
      /* the list refreshes with the next message */
    }
  }

  async loadActivity(person: string | null): Promise<void> {
    if (this.stopped) return;
    const query = person && person !== 'Everyone' ? `?person=${encodeURIComponent(person)}` : '';
    const answer = await api.get<{ entries: ActivityRow[] }>(
      `/api/maps/${this.mapId}/activity${query}`,
    );
    this.activity = answer.entries;
    this.changed();
  }

  sendCursor(x: number, y: number): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(
      JSON.stringify({
        type: 'cursor',
        x,
        y,
        topic_id: this.focusId,
        view: {
          zoom: this.zoom,
          pan_x: this.panX,
          pan_y: this.panY,
          width: this.canvasWidth,
          height: this.canvasHeight,
        },
      }),
    );
  }

  // ---- collapse ---------------------------------------------------------

  setCollapsed(id: string, collapsed: boolean): void {
    if (collapsed) this.collapsed.add(id);
    else this.collapsed.delete(id);
    this.changed();
    void api
      .put(`/api/maps/${this.mapId}/collapse`, { topic_id: id, collapsed })
      .catch(() => undefined);
  }

  ancestorsOf(id: string): string[] {
    return ancestors(this.doc, id);
  }
}
