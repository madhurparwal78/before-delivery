import { applyGroup, cloneDoc } from '../../shared/engine.ts';
import { deriveAll } from '../../shared/derive.ts';
import type { Layout } from '../../shared/layout.ts';
import { floatingDrop, layoutDoc } from '../../shared/layout.ts';
import type {
  BranchColour,
  Derived,
  ExportInfo,
  DocTopic,
  LiveMessage,
  MapDoc,
  MapHeader,
  MapPayload,
  MapSettings,
  LayoutMode,
  Op,
  OpsResponse,
  PresenceEntry,
  PresentationInfo,
  PublicOp,
  RecoveredEntry,
  Role,
  Sequenced,
  ViewReport,
} from '../../shared/model.ts';
import { COPY, can, canStep, noticeRole, plural } from '../../shared/rules.ts';
import { applyTitleEdit, diffTitleEdit, mapCaret, normaliseTitle, transformTitleEdit, type TitleEdit } from '../../shared/titleMerge.ts';
import { ancestorsOf, branchOf, childrenIndex, childrenOf, floatingOf, lockOf, newTopics, rootOf } from '../../shared/tree.ts';
import {
  centreOf,
  clampZoom,
  fitView,
  followView,
  keepInView,
  openView,
  type View,
  wheelZoom,
  zoomAbout,
} from '../../shared/viewport.ts';
import { HttpError, api } from '../api.ts';
import { computePlaces, topicLabel, type Counts, type Place } from './format.ts';
import { arrowTarget, focusAfterRemoval, planMove, type ArrowKey } from './nav.ts';

interface PendingGroup {
  group_id: string;
  base_revision: number;
  ops: PublicOp[];
  /** The revision the server answered with once it applied the group; the group waits for its live message. */
  acked: number | null;
}

interface Toast {
  id: number;
  text: string;
}

export interface Editing {
  topicId: string;
  isNew: boolean;
  /** The server's version of the title that my edit is measured against. */
  sync: string;
  value: string;
  caret: number;
  /** Where a new topic goes. */
  draft: { parentId: string | null; after: string | null; floating: { x: number; y: number } | null } | null;
  /** Bumped when remote edits change the input so the field is rewritten. */
  version: number;
  mode: 'select' | 'end';
  /** Which tree shows the input: the map or the outline. */
  where: 'map' | 'outline';
  /** The revision `sync` was current at: my edit is sent against it. */
  syncRevision: number;
}

export interface CursorInfo {
  user: string;
  colour: BranchColour;
  x: number;
  y: number;
  topicId: string | null;
  view: ViewReport | null;
}

interface FindState {
  open: boolean;
  query: string;
  replace: string;
  assignee: string;
  icon: string;
  state: string;
  current: number;
}

type ConnectionState = 'live' | 'offline' | 'lost';

interface StoredQueue {
  offline: boolean;
  groups: { group_id: string; base_revision: number; ops: PublicOp[] }[];
  titleBase: Record<string, string>;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 30000];

const uid = (): string => crypto.randomUUID().replace(/-/g, '');
export const newOpId = (): string => uid().slice(0, 24);
const newTopicId = (): string => `t${uid().slice(0, 14)}`;

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const motionOk = (): boolean => !reducedMotion();

/** Everything the editor shows about one open map, and every way it can change. Components read it and re-render on notify. */
export class MapSession {
  readonly mapId: string;
  readonly me: MapPayload['me'];
  header: MapHeader;
  settings: MapSettings;
  role: Role;
  today: string;
  confirmed: MapDoc;
  display: MapDoc;
  derived = new Map<string, Derived>();
  layout: Layout = { boxes: new Map(), order: [] };
  places = new Map<string, Place>();
  counts: Counts;
  collapsed: Set<string>;
  revision: number;
  seq: number;
  pending: PendingGroup[] = [];
  connection: ConnectionState = 'live';
  expired = false;
  removed: 'access' | 'expired' | 'revoked' | null = null;
  people: PresenceEntry[] = [];
  cursors = new Map<string, CursorInfo>();
  following: string | null = null;
  toasts: Toast[] = [];
  announcement = '';
  recovered: RecoveredEntry[];
  presentation: PresentationInfo | null;
  roster: string[];
  focusId: string;
  focusWanted: string | null = null;
  selection: string[] = [];
  editing: Editing | null = null;
  view: View = { zoom: 1, panX: 0, panY: 0 };
  size = { w: 0, h: 0 };
  entering = new Set<string>();
  focusBranch: string | null = null;
  find: FindState = { open: false, query: '', replace: '', assignee: '', icon: '', state: '', current: 0 };
  versionsTick = 0;
  activityTick = 0;
  exports = new Map<string, ExportInfo>();
  focusIn: 'map' | 'outline' = 'map';
  inboxEvent = 0;
  flushStats: { sent: number; conflicts: number } | null = null;
  dropTarget: string | null = null;
  /** The view a presentation Fit to screen glides from; the canvas consumes it. */
  cameraFrom: View | null = null;
  /** Diff marks for a version shown against another: topic id to added, moved, edited or both. */
  diffMarks = new Map<string, string>();

  private listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private attempt = 0;
  private reconnectTimer: number | null = null;
  private sending = false;
  private titleLog: { revision: number; user: string; edit: TitleEdit & { topic: string } }[] = [];
  private titleBase: Record<string, string> = {};
  private toastId = 0;
  private lastCursorStamp = 0;
  private lastCursor = { x: 0, y: 0 };
  private firstCompute = true;
  private awaitingPaste: string | null = null;

