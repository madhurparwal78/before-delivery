import type {
  MapPayload, MapMeta, Topic, CrossLink, Boundary, Operation, GroupResponse, RecoveredEntry,
  Role, PersonInfo, ActivityEntry, CommentThread, SettingsPublic,
} from '../../shared/types.js';
import { layoutMap, type Box } from '../../shared/layout.js';
import { api, errorOf, toast, type ApiOut } from './api.js';
import { el } from './dom.js';

/**
 * The editor store: one authoritative client-side copy of the map,
 * the operation queue, the live connection and the offline queue.
 */

export interface EditorState {
  map: MapMeta;
  topics: Map<string, Topic>;
  links: CrossLink[];
  boundaries: Boundary[];
  collapsed: Set<string>;
  slides: string[];
  recovered: RecoveredEntry[];
  settings: SettingsPublic;
  revision: number;
  serverTime: string;
  serverDate: string;
  people: PersonInfo[];
  offline: boolean;
  queue: QueuedGroup[];
  me: string | null;
  myRole: Role;
  followUser: string | null;
}

export interface QueuedGroup {
  groupId: string;
  baseRevision: number;
  ops: Operation[];
}

type Listener = () => void;

export class EditorStore {
  state: EditorState;
  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private seq = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private queueKey: string;
  private announcementEl: HTMLElement | null = null;
  private connectionEl: HTMLElement | null = null;

