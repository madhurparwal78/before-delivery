import { VoiceDocument } from '../shared/crdt.js';
import { MeterMap } from '../shared/music.js';
import type {
  Collaborator,
  ElementId,
  Hold,
  OpLogEntry,
  Operation,
  Part,
  PresenceCursor,
  PresenceEntry,
  SampleBank,
  ScoreHead,
  ServerMessage,
  Staff,
  Voice,
  VoiceEvent,
} from '../shared/types.js';
import { RequestFailed, request, seatToken } from './api.js';

const FLUSH_MS = 250;
const HEARTBEAT_MS = 5000;
const CATCHUP_MS = 5000;
const MAX_BATCH = 50;

export type Channel =
  | 'score'
  | 'voices'
  | 'holds'
  | 'presence'
  | 'parts'
  | 'banks'
  | 'collaborators'
  | 'live'
  | 'queue'
  | 'ops-received'
  | 'removed';

interface QueuedOp {
  op: Operation;
}

export interface QueueState {
  waitingSeconds: number;
  pending: number;
  offline: boolean;
}

export class ScoreState {
  head!: ScoreHead;
  meter!: MeterMap;
  me!: Collaborator;
  parts: Part[] = [];
  banks: SampleBank[] = [];
  collaborators: Collaborator[] = [];
  holds: Hold[] = [];
  presence: PresenceEntry[] = [];
  live = true;
  connectionId: string | null = null;
  lamport = 0;
  lastSeq = 0;

  private readonly voices = new Map<string, VoiceDocument>();
  private readonly listeners = new Map<Channel, Set<() => void>>();
  private readonly queue: QueuedOp[] = [];
  private socket: WebSocket | null = null;
  private flushTimer: number | null = null;
  private waitingUntil = 0;
  private offline = false;
  private sending = false;
  private cursor: PresenceCursor | null = null;
  private catchupTimer: number | null = null;
  onRefused: ((message: string) => void) | null = null;

  on(channel: Channel, listener: () => void): void {
    const set = this.listeners.get(channel) ?? new Set();
    set.add(listener);
    this.listeners.set(channel, set);
  }

  private emit(...channels: Channel[]): void {
    for (const channel of channels) {
      for (const listener of this.listeners.get(channel) ?? []) listener();
    }
  }

  async load(): Promise<void> {
    const identity = await request<{ collaborator: Collaborator; score: { id: string } }>(
      '/api/me',
    );
    this.me = identity.collaborator;
    const score = await request<{ score: ScoreHead }>(`/api/scores/${identity.score.id}`);
    this.applyScore(score.score);
    await this.reloadVoices();
    await Promise.all([this.reloadParts(), this.reloadBanks(), this.reloadCollaborators()]);
    this.openLive();
    window.setInterval(() => this.heartbeat(), HEARTBEAT_MS);
  }

  private applyScore(head: ScoreHead): void {
    this.head = head;
    this.meter = new MeterMap(head.timeSignatures);
    this.lamport = Math.max(this.lamport, head.lamport);
    this.lastSeq = Math.max(this.lastSeq, head.lastSeq);
    this.emit('score');
  }

  get scoreId(): string {
    return this.head.id;
  }

  staff(staffId: string): Staff {
    return this.head.staves.find((candidate) => candidate.id === staffId)!;
  }

  canEdit(staffId: string): boolean {
    return this.me.staffIds.includes(staffId);
  }

  voiceKey(staffId: string, voice: Voice): string {
    return `${staffId}:${voice}`;
  }

  document(staffId: string, voice: Voice): VoiceDocument {
    const key = this.voiceKey(staffId, voice);
    const held = this.voices.get(key);
    if (held) return held;
    const fresh = new VoiceDocument();
    this.voices.set(key, fresh);
    return fresh;
  }

  events(staffId: string, voice: Voice): VoiceEvent[] {
    return this.document(staffId, voice).events(this.meter);
  }

  /** Builds the local copy of every voice from the server's ordered events. */
  async reloadVoices(): Promise<void> {
    this.voices.clear();
    for (const staff of this.head.staves) {
      for (const voice of [1, 2] as Voice[]) {
        const payload = await request<{ events: VoiceEvent[] }>(
          `/api/scores/${this.scoreId}/staves/${staff.id}/voices/${voice}`,
        );
        const document = this.document(staff.id, voice);
        let previous: ElementId | null = null;
        for (const event of payload.events) {
          document.insert(
            event.id,
            previous,
            event.kind,
            event.pitch,
            event.duration,
            event.dots,
          );
          const zero: ElementId = { lamport: 0, site: '' };
          if (event.tie) document.set(event.id, 'tie', true, zero);
          if (event.dynamic !== null) document.set(event.id, 'dynamic', event.dynamic, zero);
          if (event.dynamicPlacement !== null) {
            document.set(event.id, 'dynamicPlacement', event.dynamicPlacement, zero);
          }
          if (event.text !== '') document.set(event.id, 'text', event.text, zero);
          previous = event.id;
        }
      }
    }
    this.emit('voices');
  }

  async reloadParts(): Promise<void> {
    const payload = await request<{ parts: Part[] }>(`/api/scores/${this.scoreId}/parts`);
    this.parts = payload.parts;
    this.emit('parts');
  }

  async reloadBanks(): Promise<void> {
    const payload = await request<{ banks: SampleBank[] }>(`/api/scores/${this.scoreId}/banks`);
    this.banks = payload.banks;
    this.emit('banks');
  }

  async reloadCollaborators(): Promise<void> {
    const payload = await request<{ collaborators: Collaborator[] }>(
      `/api/scores/${this.scoreId}/collaborators`,
    );
    this.collaborators = payload.collaborators;
    this.emit('collaborators');
  }