  constructor(payload: MapPayload) {
    this.mapId = payload.map.id;
    this.me = payload.me;
    this.header = payload.map;
    this.settings = payload.settings;
    this.role = payload.map.role;
    this.today = payload.server_date;
    this.revision = payload.map.revision;
    this.seq = payload.seq;
    this.recovered = payload.recovered;
    this.presentation = payload.presentation;
    this.roster = payload.roster;
    this.collapsed = new Set(payload.collapsed);
    this.confirmed = docFromPayload(payload);
    this.counts = countsFromPayload(payload);
    this.display = this.confirmed;
    this.focusId = rootOf(this.confirmed.topics)?.id ?? '';
    this.restoreQueue();
    this.recompute();
  }

  // ------------------------------------------------------------------ plumbing

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  get canEdit(): boolean {
    return can(this.role, 'edit');
  }

  get queueMode(): boolean {
    return this.connection !== 'live' || this.expired;
  }

  get waiting(): number {
    return this.pending.filter((g) => g.acked === null).length;
  }

  topic(id: string): DocTopic | undefined {
    return this.display.topics[id];
  }

  /** Read-only guard for editing keys: announces the read-only sentence. */
  guardEdit(): boolean {
    if (this.canEdit) return true;
    this.announce(COPY.read_only);
    return false;
  }

  /** The reconnect summary stays in the live region for a few seconds, so the catch-up op sentences that follow it add to it instead of replacing it. */
  private backOnlineHold: { text: string; at: number } | null = null;

  private announceBackOnline(stats: { sent: number; conflicts: number }): void {
    const text = backOnline(stats.sent, stats.conflicts);
    this.announce(text);
    this.backOnlineHold = { text, at: Date.now() };
  }

  announce(text: string): void {
    const held = this.backOnlineHold;
    const said = held && text !== held.text && Date.now() - held.at < 5000 ? `${held.text} ${text}` : text;
    this.announcement = '';
    this.notify();
    queueMicrotask(() => {
      this.announcement = said;
      this.notify();
    });
  }