  constructor(payload: MapPayload, me: string | null) {
    this.state = {
      map: payload.map,
      topics: new Map(payload.topics.map((t) => [t.id, t])),
      links: payload.links,
      boundaries: payload.boundaries,
      collapsed: new Set(payload.collapsed),
      slides: payload.slides,
      recovered: payload.recovered,
      settings: payload.settings,
      revision: payload.map.revision,
      serverTime: payload.server_time,
      serverDate: payload.server_date,
      people: [],
      offline: false,
      queue: [],
      me,
      myRole: payload.map.role,
      followUser: null,
    };
    this.queueKey = `sprig-queue-${payload.map.id}`;
    this.loadQueue();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  setAnnouncement(el: HTMLElement): void { this.announcementEl = el; }
  setConnection(el: HTMLElement): void { this.connectionEl = el; }

  /** Announce into status "Map announcements" and show a toast. */
  announce(text: string): void {
    if (this.announcementEl) this.announcementEl.textContent = text;
    toast(text);
  }

  private bannerText(): void {
    if (!this.connectionEl) return;
    const n = this.state.queue.length;
    if (this.state.offline) {
      this.connectionEl.textContent = n === 1 ? `You're working offline. 1 change waiting.` : `You're working offline. ${n} changes waiting.`;
    } else if (this.ws === null || this.ws.readyState > 1) {
      this.connectionEl.textContent = n === 1 ? `Connection lost. Trying again. 1 change waiting.` : `Connection lost. Trying again. ${n} changes waiting.`;
    } else {
      this.connectionEl.textContent = '';
    }
  }

  // ---- queue persistence ------------------------------------------------

  private loadQueue(): void {
    try {
      const raw = localStorage.getItem(this.queueKey);
      if (raw) this.state.queue = JSON.parse(raw) as QueuedGroup[];
    } catch { this.state.queue = []; }
  }

  private saveQueue(): void {
    try {
      localStorage.setItem(this.queueKey, JSON.stringify(this.state.queue));
    } catch { /* storage unavailable: the queue lives in memory */ }
    this.bannerText();
  }

  // ---- operations -------------------------------------------------------

  /** Apply operations locally, then send the group. */
  async send(ops: Operation[], opts: { silent?: boolean } = {}): Promise<ApiOut<GroupResponse> | null> {
    if (ops.length === 0) return null;
    const groupId = `g-${crypto.randomUUID()}`;
    const group: QueuedGroup = { groupId, baseRevision: this.state.revision, ops };
    this.applyLocally(ops);
    this.emit();
    if (this.state.offline || this.ws === null || this.ws.readyState > 1) {
      this.state.queue.push(group);
      this.saveQueue();
      return null;
    }
    const out = await api<GroupResponse>(`/api/maps/${this.state.map.id}/ops`, 'POST', { group_id: groupId, base_revision: group.baseRevision, ops });
    if (!out.ok) {
      const err = errorOf(out);
      if (err.code === 'stale_base' || err.code === 'op_id_reused') {
        this.announce(err.message);
      } else {
        this.state.queue.push(group);
        this.saveQueue();
        return out;
      }
    }
    return out;
  }

  private applyLocally(ops: Operation[]): void {
    for (const op of ops) {
      switch (op.kind) {
        case 'add': {
          const parent = this.state.topics.get(op.parent_id ?? '');
          if (!parent) break;
          const siblings = [...this.state.topics.values()].filter((t) => t.parent_id === op.parent_id);
          this.state.topics.set(op.topic_id!, {
            id: op.topic_id!, parent_id: op.parent_id ?? null, rank: siblings.length, floating: false, x: null, y: null,
            title: op.title ?? 'New topic', note: '', icon: null, colour: null, shape: null, side_pin: null,
            task: null, locked_by: null, lock_inherited: false, restricted: false,
            attachments: [], comment_count: 0, vote_count: 0, voted: false,
            derived: { colour: 'indigo', shape: 'pill', text: 'ink', percent: null, earliest_due: null, overdue: false, blocked_by: [], blocked_count: 0, subtopics: 0 },
          });
          break;
        }
        case 'add_floating': {
          this.state.topics.set(op.topic_id!, {
            id: op.topic_id!, parent_id: null, rank: 0, floating: true, x: op.x ?? 0, y: op.y ?? 0,
            title: op.title ?? 'New topic', note: '', icon: null, colour: null, shape: null, side_pin: null,
            task: null, locked_by: null, lock_inherited: false, restricted: false,
            attachments: [], comment_count: 0, vote_count: 0, voted: false,
            derived: { colour: 'indigo', shape: 'pill', text: 'ink', percent: null, earliest_due: null, overdue: false, blocked_by: [], blocked_count: 0, subtopics: 0 },
          });
          break;
        }
        case 'title': {
          const t = this.state.topics.get(op.topic_id ?? '');
          if (t) {
            const chars = [...t.title];
            chars.splice(Math.min(op.offset ?? 0, chars.length), op.delete ?? 0, ...(op.insert ?? ''));
            t.title = chars.join('');
          }
          break;
        }
        case 'note': {
          const t = this.state.topics.get(op.topic_id ?? '');
          if (t) t.note = op.text ?? '';
          break;
        }
        case 'move': {
          const t = this.state.topics.get(op.topic_id ?? '');
          if (t) { t.parent_id = op.parent_id ?? null; t.rank = 999; }
          break;
        }
        case 'float_move': {
          const t = this.state.topics.get(op.topic_id ?? '');
          if (t) { t.x = op.x ?? t.x; t.y = op.y ?? t.y; }
          break;
        }
        case 'delete': {
          const sub = this.descendantsOf(op.topic_id ?? '');
          for (const id of [op.topic_id ?? '', ...sub]) this.state.topics.delete(id);
          this.state.links = this.state.links.filter((l) => ![op.topic_id, ...sub].includes(l.from) && ![op.topic_id, ...sub].includes(l.to));
          this.state.boundaries = this.state.boundaries.filter((b) => b.topic_id !== op.topic_id && !sub.includes(b.topic_id));
          this.state.slides = this.state.slides.filter((s) => s !== op.topic_id && !sub.includes(s));
          break;
        }
        case 'task': {
          const t = this.state.topics.get(op.topic_id ?? '');
          if (t && op.task !== null && op.task !== undefined) t.task = { ...(t.task ?? { percent: 0, weight: 1, state: 'open', priority: 'normal', due: null, assignee: null }), ...op.task };
          else if (t && op.task === null) t.task = null;
          break;
        }
        case 'style': {
          const t = this.state.topics.get(op.topic_id ?? '');
          if (t) {
            if ('colour' in op) t.colour = op.colour ?? null;
            if ('shape' in op) t.shape = op.shape ?? null;
            if ('icon' in op) t.icon = op.icon ?? null;
          }
          break;
        }
        case 'pin': {
          const t = this.state.topics.get(op.topic_id ?? '');
          if (t) t.side_pin = (op.side as 'left' | 'right' | null) ?? null;
          break;
        }
        case 'link_add': {
          this.state.links.push({ id: op.link_id!, from: op.from!, to: op.to!, label: op.label ?? '', type: op.type ?? 'related' });
          break;
        }
        case 'link_remove': {
          this.state.links = this.state.links.filter((l) => l.id !== op.link_id);
          break;
        }
        case 'boundary_add': {
          this.state.boundaries.push({ id: op.boundary_id!, topic_id: op.topic_id!, label: op.label ?? '' });
          break;
        }
        case 'boundary_remove': {
          this.state.boundaries = this.state.boundaries.filter((b) => b.id !== op.boundary_id);
          break;
        }
        case 'lock': {
          const t = this.state.topics.get(op.topic_id ?? '');
          if (t) t.locked_by = this.state.me;
          break;
        }
        case 'unlock': {
          const t = this.state.topics.get(op.topic_id ?? '');
          if (t) t.locked_by = null;
          break;
        }
        case 'restrict': {
          const t = this.state.topics.get(op.topic_id ?? '');
          if (t) t.restricted = Boolean(op.restricted);
          break;
        }
        case 'layout': {
          this.state.map.layout = op.layout ?? this.state.map.layout;
          break;
        }
        case 'theme': {
          this.state.map.theme = op.theme ?? this.state.map.theme;
          break;
        }
        case 'slides': {
          this.state.slides = op.order ?? this.state.slides;
          break;
        }
        case 'custom_colour': {
          if (op.colour && !this.state.map.custom_colours.includes(op.colour)) this.state.map.custom_colours.push(op.colour);
          break;
        }
      }
    }
    this.recomputeDerived();
  }

  descendantsOf(id: string): string[] {
    const out: string[] = [];
    const walk = (tid: string) => {
      for (const t of this.state.topics.values()) if (t.parent_id === tid) { out.push(t.id); walk(t.id); }
    };
    walk(id);
    return out;
  }

  ancestorsOf(id: string): string[] {
    const out: string[] = [];
    let cur = this.state.topics.get(id)?.parent_id ?? null;
    while (cur) { out.push(cur); cur = this.state.topics.get(cur)?.parent_id ?? null; }
    return out;
  }

  /** Re-run the layout engine for the visible tree. */
  layout(): { boxes: Map<string, Box>; sides: Map<string, 'right' | 'left' | 'none'>; levels: Map<string, number> } {
    const visible = (id: string) => {
      const t = this.state.topics.get(id);
      if (!t) return false;
      if (this.state.collapsed.has(id)) return false;
      if (t.restricted && !(this.state.myRole === 'owner' || this.state.myRole === 'editor')) return false;
      return true;
    };
    return layoutMap([...this.state.topics.values()], this.state.map.layout, new Set(), visible);
  }

  /** Every derived value recomputes after any change. */
  recomputeDerived(): void {
    for (const t of this.state.topics.values()) {
      const visible = this.visibleCount(t.id);
      t.derived = { ...t.derived, subtopics: visible };
    }
    // Blocked counts, rollups and colours are recomputed by the server's
    // derived messages; the client re-derives them locally too.
    this.recomputeLocalDerived();
  }

  private visibleCount(id: string): number {
    let n = 0;
    const walk = (tid: string) => {
      for (const t of this.state.topics.values()) if (t.parent_id === tid && !this.isCollapsedOrHidden(tid)) { n += 1; walk(t.id); }
    };
    walk(id);
    return n;
  }

  isCollapsedOrHidden(id: string): boolean {
    return this.state.collapsed.has(id);
  }

  private recomputeLocalDerived(): void {
    // simple local recompute of branch colours and shapes from the cascade
    const byParent = new Map<string, Topic[]>();
    for (const t of this.state.topics.values()) {
      const key = t.parent_id ?? '';
      const arr = byParent.get(key) ?? [];
      arr.push(t);
      byParent.set(key, arr);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => a.rank - b.rank);
    const root = [...this.state.topics.values()].find((t) => t.parent_id === null && !t.floating);
    const rootKids = byParent.get(root?.id ?? '') ?? [];
    const branchColours = ['indigo', 'azure', 'teal', 'green', 'violet', 'magenta', 'orange', 'ochre'];
    const walk = (t: Topic, inherited: string | null, shapeInherited: string | null, level: number) => {
      const colour = t.colour ?? inherited ?? branchColours[(rootKids.findIndex((k) => k.id === branchTop(t).id) + branchColours.length) % branchColours.length];
      const themeShape: 'pill' | 'underline' | 'filled' = this.state.map.theme === 'daylight' ? 'pill' : this.state.map.theme === 'paper' ? 'underline' : 'filled';
      const shape: 'rounded' | 'pill' | 'underline' | 'filled' = t.shape ?? (level === 0 && !t.floating ? 'rounded' : (shapeInherited as 'pill' | 'underline' | 'filled' | null) ?? themeShape);
      const text = shape === 'filled' || shape === 'rounded' ? (['indigo', 'violet', 'magenta', 'accent'].includes(colour) ? 'white' : 'ink') : 'ink';
      t.derived = { ...t.derived, colour, shape, text };
      for (const c of byParent.get(t.id) ?? []) walk(c, t.colour ?? inherited, t.shape ?? shapeInherited, level + 1);
    };
    const branchTop = (t: Topic): Topic => {
      let cur = t;
      for (;;) {
        const parent = cur.parent_id ? this.state.topics.get(cur.parent_id) : null;
        if (!parent) return cur;
        const grand = parent.parent_id ? this.state.topics.get(parent.parent_id) : null;
        if (grand && grand.parent_id === null && !grand.floating) return cur;
        cur = parent;
      }
    };
    if (root) walk(root, 'accent', null, 0);
    const floaters = [...this.state.topics.values()].filter((t) => t.floating);
    floaters.forEach((f, i) => walk(f, branchColours[i % 8], null, 0));
  }

  // ---- live connection --------------------------------------------------

  connect(): void {
    if (this.state.offline) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/api/maps/${this.state.map.id}/live?since=${this.seq}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.bannerText();
      void this.flushQueue();
    };
    ws.onmessage = (ev) => {
      this.handleMessage(JSON.parse(String(ev.data)));
    };
    ws.onclose = () => {
      this.ws = null;
      this.bannerText();
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows
    };
  }