  nextStamp(): ElementId {
    this.lamport += 1;
    return { lamport: this.lamport, site: this.me.id };
  }

  /** Applies an edit at once on this screen and queues it for the server. */
  submit(ops: Operation[]): void {
    for (const op of ops) {
      this.document(op.staffId, op.voice).apply(op);
      this.queue.push({ op });
    }
    this.emit('voices', 'queue');
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_MS);
  }

  get queueState(): QueueState {
    const waiting = Math.max(0, Math.ceil((this.waitingUntil - Date.now()) / 1000));
    return { waitingSeconds: waiting, pending: this.queue.length, offline: this.offline };
  }

  private async flush(): Promise<void> {
    if (this.sending || this.queue.length === 0) return;
    if (Date.now() < this.waitingUntil) {
      this.scheduleFlush();
      return;
    }
    this.sending = true;
    const batch = this.queue.slice(0, MAX_BATCH);
    try {
      const result = await request<{ lamport: number; lastSeq: number }>(
        `/api/scores/${this.scoreId}/ops`,
        {
          method: 'POST',
          body: { ops: batch.map((item) => item.op), seen: this.lamport },
        },
      );
      this.queue.splice(0, batch.length);
      this.lamport = Math.max(this.lamport, result.lamport);
      this.lastSeq = Math.max(this.lastSeq, result.lastSeq);
      this.offline = false;
      this.waitingUntil = 0;
      this.emit('queue');
    } catch (cause) {
      if (cause instanceof RequestFailed && cause.status === 429) {
        const seconds = cause.retryAfterSeconds ?? cause.failure.retryAfterSeconds ?? 1;
        this.waitingUntil = Date.now() + seconds * 1000;
        this.countDown();
      } else if (cause instanceof RequestFailed) {
        this.queue.splice(0, batch.length);
        this.emit('queue');
        this.onRefused?.(cause.failure.message);
        await this.reloadVoices();
      } else {
        this.offline = true;
        this.waitingUntil = Date.now() + 2000;
        this.emit('queue');
      }
    } finally {
      this.sending = false;
      if (this.queue.length > 0) this.scheduleFlush();
    }
  }

  private countDown(): void {
    this.emit('queue');
    if (Date.now() >= this.waitingUntil) return;
    window.setTimeout(() => this.countDown(), 1000);
  }

  setCursor(cursor: PresenceCursor | null): void {
    this.cursor = cursor;
  }

  private heartbeat(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({ type: 'heartbeat', cursor: this.cursor, seen: this.lamport }),
      );
    }
  }

  private openLive(): void {
    const token = seatToken();
    if (token === null) return;
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(
      `${scheme}://${window.location.host}/api/scores/${this.scoreId}/live?token=${encodeURIComponent(token)}`,
    );
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      void this.receive(JSON.parse(event.data as string) as ServerMessage);
    });
    socket.addEventListener('close', () => {
      this.socket = null;
      this.connectionId = null;
      window.setTimeout(() => this.openLive(), 2000);
    });
    socket.addEventListener('open', () => this.heartbeat());
  }

  private async receive(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case 'welcome':
        this.connectionId = message.connectionId;
        this.lamport = Math.max(this.lamport, message.lamport);
        this.setLive(message.live);
        if (message.lastSeq > this.lastSeq) await this.catchUp();
        this.emit('live');
        break;
      case 'ops':
        this.integrate(message.entries);
        break;
      case 'presence':
        this.presence = message.entries;
        this.emit('presence');
        break;
      case 'holds':
        this.holds = message.holds;
        this.emit('holds');
        break;
      case 'part':
        this.parts = this.parts.map((part) => (part.id === message.part.id ? message.part : part));
        if (!this.parts.some((part) => part.id === message.part.id)) this.parts.push(message.part);
        this.emit('parts');
        break;
      case 'bank':
        this.banks = [message.bank, ...this.banks.filter((bank) => bank.id !== message.bank.id)];
        this.emit('banks');
        break;
      case 'score':
        this.applyScore(message.score);
        await this.reloadParts();
        break;
      case 'live':
        this.setLive(message.live);
        break;
      case 'removed':
        this.emit('removed');
        break;
    }
  }

  private setLive(live: boolean): void {
    if (this.live === live) return;
    this.live = live;
    this.emit('live');
    if (live) {
      if (this.catchupTimer !== null) {
        window.clearInterval(this.catchupTimer);
        this.catchupTimer = null;
      }
      void this.catchUp();
      return;
    }
    if (this.catchupTimer === null) {
      this.catchupTimer = window.setInterval(() => void this.catchUp(), CATCHUP_MS);
    }
  }

  /** Fetches operations recorded while this screen was not hearing broadcasts. */
  async catchUp(): Promise<void> {
    const payload = await request<{ ops: OpLogEntry[]; lastSeq: number; lamport: number }>(
      `/api/scores/${this.scoreId}/ops?afterSeq=${this.lastSeq}&limit=500`,
    );
    this.integrate(payload.ops);
    this.lamport = Math.max(this.lamport, payload.lamport);
  }

  private integrate(entries: OpLogEntry[]): void {
    let changed = false;
    for (const entry of entries) {
      if (entry.seq <= this.lastSeq) continue;
      this.lastSeq = Math.max(this.lastSeq, entry.seq);
      this.lamport = Math.max(this.lamport, entry.op.id.lamport);
      this.document(entry.op.staffId, entry.op.voice).apply(entry.op);
      changed = true;
    }
    if (changed) this.emit('ops-received', 'voices');
  }

  holderOf(staffId: string): Hold | undefined {
    return this.holds.find((hold) => hold.staffId === staffId);
  }
}