  notice(text: string): void {
    this.toastId += 1;
    const id = this.toastId;
    this.toasts = [...this.toasts, { id, text }];
    this.announce(text);
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.notify();
    }, this.settings.toast_ms);
  }

  private buildDisplay(): MapDoc {
    let doc = this.confirmed;
    for (const group of this.pending) {
      const applied = applyGroup(doc, this.opsForDisplay(group), this.me.name);
      if (applied) doc = applied.doc;
    }
    return this.editing?.draft ? this.withDraft(doc, this.editing) : doc;
  }

  private opsForDisplay(group: PendingGroup): Op[] {
    return group.ops.map((op) => {
      if (op.kind !== 'title') return op;
      const chain = this.titleLog.filter((t) => t.revision > group.base_revision && t.user !== this.me.name && t.edit.topic === op.topic_id);
      if (chain.length === 0) return op;
      const edit = chain.reduce<TitleEdit>((e, f) => transformTitleEdit(e, f.edit), op);
      return { ...op, offset: edit.offset, delete: edit.delete, insert: edit.insert };
    });
  }

  private withDraft(doc: MapDoc, editing: Editing): MapDoc {
    const draft = editing.draft;
    if (!draft) return doc;
    const copy = cloneDoc(doc);
    const topic: DocTopic = {
      id: editing.topicId,
      parent_id: draft.floating ? null : draft.parentId,
      rank: 0,
      floating: draft.floating !== null,
      x: draft.floating?.x ?? null,
      y: draft.floating?.y ?? null,
      title: normaliseTitle(editing.value) || COPY_NEW_TOPIC,
      note: '',
      icon: null,
      colour: null,
      shape: null,
      side_pin: null,
      task: null,
      locked_by: null,
      restricted: false,
      attachments: [],
      n: copy.next_n,
    };
    copy.next_n += 1;
    copy.topics[topic.id] = topic;
    if (draft.parentId && !draft.floating) {
      const siblings = childrenOf(copy.topics, draft.parentId).filter((t) => t.id !== topic.id);
      const at = draft.after === null ? 0 : siblings.findIndex((t) => t.id === draft.after) + 1;
      siblings.splice(at === 0 && draft.after !== null ? siblings.length : at, 0, topic);
      siblings.forEach((t, i) => {
        t.rank = i;
      });
    }
    return copy;
  }

  /** Rebuild everything derived from the document, my collapsed topics and my unsent changes. */
  recompute(): void {
    const before = this.display;
    this.display = this.pending.length === 0 && !this.editing?.draft ? this.confirmed : this.buildDisplay();
    if (!this.firstCompute) {
      const fresh = Object.keys(this.display.topics).filter((id) => !before.topics[id]);
      if (fresh.length > 0) this.entering = new Set([...this.entering, ...fresh]);
    }
    this.firstCompute = false;
    this.derived = deriveAll(this.display, this.today);
    this.layout = layoutDoc(this.display, this.collapsed);
    this.places = computePlaces(this.display);
    for (const id of [...this.collapsed]) if (!this.display.topics[id]) this.collapsed.delete(id);
    this.selection = this.selection.filter((id) => this.display.topics[id]);
  }

  label(id: string): string {
    return this.display.topics[id]?.title ?? '';
  }

  labelFor(id: string): string {
    const place = this.places.get(id) ?? { level: 1, pos: 1, size: 1 };
    return topicLabel(this.display, id, place, this.derived.get(id), this.counts, this.collapsed.has(id));
  }

  /** Home and End: the central topic, or the last visible topic in depth-first order. */
  jump(key: 'Home' | 'End'): void {
    this.selection = [];
    const target = key === 'Home' ? rootOf(this.display.topics)?.id : this.layout.order[this.layout.order.length - 1];
    if (target) this.requestFocus(target);
  }

  /** Alt+Shift+arrow: nudge a floating topic by 20 map units. */
  moveFloating(key: ArrowKey): void {
    if (!this.guardEdit()) return;
    const topic = this.display.topics[this.focusId];
    if (!topic?.floating) return;
    const step = 20;
    const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
    const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
    this.submit([{ op_id: newOpId(), kind: 'float_move', topic_id: topic.id, x: (topic.x ?? 0) + dx, y: (topic.y ?? 0) + dy }]);
  }

  // ----------------------------------------------------------- queue persistence

  private get storageKey(): string {
    return `sprig:queue:${this.me.id}:${this.mapId}`;
  }

  private persist(): void {
    const queued = this.pending.filter((g) => g.acked === null).map(({ group_id, base_revision, ops }) => ({ group_id, base_revision, ops }));
    if (queued.length === 0 && this.connection !== 'offline') {
      window.localStorage.removeItem(this.storageKey);
      return;
    }
    const stored: StoredQueue = { offline: this.connection === 'offline', groups: queued, titleBase: this.titleBase };
    window.localStorage.setItem(this.storageKey, JSON.stringify(stored));
  }

  private restoreQueue(): void {
    const raw = window.localStorage.getItem(this.storageKey);
    if (!raw) return;
    const stored = JSON.parse(raw) as StoredQueue;
    this.pending = stored.groups.map((g) => ({ ...g, acked: null }));
    this.titleBase = stored.titleBase;
    if (stored.offline) this.connection = 'offline';
  }

  // ------------------------------------------------------------------ network

  start(): void {
    if (this.connection === 'offline') return;
    this.openSocket();
    void this.flush(false);
  }

  stop(): void {
    this.closeSocket();
  }

  private closeSocket(): void {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }

  private openSocket(): void {
    this.closeSocket();
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${window.location.host}/api/maps/${this.mapId}/live?since=${this.seq}`);
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      if (this.connection === 'lost') {
        this.connection = 'live';
        this.notify();
        void this.flush(true);
      }
    };
    socket.onmessage = (event) => this.onMessage(JSON.parse(String(event.data)) as Sequenced<LiveMessage>);
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.connection === 'live' && !this.expired && this.removed === null) {
        this.connection = 'lost';
        this.persist();
        this.notify();
        const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 30000;
        this.attempt += 1;
        this.reconnectTimer = window.setTimeout(() => this.openSocket(), delay);
      }
    };
  }

  setOffline(offline: boolean): void {
    if (offline) {
      if (this.connection === 'offline') return;
      this.closeSocket();
      this.connection = 'offline';
      this.persist();
      this.notify();
      return;
    }
    if (this.connection !== 'offline') return;
    this.connection = 'live';
    this.persist();
    this.openSocket();
    this.notify();
    void this.flush(true);
  }

  /** Send every waiting group in order, then say how many went and how many met a conflict. */
  private async flush(announce: boolean): Promise<void> {
    if (announce) this.flushStats = { sent: 0, conflicts: 0 };
    await this.pump();
    const stats = this.flushStats;
    if (announce && stats && this.waiting === 0 && !this.sending) {
      this.flushStats = null;
      this.announceBackOnline(stats);
    }
  }

  private async pump(): Promise<void> {
    if (this.sending || this.queueMode || this.removed) return;
    const next = this.pending.find((g) => g.acked === null);
    if (!next) return;
    this.sending = true;
    try {
      const response = await api<OpsResponse>('POST', `/api/maps/${this.mapId}/ops`, {
        group_id: next.group_id,
        base_revision: next.base_revision,
        ops: next.ops,
      });
      this.onResponse(next, response);
    } catch (error) {
      this.onSendError(next, error);
    } finally {
      this.sending = false;
    }
    if (this.waiting > 0 && !this.queueMode) await this.pump();
    else this.finishFlush();
  }

  private finishFlush(): void {
    const stats = this.flushStats;
    if (stats && this.waiting === 0) {
      this.flushStats = null;
      this.announceBackOnline(stats);
    }
  }

  private onResponse(group: PendingGroup, response: OpsResponse): void {
    if (this.flushStats) {
      this.flushStats.sent += 1;
      if (response.status !== 'applied') this.flushStats.conflicts += 1;
    }
    const applied = response.status === 'applied' || response.status === 'merged';
    if (applied && this.revision < response.revision) group.acked = response.revision;
    else this.pending = this.pending.filter((g) => g !== group);
    if (response.notice) this.notice(response.notice);
    if (response.status === 'rejected') {
      const moved = group.ops.find((o) => o.kind === 'move');
      if (moved && moved.kind === 'move') this.requestFocus(moved.topic_id);
    }
    this.persist();
    this.recompute();
    this.notify();
  }

  private onSendError(group: PendingGroup, error: unknown): void {
    if (!(error instanceof HttpError)) {
      if (this.connection === 'live') this.connection = 'lost';
      this.persist();
      this.notify();
      return;
    }
    if (error.code === 'session_expired' || error.code === 'unauthenticated') {
      this.expireSession();
      return;
    }
    this.pending = this.pending.filter((g) => g !== group);
    this.reportFailure(error);
    this.persist();
    this.recompute();
    this.notify();
  }

  /** Show why the server refused a change; a change aimed at something gone also refreshes the map. */
  private reportFailure(error: HttpError): void {
    if (error.code === 'not_found' || error.code === 'stale_base') void this.resync();
    this.notice(error.code === 'not_found' ? COPY.missing_topic : error.message);
  }

  expireSession(): void {
    if (this.expired) return;
    this.expired = true;
    this.closeSocket();
    this.persist();
    this.notify();
  }

  /** After signing in again: reconnect and send what waited. */
  resumeSession(): void {
    this.expired = false;
    this.connection = 'live';
    this.openSocket();
    this.notify();
    void this.flush(true);
  }

  async resync(): Promise<void> {
    const payload = await api<MapPayload>('GET', `/api/maps/${this.mapId}`);
    this.confirmed = docFromPayload(payload);
    this.counts = countsFromPayload(payload);
    this.revision = payload.map.revision;
    this.seq = Math.max(this.seq, payload.seq);
    this.role = payload.map.role;
    this.header = payload.map;
    this.collapsed = new Set(payload.collapsed);
    this.recovered = payload.recovered;
    this.today = payload.server_date;
    this.presentation = payload.presentation;
    this.roster = payload.roster;
    this.titleLog = [];
    this.recompute();
    if (!this.display.topics[this.focusId]) this.focusId = rootOf(this.display.topics)?.id ?? '';
    this.notify();
  }

  // ------------------------------------------------------------ live messages

  private onMessage(message: Sequenced<LiveMessage>): void {
    this.seq = Math.max(this.seq, message.seq);
    switch (message.type) {
      case 'op':
        this.onOp(message);
        break;
      case 'resync':
        void this.resync();
        break;
      case 'presence':
        this.people = message.people;
        for (const user of [...this.cursors.keys()]) if (!message.people.some((p) => p.name === user)) this.cursors.delete(user);
        if (this.following && !message.people.some((p) => p.name === this.following)) this.following = null;
        this.notify();
        break;
      case 'cursor':
        this.cursors.set(message.user, { user: message.user, colour: message.colour, x: message.x, y: message.y, topicId: message.topic_id, view: message.view });
        if (this.following === message.user && message.view) this.adoptView(message.view);
        this.notify();
        break;
      case 'notice':
        this.notice(message.text);
        break;
      case 'comment':
        this.counts.comments[message.topic_id] = message.comment_count;
        this.activityTick += 1;
        if (message.by !== this.me.name) this.announce(`${message.by} commented on ${this.label(message.topic_id)}`);
        this.notify();
        break;
      case 'vote':
        this.counts.votes[message.topic_id] = message.vote_count;
        if (message.by !== this.me.name) this.announce(`${message.by} voted for ${this.label(message.topic_id)}`);
        this.notify();
        break;
      case 'role':
        this.role = message.role;
        this.header = { ...this.header, role: message.role };
        void this.resync().then(() => this.requestFocus(this.focusId));
        this.announce(noticeRole(message.role));
        break;
      case 'access_removed':
        this.removed = 'access';
        this.closeSocket();
        this.notify();
        break;
      case 'session_expired':
        this.expireSession();
        break;
      case 'link_expired':
        this.removed = message.state;
        this.closeSocket();
        this.notify();
        break;
      case 'version':
        this.versionsTick += 1;
        this.notify();
        break;
      case 'export':
        this.exports.set(message.export.id, message.export);
        this.notify();
        break;
      case 'presentation':
        this.presentation = message.presentation;
        this.onSkipped(message.skipped);
        this.notify();
        break;
      case 'recovered':
        this.recovered = message.entries;
        this.notify();
        break;
      case 'derived':
        this.today = message.server_date;
        this.recompute();
        this.notify();
        break;
      case 'inbox':
        this.inboxEvent = message.unread;
        this.notify();
        break;
    }
  }

  private skippedHandler: ((skipped: { index: number; reason: 'deleted' | 'restricted' }[]) => void) | null = null;

  onSkippedSlides(handler: (skipped: { index: number; reason: 'deleted' | 'restricted' }[]) => void): void {
    this.skippedHandler = handler;
  }

  private onSkipped(skipped: { index: number; reason: 'deleted' | 'restricted' }[]): void {
    if (skipped.length > 0) this.skippedHandler?.(skipped);
  }

  private onOp(message: Extract<LiveMessage, { type: 'op' }>): void {
    const previous = this.display;
    const applied = applyGroup(this.confirmed, message.ops, message.user);
    if (!applied) {
      void this.resync();
      return;
    }
    const mine = this.pending.some((g) => g.group_id === message.group_id);
    this.confirmed = applied.doc;
    this.revision = Math.max(this.revision, message.revision);
    this.pending = this.pending.filter((g) => g.group_id !== message.group_id && !(g.acked !== null && g.acked <= this.revision));
    for (const op of message.ops) {
      if (op.kind === 'title') this.titleLog.push({ revision: message.revision, user: message.user, edit: { topic: op.topic_id, offset: op.offset, delete: op.delete, insert: op.insert } });
    }
    this.titleLog = this.titleLog.filter((t) => t.revision > this.revision - 200);
    this.mergeIntoEditing(message);
    this.recompute();
    if (this.editing && !this.editing.draft && !this.display.topics[this.editing.topicId]) this.abandonEditing();
    this.settleFocusAfter(previous);
    this.activityTick += 1;
    if (this.awaitingPaste === message.group_id) {
      this.awaitingPaste = null;
      const pasted = message.ops.reduce((sum, op) => sum + (op.kind === 'put_branch' ? op.branch.topics.length : 0), 0);
      this.announce(`Pasted ${plural(pasted, 'topic', 'topics')}.`);
    } else if (message.user !== this.me.name && !mine) this.announce(message.sentence);
    if (this.focusBranch && !this.display.topics[this.focusBranch]) this.onFocusBranchDeleted();
    this.persist();
    this.notify();
  }

  private focusBranchDeleted: (() => void) | null = null;

  onFocusBranchGone(handler: () => void): void {
    this.focusBranchDeleted = handler;
  }

  private onFocusBranchDeleted(): void {
    this.focusBranch = null;
    this.notice(COPY.focus_deleted);
    this.focusBranchDeleted?.();
  }

  private settleFocusAfter(previous: MapDoc): void {
    if (this.display.topics[this.focusId]) return;
    const removed = previous.topics[this.focusId];
    const gone = new Set(Object.keys(previous.topics).filter((id) => !this.display.topics[id]));
    const landing = (removed ? focusAfterRemoval(previous, removed, gone) : null) ?? rootOf(this.display.topics)?.id ?? '';
    this.focusId = this.display.topics[landing] ? landing : (rootOf(this.display.topics)?.id ?? '');
    this.requestFocus(this.focusId);
  }

  // ------------------------------------------------------------ focus & view

  requestFocus(id: string): void {
    this.focusId = this.display.topics[id] || this.focusWanted === id ? id : this.focusId;
    this.focusWanted = id;
    this.notify();
  }

  setFocus(id: string): void {
    if (this.focusId === id) return;
    this.focusId = id;
    this.keepFocusInView(id);
    this.sendCursor(this.lastCursor.x, this.lastCursor.y, 0, true);
    this.notify();
  }

  clearSelection(): void {
    if (this.selection.length === 0) return;
    this.selection = [];
    this.notify();
  }

  private adoptView(report: ViewReport): void {
    if (this.size.w === 0) return;
    const centre = centreOf({ zoom: report.zoom, panX: report.pan_x, panY: report.pan_y }, report.width, report.height);
    this.view = followView(report.zoom, centre, this.size.w, this.size.h);
  }

  follow(user: string): void {
    this.following = user;
    this.announce(`Following ${user}.`);
    const cursor = this.cursors.get(user);
    if (cursor?.view) this.adoptView(cursor.view);
    this.notify();
  }

  stopFollowing(): void {
    if (!this.following) return;
    const name = this.following;
    this.following = null;
    this.announce(`Stopped following ${name}.`);
  }

  /** The canvas changed size: the map point at its centre stays at its centre. */
  setSize(w: number, h: number): void {
    const before = this.size;
    this.size = { w, h };
    if (before.w === 0) {
      this.view = openView(w, h);
      this.sendCursor(0, 0, 0, true);
    } else {
      this.view = { ...this.view, panX: this.view.panX + (w - before.w) / 2, panY: this.view.panY + (h - before.h) / 2 };
    }
    this.notify();
  }

  /** A view change made by me: it ends following and is reported to others. */
  setView(view: View): void {
    this.stopFollowing();
    this.view = { zoom: clampZoom(view.zoom), panX: view.panX, panY: view.panY };
    this.sendCursor(this.lastCursor.x, this.lastCursor.y, 0, true);
    this.notify();
  }

  zoomWheel(deltaY: number, px: number, py: number): void {
    this.setView(wheelZoom(this.view, deltaY, px, py));
  }

  pinch(start: View, zoom: number, px: number, py: number): void {
    this.setView(zoomAbout(start, zoom, px, py));
  }

  panBy(dx: number, dy: number): void {
    this.setView({ ...this.view, panX: this.view.panX + dx, panY: this.view.panY + dy });
  }

  fit(): void {
    const boxes = [...this.layout.boxes.values()].filter((b) => this.shown(b.id));
    if (this.presentation && canStep(this.presentation.state)) this.cameraFrom = this.view;
    this.setView(fitView(boxes, this.size.w, this.size.h));
  }

  /** Is a topic part of what the canvas shows (the whole map, or the focused branch)? */
  shown(id: string): boolean {
    if (!this.focusBranch) return true;
    return id === this.focusBranch || ancestorsOf(this.display.topics, id).some((a) => a.id === this.focusBranch);
  }

  keepFocusInView(id: string): void {
    const box = this.layout.boxes.get(id);
    if (!box || this.size.w === 0) return;
    const next = keepInView(this.view, box, this.size.w, this.size.h);
    if (next !== this.view) this.setView(next);
  }

  sendCursor(x: number, y: number, stamp: number, force = false): void {
    this.lastCursor = { x, y };
    if (!force && stamp - this.lastCursorStamp < 40) return;
    this.lastCursorStamp = stamp;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: 'cursor',
        x,
        y,
        topic_id: this.display.topics[this.focusId] ? this.focusId : null,
        view: { zoom: this.view.zoom, pan_x: this.view.panX, pan_y: this.view.panY, width: this.size.w, height: this.size.h },
      }),
    );
  }

  // ------------------------------------------------------------------- submit

  /** Make a change: applied on screen at once, then sent (or queued while offline). */
  submit(ops: PublicOp[], base: number = this.revision): void {
    if (ops.length === 0) return;
    if (this.queueMode && this.combineOffline(ops)) {
      this.persist();
      this.recompute();
      this.notify();
      return;
    }
    const group: PendingGroup = { group_id: `g${uid().slice(0, 20)}`, base_revision: base, ops, acked: null };
    if (this.queueMode) this.rememberTitles(ops);
    this.pending.push(group);
    this.persist();
    this.recompute();
    this.notify();
    void this.pump();
  }

  private rememberTitles(ops: PublicOp[]): void {
    for (const op of ops) {
      if (op.kind === 'title' && this.titleBase[op.topic_id] === undefined) {
        const title = this.display.topics[op.topic_id]?.title;
        if (title !== undefined) this.titleBase[op.topic_id] = title;
      }
    }
  }

  /** While offline, edits of one title become one queued edit: the range between its title when I went offline and its text now. */
  private combineOffline(ops: PublicOp[]): boolean {
    const only = ops.length === 1 ? ops[0] : undefined;
    if (!only || only.kind !== 'title') return false;
    const existing = this.pending.find((g) => g.acked === null && g.ops.length === 1 && g.ops[0]?.kind === 'title' && g.ops[0].topic_id === only.topic_id);
    if (!existing) return false;
    const current = this.display.topics[only.topic_id]?.title ?? '';
    const base = this.titleBase[only.topic_id] ?? current;
    const next = normaliseTitle(applyTitleEdit(current, only));
    const edit = diffTitleEdit(base, next);
    if (!edit) {
      this.pending = this.pending.filter((g) => g !== existing);
      return true;
    }
    existing.ops = [{ op_id: newOpId(), kind: 'title', topic_id: only.topic_id, ...edit }];
    return true;
  }

  // ------------------------------------------------------------------- editing

  private startEdit(editing: Editing): void {
    this.editing = editing;
    this.focusId = editing.topicId;
    this.recompute();
    this.notify();
  }

  startRename(id: string, key: string | null): void {
    if (!this.guardEdit()) return;
    const topic = this.display.topics[id];
    if (!topic) return;
    const value = key ?? topic.title;
    this.startEdit({
      topicId: id,
      isNew: false,
      sync: topic.title,
      value,
      caret: Array.from(value).length,
      draft: null,
      version: 1,
      mode: 'end',
      where: this.focusIn,
      syncRevision: this.revision,
    });
  }

  private startAdd(parentId: string | null, after: string | null, floating: { x: number; y: number } | null): void {
    const id = newTopicId();
    this.selection = [];
    this.startEdit({ topicId: id, isNew: true, sync: COPY_NEW_TOPIC, value: COPY_NEW_TOPIC, caret: COPY_NEW_TOPIC.length, draft: { parentId, after, floating }, version: 1, mode: 'select', where: this.focusIn, syncRevision: this.revision });
  }

  addChild(from: string): void {
    if (!this.guardEdit()) return;
    const topic = this.display.topics[from];
    if (!topic) return;
    if (this.collapsed.has(from)) this.setCollapsed(from, false);
    const last = childrenOf(this.display.topics, from).at(-1);
    this.startAdd(from, last?.id ?? null, null);
  }

  addSibling(from: string): void {
    if (!this.guardEdit()) return;
    const topic = this.display.topics[from];
    if (!topic) return;
    if (topic.parent_id === null) {
      this.addChild(from);
      return;
    }
    this.startAdd(topic.parent_id, topic.id, null);
  }

  addFloating(): void {
    if (!this.guardEdit()) return;
    const root = rootOf(this.display.topics);
    const drop = floatingDrop(this.layout, this.layout.boxes.get(root?.id ?? '')?.x ?? 0);
    this.startAdd(null, null, drop);
  }

  editInput(value: string, caret: number): void {
    const editing = this.editing;
    if (!editing) return;
    editing.value = value;
    editing.caret = caret;
    if (editing.draft) this.recompute();
    this.notify();
  }

  /** The title input's Enter: commit. */
  commitEdit(): void {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    if (editing.isNew && editing.draft) this.commitNew(editing);
    else this.commitRename(editing);
    this.requestFocus(editing.topicId);
  }

  /** The title input's Escape: a new topic stays titled New topic; a rename restores the old title. */
  cancelEdit(): void {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    if (editing.isNew && editing.draft) {
      editing.value = COPY_NEW_TOPIC;
      this.commitNew(editing);
    } else {
      this.recompute();
      this.notify();
    }
    this.requestFocus(editing.topicId);
  }

  private commitNew(editing: Editing): void {
    const draft = editing.draft;
    if (!draft) return;
    const title = normaliseTitle(editing.value) || COPY_NEW_TOPIC;
    const op: PublicOp = draft.floating
      ? { op_id: newOpId(), kind: 'add_floating', topic_id: editing.topicId, x: draft.floating.x, y: draft.floating.y, title }
      : { op_id: newOpId(), kind: 'add', topic_id: editing.topicId, parent_id: draft.parentId ?? '', after: draft.after, title };
    this.submit([op]);
  }

  private commitRename(editing: Editing): void {
    const text = normaliseTitle(editing.value);
    const edit = text.length > 0 ? diffTitleEdit(editing.sync, text) : null;
    if (edit) this.submit([{ op_id: newOpId(), kind: 'title', topic_id: editing.topicId, ...edit }], editing.syncRevision);
    else {
      this.recompute();
      this.notify();
    }
  }

  /** The topic being edited vanished: send what was typed so it lands in Recovered edits, and move focus on. */
  private abandonEditing(): void {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    const edit = diffTitleEdit(editing.sync, normaliseTitle(editing.value));
    if (edit) this.submit([{ op_id: newOpId(), kind: 'title', topic_id: editing.topicId, ...edit }], editing.syncRevision);
  }

  private mergeIntoEditing(message: Extract<LiveMessage, { type: 'op' }>): void {
    const editing = this.editing;
    if (!editing || editing.isNew || !this.confirmed.topics[editing.topicId]) return;
    for (const op of message.ops) {
      if (op.kind !== 'title' || op.topic_id !== editing.topicId || message.user === this.me.name) continue;
      const remote: TitleEdit = { offset: op.offset, delete: op.delete, insert: op.insert };
      const synced = normaliseTitle(applyTitleEdit(editing.sync, remote));
      const pending = diffTitleEdit(editing.sync, editing.value);
      if (!pending) {
        editing.value = synced;
        editing.caret = mapCaret(editing.caret, remote);
      } else {
        const moved = transformTitleEdit(pending, remote);
        editing.value = normaliseTitle(applyTitleEdit(synced, moved));
        editing.caret = moved.offset + Array.from(moved.insert).length;
      }
      editing.sync = synced;
      editing.syncRevision = message.revision;
      editing.version += 1;
    }
  }

  // ------------------------------------------------------------------ actions

  deleteSelection(): void {
    if (!this.guardEdit()) return;
    const ids = this.selection.length > 0 ? this.selection : [this.focusId];
    const root = rootOf(this.display.topics);
    if (ids.includes(root?.id ?? '')) {
      this.notice(COPY.root_delete);
      return;
    }
    const chosen = new Set(ids);
    const tops = ids.filter((id) => !ancestorsOf(this.display.topics, id).some((a) => chosen.has(a.id)));
    const last = this.display.topics[tops[tops.length - 1] ?? ''];
    const gone = new Set(tops.flatMap((id) => branchOf(this.display.topics, id, childrenIndex(this.display.topics)).map((t) => t.id)));
    const landing = last ? focusAfterRemoval(this.display, last, new Set(tops)) : null;
    this.submit(tops.map((id) => ({ op_id: newOpId(), kind: 'delete', topic_id: id })));
    this.selection = [];
    const target = landing && !gone.has(landing) ? landing : (root?.id ?? '');
    this.focusId = target;
    this.requestFocus(target);
  }

  move(key: ArrowKey, mode: LayoutMode = this.display.layout): void {
    if (!this.guardEdit()) return;
    const ids = this.selection.length > 0 ? this.selection : [this.focusId];
    const plan = planMove({ doc: this.display, layout: this.layout, mode, collapsed: this.collapsed }, ids, key, newOpId);
    const topic = this.display.topics[this.focusId];
    if (!plan) {
      if (topic) this.announce(`${topic.title} can't move that way.`);
      return;
    }
    if (plan.expand) this.setCollapsed(plan.expand, false);
    this.submit(plan.ops);
    const moved = this.display.topics[this.focusId];
    const place = this.places.get(this.focusId);
    const parent = moved?.parent_id ? this.display.topics[moved.parent_id] : undefined;
    if (moved && place && parent) this.announce(`${moved.title} is now ${place.pos} of ${place.size} under ${parent.title}.`);
    this.requestFocus(this.focusId);
  }

  arrow(key: ArrowKey, mode: LayoutMode = this.display.layout): void {
    const result = arrowTarget({ doc: this.display, layout: this.layout, mode, collapsed: this.collapsed }, this.focusId, key);
    this.selection = [];
    if (result.expand) {
      this.setCollapsed(result.expand, false);
      return;
    }
    if (result.target) this.requestFocus(result.target);
    else this.notify();
  }

  toggleCollapse(id: string): void {
    const topic = this.display.topics[id];
    if (!topic || (this.derived.get(id)?.subtopics ?? 0) === 0) return;
    this.setCollapsed(id, !this.collapsed.has(id));
  }

  setCollapsed(id: string, collapsed: boolean): void {
    const topic = this.display.topics[id];
    if (!topic || this.collapsed.has(id) === collapsed) return;
    if (collapsed) this.collapsed.add(id);
    else this.collapsed.delete(id);
    this.recompute();
    this.announce(`${topic.title} ${collapsed ? 'collapsed' : 'expanded'}`);
    this.notify();
    void api('PUT', `/api/maps/${this.mapId}/collapse`, { topic_id: id, collapsed }).catch(() => undefined);
  }

  toggleSelect(id: string): void {
    const current = this.selection.length > 0 ? this.selection : [this.focusId];
    this.selection = current.includes(id) ? current.filter((s) => s !== id) : [...current, id];
    this.announceSelection();
    this.focusId = id;
    this.notify();
  }

  extendSelection(direction: 1 | -1): void {
    const topic = this.display.topics[this.focusId];
    if (!topic || topic.parent_id === null) return;
    const siblings = childrenOf(this.display.topics, topic.parent_id);
    const at = siblings.findIndex((s) => s.id === topic.id);
    const next = siblings[at + direction];
    if (!next) return;
    const current = this.selection.length > 0 ? this.selection : [topic.id];
    this.selection = current.includes(next.id) ? current.filter((s) => s !== topic.id) : [...current, next.id];
    this.announceSelection();
    this.requestFocus(next.id);
  }

  private announceSelection(): void {
    this.announce(`${plural(this.selection.length, 'topic', 'topics')} selected.`);
  }

  undo(): void {
    void this.step('undo');
  }

  redo(): void {
    void this.step('redo');
  }

  private async step(direction: 'undo' | 'redo'): Promise<void> {
    if (!this.guardEdit()) return;
    if (this.queueMode) {
      const last = [...this.pending].reverse().find((g) => g.acked === null);
      if (direction === 'redo' || !last) {
        this.announce(direction === 'undo' ? COPY.nothing_undo : COPY.nothing_redo);
        return;
      }
      this.pending = this.pending.filter((g) => g !== last);
      this.persist();
      this.recompute();
      this.announce(COPY.undone);
      if (!this.display.topics[this.focusId]) this.requestFocus(rootOf(this.display.topics)?.id ?? '');
      return;
    }
    try {
      const response = await api<{ status: string; revision: number; focus_topic_id: string | null; notice: string }>('POST', `/api/maps/${this.mapId}/${direction}`);
      if (response.status === 'skipped') this.notice(response.notice);
      else this.announce(response.notice);
      if (response.focus_topic_id) this.requestFocus(response.focus_topic_id);
    } catch (error) {
      if (!(error instanceof HttpError)) return;
      if (error.code === 'session_expired' || error.code === 'unauthenticated') this.expireSession();
      else this.reportFailure(error);
    }
  }

  // ----------------------------------------------------------------- find

  setFind(patch: Partial<FindState>): void {
    this.find = { ...this.find, ...patch };
    if (patch.query !== undefined) {
      this.find.current = 0;
      this.expandMatches();
    }
    this.notify();
  }

  matches(): string[] {
    const q = this.find.query.trim().toLowerCase();
    if (q.length === 0) return [];
    return this.layoutOrderAll().filter((t) => t.title.toLowerCase().includes(q) || t.note.toLowerCase().includes(q)).map((t) => t.id);
  }

  private layoutOrderAll(): DocTopic[] {
    const index = childrenIndex(this.display.topics);
    const root = rootOf(this.display.topics);
    return [...(root ? branchOf(this.display.topics, root.id, index) : []), ...floatingOf(this.display.topics).flatMap((f) => branchOf(this.display.topics, f.id, index))];
  }

  isDimmed(id: string): boolean {
    const f = this.find;
    const topic = this.display.topics[id];
    if (!topic) return false;
    const q = f.query.trim().toLowerCase();
    if (q.length > 0 && !topic.title.toLowerCase().includes(q) && !topic.note.toLowerCase().includes(q)) return true;
    if (f.assignee && topic.task?.assignee !== f.assignee) return true;
    if (f.icon && topic.icon !== f.icon) return true;
    if (f.state) {
      const task = topic.task;
      const ok = f.state === 'done' ? task !== null && task.state === 'open' && task.percent === 100 : task?.state === f.state && !(f.state === 'open' && task.percent === 100);
      if (!ok) return true;
    }
    return false;
  }

  private expandMatches(): void {
    for (const id of this.matches()) {
      for (const ancestor of ancestorsOf(this.display.topics, id)) if (this.collapsed.has(ancestor.id)) this.setCollapsed(ancestor.id, false);
    }
  }

  stepMatch(direction: 1 | -1): void {
    const found = this.matches();
    if (found.length === 0) return;
    const at = (this.find.current + direction + found.length) % found.length;
    this.find.current = at;
    const id = found[at] as string;
    this.requestFocus(id);
  }

  replaceAll(): void {
    if (!this.guardEdit()) return;
    const q = this.find.query.trim();
    if (q.length === 0) return;
    const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const ops: PublicOp[] = [];
    let replaced = 0;
    let skipped = 0;
    for (const id of this.matches()) {
      const topic = this.display.topics[id];
      if (!topic) continue;
      const lock = lockOf(this.display.topics, id);
      if (lock && lock.holder !== this.me.name && !can(this.role, 'unlock_any')) {
        skipped += 1;
        continue;
      }
      replaced += 1;
      const title = normaliseTitle(topic.title.replace(pattern, () => this.find.replace));
      if (title !== topic.title && title.length > 0) {
        ops.push({ op_id: newOpId(), kind: 'title', topic_id: id, offset: 0, delete: Array.from(topic.title).length, insert: title });
      }
      const note = topic.note.replace(pattern, () => this.find.replace);
      if (note !== topic.note) ops.push({ op_id: newOpId(), kind: 'note', topic_id: id, text: note });
    }
    this.submit(ops);
    this.announce(`Replaced ${replaced}. Skipped ${skipped} locked.`);
  }

  // --------------------------------------------------------------- structure ops

  setLayout(layout: MapDoc['layout']): void {
    if (!this.guardEdit()) return;
    this.submit([{ op_id: newOpId(), kind: 'layout', layout }]);
  }

  setTheme(theme: MapDoc['theme']): void {
    if (!this.guardEdit()) return;
    this.submit([{ op_id: newOpId(), kind: 'theme', theme }]);
  }

  copy(): void {
    const ids = this.selection.length > 0 ? this.selection : [this.focusId];
    void api<{ topics: number }>('POST', '/api/clipboard', { map_id: this.mapId, topic_ids: ids }).then((r) => this.announce(`Copied ${plural(r.topics, 'topic', 'topics')}.`));
  }

  paste(): void {
    if (!this.guardEdit()) return;
    const groupId = `g${uid().slice(0, 20)}`;
    this.awaitingPaste = groupId;
    void api<OpsResponse>('POST', `/api/maps/${this.mapId}/paste`, { parent_id: this.focusId, group_id: groupId, base_revision: this.revision }).catch((error: unknown) => {
      this.awaitingPaste = null;
      if (!(error instanceof HttpError)) return;
      if (error.code === 'clipboard_empty') this.announce(COPY.nothing_paste);
      else this.reportFailure(error);
    });
  }
}