  private scheduleReconnect(): void {
    if (this.state.offline) return;
    const backoff = [1, 2, 4, 8, 30];
    const delay = backoff[Math.min(this.reconnectAttempt, backoff.length - 1)] * 1000;
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private async handleMessage(msg: Record<string, unknown>): Promise<void> {
    const type = String(msg.type ?? '');
    if (typeof msg.seq === 'number') this.seq = msg.seq;
    switch (type) {
      case 'op': {
        const ops = msg.ops as Operation[];
        const author = String(msg.author ?? '');
        if (author !== this.state.me) {
          this.applyLocally(ops);
          this.state.revision = Number(msg.revision ?? this.state.revision);
          if (msg.sentence) this.announce(String(msg.sentence));
          this.emit();
        } else {
          this.state.revision = Number(msg.revision ?? this.state.revision);
        }
        break;
      }
      case 'presence': {
        this.state.people = msg.people as PersonInfo[];
        this.emit();
        break;
      }
      case 'cursor': {
        this.emit();
        break;
      }
      case 'notice': {
        if (msg.notice) this.announce(String(msg.notice));
        break;
      }
      case 'comment': {
        this.emit();
        break;
      }
      case 'vote': {
        const t = this.state.topics.get(String(msg.topic_id));
        if (t) { t.vote_count = Number(msg.vote_count ?? t.vote_count); this.emit(); }
        break;
      }
      case 'role': {
        const username = String(msg.username ?? '');
        if (this.state.me === username) {
          this.state.myRole = msg.role as Role;
          this.announce(`Your role is now ${msg.role}.`);
        }
        break;
      }
      case 'access_removed': {
        const username = String(msg.username ?? '');
        if (this.state.me === username) {
          location.href = '/removed';
        }
        break;
      }
      case 'session_expired': {
        this.announce('Your session ended. Sign in again to keep your changes.');
        window.dispatchEvent(new CustomEvent('sprig-session-expired'));
        break;
      }
      case 'link_expired': {
        window.dispatchEvent(new CustomEvent('sprig-link-expired', { detail: msg.reason }));
        break;
      }
      case 'version': case 'export': case 'presentation': case 'derived': {
        window.dispatchEvent(new CustomEvent(`sprig-${type}`, { detail: msg }));
        break;
      }
      default: break;
    }
  }

  async flushQueue(): Promise<void> {
    if (this.state.queue.length === 0) { this.bannerText(); return; }
    let sent = 0;
    let conflicts = 0;
    const queue = [...this.state.queue];
    for (const group of queue) {
      const out = await api<GroupResponse>(`/api/maps/${this.state.map.id}/ops`, 'POST', {
        group_id: group.groupId, base_revision: group.baseRevision, ops: group.ops,
      });
      if (out.ok) {
        const status = (out.body as GroupResponse).status;
        sent += 1;
        if (status === 'merged' || status === 'rejected' || status === 'recovered') conflicts += 1;
        this.state.queue = this.state.queue.filter((q) => q.groupId !== group.groupId);
      } else {
        const err = errorOf(out);
        if (err.code === 'stale_base' || err.code === 'op_id_reused') {
          this.state.queue = this.state.queue.filter((q) => q.groupId !== group.groupId);
          conflicts += 1;
        } else {
          break;
        }
      }
    }
    this.saveQueue();
    this.announce(`Back online: ${sent} ${sent === 1 ? 'change' : 'changes'} sent, ${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'}.`);
    // refresh the server view after replay
    const fresh = await api<MapPayload>(`/api/maps/${this.state.map.id}`);
    if (fresh.ok) this.replaceWith(fresh.body as MapPayload);
  }

  setOffline(off: boolean): void {
    this.state.offline = off;
    if (off) {
      this.ws?.close();
      this.ws = null;
    } else {
      this.connect();
    }
    this.bannerText();
    this.emit();
  }

  replaceWith(payload: MapPayload): void {
    this.state.map = payload.map;
    this.state.topics = new Map(payload.topics.map((t) => [t.id, t]));
    this.state.links = payload.links;
    this.state.boundaries = payload.boundaries;
    this.state.slides = payload.slides;
    this.state.recovered = payload.recovered;
    this.state.collapsed = new Set(payload.collapsed);
    this.state.revision = payload.map.revision;
    this.state.serverTime = payload.server_time;
    this.state.serverDate = payload.server_date;
    this.emit();
  }

  async undo(): Promise<void> {
    if (this.state.offline) {
      this.state.queue.pop();
      this.saveQueue();
      this.announce('Undone.');
      await this.refreshLocal();
      return;
    }
    const out = await api<{ status: string; notice: string; focus_topic_id: string | null }>(`/api/maps/${this.state.map.id}/undo`, 'POST');
    this.announce((out.body as { notice?: string })?.notice ?? 'Nothing to undo.');
    if (out.ok) {
      const fresh = await api<MapPayload>(`/api/maps/${this.state.map.id}`);
      if (fresh.ok) this.replaceWith(fresh.body as MapPayload);
    }
  }

  async redo(): Promise<void> {
    const out = await api<{ notice: string }>(`/api/maps/${this.state.map.id}/redo`, 'POST');
    this.announce((out.body as { notice?: string })?.notice ?? 'Nothing to redo.');
    if (out.ok) {
      const fresh = await api<MapPayload>(`/api/maps/${this.state.map.id}`);
      if (fresh.ok) this.replaceWith(fresh.body as MapPayload);
    }
  }

  async refreshLocal(): Promise<void> {
    const fresh = await api<MapPayload>(`/api/maps/${this.state.map.id}`);
    if (fresh.ok) this.replaceWith(fresh.body as MapPayload);
  }

  sendCursor(x: number, y: number, topicId: string | null, view: { zoom: number; pan_x: number; pan_y: number; width: number; height: number }): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type: 'cursor', x, y, topic_id: topicId, view }));
  }

  destroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

export function makeStatusRegion(): HTMLElement {
  return el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-label': 'Map announcements' });
}
