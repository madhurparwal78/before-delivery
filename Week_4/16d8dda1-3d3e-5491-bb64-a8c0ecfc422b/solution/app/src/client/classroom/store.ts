import type { ChatMessage, HandTakenBody, LiveMessage, SessionSnapshot } from '../../shared/wire';
import { api, ApiError } from '../api';
import { navigate } from '../router';
import { lowestSeat, moveCursor, type Direction } from './cursor';
import { prefersReducedMotion } from './motion';

interface Announcement {
  id: number;
  text: string;
  at: number;
}

export interface ClassroomState {
  phase: 'loading' | 'missing' | 'failed' | 'ready';
  failure: string;
  snapshot: SessionSnapshot | null;
  event: LiveMessage['event'];
  /** performance.now() when the last message arrived; breakout time left is counted from here. */
  receivedAt: number;
  /** performance.now() until which the Bell Return walks run (0 when none). */
  returningUntil: number;
  announcements: Announcement[];
  pending: ReadonlySet<string>;
  cursor: string | null;
  chatTable: string | null;
  chatMessages: ChatMessage[];
}

const KEEP_ANNOUNCEMENTS = 20;
const SAME_TEXT_WINDOW_MS = 2000;
const WALK_MS = 640;
const WALK_STAGGER_MS = 120;
const FIRST_PAINT: ClassroomState = {
  phase: 'loading',
  failure: '',
  snapshot: null,
  event: 'snapshot',
  receivedAt: 0,
  returningUntil: 0,
  announcements: [],
  pending: new Set(),
  cursor: null,
  chatTable: null,
  chatMessages: [],
};

function isLiveMessage(value: unknown): value is LiveMessage {
  return typeof value === 'object' && value !== null && 'event' in value && typeof value.event === 'string' && 'snapshot' in value && typeof value.snapshot === 'object' && value.snapshot !== null;
}

/** The announcement a live message calls for, in the brief's exact words (null when it announces nothing). */
function announcementFor(message: LiveMessage): string | null {
  const { snapshot } = message;
  const name = message.displayName;
  switch (message.event) {
    case 'slide':
      return `Slide ${snapshot.slide.current} of ${snapshot.slide.total}.`;
    case 'hand-raised':
      return name ? `${name} raised a hand.` : null;
    case 'hand-taken':
      return name ? `${name} has the floor.` : null;
    case 'poll-closed':
      return snapshot.poll?.results ? `Poll results: ${snapshot.poll.results.map((result) => `${result.option} ${result.percent}%`).join(', ')}.` : null;
    case 'breakouts-started': {
      const table = snapshot.breakout?.tables.find((entry) => snapshot.you.learnerId !== null && entry.learnerIds.includes(snapshot.you.learnerId));
      if (table) return `Breakouts started. You are at table ${table.tableId}.`;
      return snapshot.breakout ? `Breakouts started at ${snapshot.breakout.tables.length} tables.` : null;
    }
    case 'breakout-warning':
      return snapshot.breakout ? `Breakouts end in ${snapshot.breakout.remainingSeconds} seconds.` : null;
    case 'breakout-over':
      return 'Breakouts are over. Everyone is back in their seat.';
    case 'spotlight':
      return name ? `${name} is in the spotlight.` : null;
    case 'lock':
      return snapshot.locked ? 'The class is locked.' : 'The class is unlocked.';
    case 'resumed':
      return 'Live updates are back.';
    default:
      return null;
  }
}

/** Whole seconds of the breakout left now, counted from the last message by page-clock time. */
export function breakoutSecondsLeft(state: ClassroomState, now: number): number {
  const breakout = state.snapshot?.breakout;
  if (!breakout) return 0;
  const elapsed = Math.max(0, Math.round(now - state.receivedAt));
  return Math.max(0, Math.ceil((breakout.remainingSeconds * 1000 - elapsed) / 1000));
}

function mergeMessages(first: ChatMessage[], second: ChatMessage[]): ChatMessage[] {
  const known = new Set(first.map((message) => message.messageId));
  return [...first, ...second.filter((message) => !known.has(message.messageId))];
}

/** One classroom page's live state: the snapshot from the WebSocket, announcements, pending actions, chat. */
export class ClassroomStore {
  readonly sessionId: string;
  private state: ClassroomState = FIRST_PAINT;
  private readonly listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private retry: number | undefined;
  private attempts = 0;
  private stopped = true;
  private sawFrame = false;
  private nextId = 1;
  private teacherTable: string | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get = (): ClassroomState => this.state;