const COPY_NEW_TOPIC = 'New topic';

/** A payload for a document that is not live: a version shown read-only. */
export function payloadFromDoc(doc: MapDoc, info: { mapId: string; title: string; revision: number; me: MapPayload['me']; today: string }): MapPayload {
  const derived = deriveAll(doc, info.today);
  return {
    map: { id: info.mapId, title: info.title, revision: info.revision, layout: doc.layout, theme: doc.theme, owner: '', role: 'viewer', custom_colours: doc.custom_colours },
    topics: Object.values(doc.topics).map((t) => ({
      ...t,
      lock_inherited: false,
      comment_count: 0,
      vote_count: 0,
      voted: false,
      derived: derived.get(t.id) as Derived,
    })),
    links: doc.links,
    boundaries: doc.boundaries,
    collapsed: [],
    slides: doc.slides,
    recovered: [],
    server_time: '',
    server_date: info.today,
    settings: { toast_ms: 5000, presence_timeout_ms: 0, virtual_from: 300, dom_margin_px: 200, dom_ceiling: 400, attach_max_bytes: 0, map_quota_bytes: 0, outline_max_bytes: 0 },
    seq: 0,
    next_n: doc.next_n,
    presentation: null,
    me: info.me,
    roster: [],
  };
}


const backOnline = (sent: number, conflicts: number): string =>
  `Back online: ${plural(sent, 'change', 'changes')} sent, ${plural(conflicts, 'conflict', 'conflicts')}.`;

export const offlineBanner = (n: number): string => `You're working offline. ${plural(n, 'change', 'changes')} waiting.`;
export const lostBanner = (n: number): string => `Connection lost. Trying again. ${plural(n, 'change', 'changes')} waiting.`;

function docFromPayload(payload: MapPayload): MapDoc {
  const topics = newTopics();
  for (const t of payload.topics) {
    topics[t.id] = {
      id: t.id,
      parent_id: t.parent_id,
      rank: t.rank,
      floating: t.floating,
      x: t.x,
      y: t.y,
      title: t.title,
      note: t.note,
      icon: t.icon,
      colour: t.colour,
      shape: t.shape,
      side_pin: t.side_pin,
      task: t.task,
      locked_by: t.locked_by,
      restricted: t.restricted,
      attachments: t.attachments,
      n: t.n,
    };
  }
  return {
    topics,
    links: payload.links,
    boundaries: payload.boundaries,
    slides: payload.slides,
    layout: payload.map.layout,
    theme: payload.map.theme,
    custom_colours: payload.map.custom_colours,
    next_n: payload.next_n,
  };
}

function countsFromPayload(payload: MapPayload): Counts {
  const counts: Counts = { comments: {}, votes: {}, mine: new Set() };
  for (const t of payload.topics) {
    counts.comments[t.id] = t.comment_count;
    counts.votes[t.id] = t.vote_count;
    if (t.voted) counts.mine.add(t.id);
  }
  return counts;
}