  start(): void {
    this.stopped = false;
    void this.firstPaint();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.retry);
    this.socket?.close();
    this.socket = null;
  }

  private set(change: Partial<ClassroomState>): void {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }

  private async firstPaint(): Promise<void> {
    try {
      const snapshot = await api<SessionSnapshot>('GET', `/api/sessions/${this.sessionId}`);
      if (this.stopped) return;
      if (!this.sawFrame) this.receive({ event: 'snapshot', snapshot });
      this.connect();
    } catch (error) {
      if (this.stopped) return;
      if (error instanceof ApiError && error.status === 404) this.set({ phase: 'missing' });
      else if (error instanceof ApiError && error.status === 401) navigate('/join', true);
      else this.set({ phase: 'failed', failure: error instanceof Error ? error.message : 'The classroom could not be loaded.' });
    }
  }

  private connect(): void {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${window.location.host}/ws/sessions/${this.sessionId}`);
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
    };
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data !== 'string') return;
      const parsed: unknown = JSON.parse(event.data);
      if (isLiveMessage(parsed)) {
        this.sawFrame = true;
        this.receive(parsed);
      }
    };
    socket.onclose = () => {
      if (this.stopped) return;
      this.retry = window.setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.attempts));
      this.attempts += 1;
    };
  }

  private receive(message: LiveMessage): void {
    const now = performance.now();
    const { snapshot } = message;
    const previous = this.state.snapshot;
    const seatIds = snapshot.seats.map((seat) => seat.seatId);
    const own = snapshot.seats.find((seat) => seat.learnerId !== null && seat.learnerId === snapshot.you.learnerId)?.seatId;
    const cursor = this.state.cursor !== null && seatIds.includes(this.state.cursor) ? this.state.cursor : (own ?? lowestSeat(snapshot.seats));
    const walkers = previous?.breakout?.tables.length ?? 0;
    const returningUntil = message.event === 'breakout-over' && walkers > 0 && !prefersReducedMotion() ? now + (walkers - 1) * WALK_STAGGER_MS + WALK_MS : this.state.returningUntil;
    const text = announcementFor(message);
    this.set({
      phase: 'ready',
      snapshot,
      event: message.event,
      receivedAt: now,
      returningUntil,
      cursor,
      announcements: text ? this.withAnnouncement(text, now) : this.state.announcements,
    });
    this.followChat(message);
  }

  private withAnnouncement(text: string, now: number): Announcement[] {
    const list = this.state.announcements;
    const last = list.at(-1);
    if (last && last.text === text && now - last.at < SAME_TEXT_WINDOW_MS) return list;
    return [...list, { id: this.nextId++, text, at: now }].slice(-KEEP_ANNOUNCEMENTS);
  }

  private announce(text: string): void {
    this.set({ announcements: this.withAnnouncement(text, performance.now()) });
  }

  /** The table whose chat this viewer reads: a learner's own table, a teacher's chosen table, only while breakouts run. */
  private viewedTable(snapshot: SessionSnapshot): string | null {
    const breakout = snapshot.breakout;
    if (!breakout) return null;
    if (snapshot.you.role === 'learner') {
      return breakout.tables.find((table) => snapshot.you.learnerId !== null && table.learnerIds.includes(snapshot.you.learnerId))?.tableId ?? null;
    }
    const ids = breakout.tables.map((table) => table.tableId);
    return this.teacherTable !== null && ids.includes(this.teacherTable) ? this.teacherTable : (ids[0] ?? null);
  }

  private followChat(message: LiveMessage): void {
    const table = this.viewedTable(message.snapshot);
    if (table !== this.state.chatTable || message.event === 'breakouts-started') {
      this.set({ chatTable: table, chatMessages: [] });
      if (table) void this.loadChat(table);
    }
    if (message.event === 'chat' && message.message && message.tableId === table) {
      this.set({ chatMessages: mergeMessages(this.state.chatMessages, [message.message]) });
    }
  }

  private async loadChat(table: string): Promise<void> {
    try {
      const body = await api<{ messages: ChatMessage[] }>('GET', `/api/sessions/${this.sessionId}/tables/${table}/chat`);
      if (this.state.chatTable === table) this.set({ chatMessages: mergeMessages(body.messages, this.state.chatMessages) });
    } catch {
      // The table's history is only a convenience: new messages still arrive over the socket.
    }
  }

  chooseChatTable(table: string): void {
    this.teacherTable = table;
    if (table === this.state.chatTable) return;
    this.set({ chatTable: table, chatMessages: [] });
    void this.loadChat(table);
  }

  moveCursor(direction: Direction): void {
    const { snapshot, cursor } = this.state;
    if (!snapshot || cursor === null) return;
    this.set({ cursor: moveCursor(snapshot.seats, cursor, direction) });
  }

  /** Runs one live action: the pressed control stays pending until the answer; a refusal is announced. Returns whether it succeeded. */
  async run(key: string, request: () => Promise<unknown>): Promise<boolean> {
    if (this.state.pending.has(key)) return false;
    this.set({ pending: new Set(this.state.pending).add(key) });
    let succeeded = true;
    try {
      await request();
    } catch (error) {
      succeeded = false;
      this.announce(error instanceof Error ? error.message : 'That could not be done.');
    } finally {
      const pending = new Set(this.state.pending);
      pending.delete(key);
      this.set({ pending });
    }
    return succeeded;
  }

  private post(key: string, path: string, body?: unknown): Promise<boolean> {
    return this.run(key, () => api('POST', path, body));
  }

  private get snapshot(): SessionSnapshot | null {
    return this.state.snapshot;
  }

  takeSeat(seatId: string): Promise<boolean> {
    return this.post(`seat:${seatId}`, `/api/sessions/${this.sessionId}/seat`, { seatId });
  }

  toggleHand(): Promise<boolean> {
    const raised = this.snapshot?.hands.some((hand) => hand.learnerId === this.snapshot?.you.learnerId) ?? false;
    return this.post('hand', `/api/sessions/${this.sessionId}/hand`, { raised: !raised });
  }

  takeNextHand(): Promise<boolean> {
    return this.run('hands-next', () => api<HandTakenBody>('POST', `/api/sessions/${this.sessionId}/hands/next`));
  }

  answerPoll(option: number): Promise<boolean> {
    const poll = this.snapshot?.poll;
    if (!poll || poll.state !== 'open' || option < 1 || option > poll.options.length) return Promise.resolve(false);
    return this.post(`answer:${option}`, `/api/polls/${poll.pollId}/answer`, { option });
  }

  closePoll(): Promise<boolean> {
    const poll = this.snapshot?.poll;
    return poll ? this.post('poll-close', `/api/polls/${poll.pollId}/close`) : Promise.resolve(false);
  }

  /** `step` is +1 for the next slide and -1 for the previous one; beyond either end nothing is sent. */
  moveSlide(step: 1 | -1): Promise<boolean> {
    const slide = this.snapshot?.slide;
    if (!slide) return Promise.resolve(false);
    const target = slide.current + step;
    if (target < 1 || target > slide.total) return Promise.resolve(false);
    return this.post(step === 1 ? 'slide-next' : 'slide-previous', `/api/sessions/${this.sessionId}/slide`, { slide: target });
  }

  spotlight(learnerId: string | null): Promise<boolean> {
    return this.post('spotlight', `/api/sessions/${this.sessionId}/spotlight`, { learnerId });
  }

  /** S: spotlight the learner in the cursor's seat. */
  spotlightCursorSeat(): Promise<boolean> {
    const seat = this.snapshot?.seats.find((entry) => entry.seatId === this.state.cursor);
    return seat?.learnerId ? this.spotlight(seat.learnerId) : Promise.resolve(false);
  }

  setLocked(locked: boolean): Promise<boolean> {
    return this.post('lock', `/api/sessions/${this.sessionId}/lock`, { locked });
  }

  changeState(action: 'open' | 'start' | 'end'): Promise<boolean> {
    return this.post(action, `/api/sessions/${this.sessionId}/${action}`);
  }

  extendBreakouts(): Promise<boolean> {
    return this.post('extend', `/api/sessions/${this.sessionId}/breakouts/extend`);
  }

  sendChat(text: string): Promise<boolean> {
    const table = this.state.chatTable;
    return table ? this.post('chat', `/api/sessions/${this.sessionId}/tables/${table}/chat`, { text }) : Promise.resolve(false);
  }
}
