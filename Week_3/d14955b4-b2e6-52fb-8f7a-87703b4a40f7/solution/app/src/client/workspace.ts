import type { ForensicsBody, InboxBody, InboxRow, LookupBody, ThreadBody, ThreadStatus } from '../shared/types.js';
import { announce, resolvePending } from './announce.js';
import { ApiError, api, request } from './api.js';
import { inboxUrl, navigate } from './router.js';
import type { InboxRoute } from './router.js';
import { readEvents } from './sse.js';

const PAGE_SIZE = 25;
const MAX_WINDOW = 100;
const RECONNECT_MS = 1000;

const COPY = {
  outage: "The game server isn't answering receipt lookups right now. Signed receipts in this thread are still checked.",
  noReceipts: 'The game server lists no receipts for this player.',
  lost: 'That thread is no longer available.',
} as const;

interface LookupState {
  threadId: string;
  phase: 'pending' | 'done' | 'failed' | 'forbidden';
  data: LookupBody | null;
}

export interface WorkspaceState {
  route: InboxRoute;
  rows: InboxRow[];
  counts: Record<ThreadStatus, number>;
  nextCursor: string | null;
  listReady: boolean;
  thread: ThreadBody | null;
  threadId: string | null;
  selectedMessageId: string | null;
  lookup: LookupState | null;
  focusHeadingFor: string | null;
  focusRowId: string | null;
}

interface Job {
  rules: boolean;
  threads: Set<string>;
  arrivals: Set<string>;
  refusals: Set<string>;
  full: boolean;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
    setTimeout(resolve, 100);
  });

export class Workspace {
  state: WorkspaceState = {
    route: { status: 'waiting', q: '', threadId: null },
    rows: [],
    counts: { waiting: 0, answered: 0, closed: 0 },
    nextCursor: null,
    listReady: false,
    thread: null,
    threadId: null,
    selectedMessageId: null,
    lookup: null,
    focusHeadingFor: null,
    focusRowId: null,
  };

  private listeners = new Set<() => void>();
  private started = false;
  private listSeq = 0;
  private loadingList = 0;
  private missedWhileLoading = false;
  private threadSeq = 0;
  private lookupSeq = 0;
  private pending: Job | null = null;
  private draining = false;
  private stream: AbortController | null = null;
  private disposed = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = (): WorkspaceState => this.state;

  private set(patch: Partial<WorkspaceState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    this.disposed = true;
    this.stream?.abort();
  }

  applyRoute(route: InboxRoute): void {
    const previous = this.state.route;
    const first = !this.started;
    this.started = true;
    const listChanged = first || previous.status !== route.status || previous.q !== route.q;
    this.set({ route, ...(first || previous.status !== route.status ? { rows: [], nextCursor: null, listReady: false } : {}) });
    if (listChanged) void this.loadList();
    if (first || previous.threadId !== route.threadId) void this.openThread(route.threadId);
  }

  private inboxPath(limit: number, cursor?: string): string {
    const { status, q } = this.state.route;
    const params = new URLSearchParams({ status, limit: String(limit) });
    if (q !== '') params.set('q', q);
    if (cursor) params.set('cursor', cursor);
    return `/api/inbox?${params.toString()}`;
  }

  private async loadList(): Promise<void> {
    const seq = (this.listSeq += 1);
    this.loadingList += 1;
    try {
      const body = await api<InboxBody>(this.inboxPath(PAGE_SIZE));
      if (seq !== this.listSeq) return;
      this.set({ rows: body.threads, counts: body.counts, nextCursor: body.next_cursor, listReady: true });
    } catch {
      if (seq === this.listSeq) this.set({ listReady: true });
    } finally {
      this.loadingList -= 1;
      if (this.loadingList === 0 && this.missedWhileLoading) {
        this.missedWhileLoading = false;
        this.schedule({});
      }
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this.state.nextCursor;
    if (!cursor) return;
    announce('Inbox announcements', 'Loading more threads...');
    const seq = this.listSeq;
    try {
      const body = await api<InboxBody>(this.inboxPath(PAGE_SIZE, cursor));
      if (seq !== this.listSeq) return;
      const known = new Set(this.state.rows.map((row) => row.id));
      const added = body.threads.filter((row) => !known.has(row.id));
      const rows = [...this.state.rows, ...added];
      this.set({ rows, counts: body.counts, nextCursor: body.next_cursor, focusRowId: added[0]?.id ?? null });
      announce('Inbox announcements', `Showing ${rows.length} threads.`);
    } catch {
      announce('Inbox announcements', "More threads didn't load. Try again.");
    }
  }

  private async mergeList(): Promise<void> {
    if (!this.state.listReady || this.loadingList > 0) return;
    const seq = this.listSeq;
    const { rows: before, nextCursor, route } = this.state;
    const limit = Math.min(MAX_WINDOW, Math.max(PAGE_SIZE, before.length) + (nextCursor === null ? 10 : 0));
    const body = await api<InboxBody>(this.inboxPath(limit));
    if (seq !== this.listSeq || route.status !== this.state.route.status || route.q !== this.state.route.q) return;
    const served = new Set(body.threads.map((row) => row.id));
    const kept = new Map<string, InboxRow>();
    await Promise.all(
      before
        .filter((row) => !served.has(row.id))
        .map(async (row) => {
          try {
            const thread = await api<ThreadBody>(`/api/threads/${row.id}`);
            if (thread.status !== route.status) kept.set(row.id, { ...row, status: thread.status });
          } catch {
            return;
          }
        }),
    );
    const merged = [...body.threads];
    let anchor = -1;
    for (const row of before) {
      if (served.has(row.id)) anchor = merged.findIndex((candidate) => candidate.id === row.id);
      else if (kept.has(row.id)) {
        merged.splice(anchor + 1, 0, kept.get(row.id) as InboxRow);
        anchor += 1;
      }
    }
    this.set({ rows: merged, counts: body.counts, nextCursor: body.next_cursor, listReady: true });
  }

  async openThread(threadId: string | null): Promise<void> {
    const seq = (this.threadSeq += 1);
    this.lookupSeq += 1;
    if (threadId === null) {
      this.set({ threadId: null, thread: null, selectedMessageId: null, lookup: null });
      return;
    }
    this.set({ threadId, thread: null, selectedMessageId: null, lookup: null });
    announce('Inbox announcements', 'Opening thread...');
    try {
      const thread = await api<ThreadBody>(`/api/threads/${threadId}`);
      if (seq !== this.threadSeq) return;
      this.set({ thread });
      resolvePending('Inbox announcements', 'Opening thread...');
      void this.lookup(threadId);
    } catch (error) {
      if (seq === this.threadSeq && error instanceof ApiError && error.status === 404) this.lostThread();
    }
  }

  private lostThread(): void {
    announce('Inbox announcements', COPY.lost);
    const { route } = this.state;
    navigate(inboxUrl({ ...route, threadId: null }), { replace: true });
  }

  async lookup(threadId: string): Promise<void> {
    const seq = (this.lookupSeq += 1);
    this.set({ lookup: { threadId, phase: 'pending', data: null } });
    announce('Game server', 'Asking the game server...');
    const current = (): boolean => seq === this.lookupSeq && this.state.threadId === threadId;
    try {
      const data = await api<LookupBody>(`/api/threads/${threadId}/receipt-lookup`);
      if (!current()) return;
      this.set({ lookup: { threadId, phase: 'done', data } });
      announce('Game server', !data.available ? COPY.outage : data.receipts.length === 0 ? COPY.noReceipts : '');
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && error.status === 403) {
        this.set({ lookup: { threadId, phase: 'forbidden', data: null } });
        announce('Game server', '');
      } else if (error instanceof ApiError && error.status === 404) this.lostThread();
      else {
        this.set({ lookup: { threadId, phase: 'failed', data: null } });
        announce('Game server', COPY.outage);
      }
    }
  }

  private async refreshThread(): Promise<void> {
    const { threadId } = this.state;
    if (threadId === null) return;
    const seq = this.threadSeq;
    try {
      const thread = await api<ThreadBody>(`/api/threads/${threadId}`);
      if (seq !== this.threadSeq) return;
      const selected = thread.messages.some((message) => message.id === this.state.selectedMessageId) ? this.state.selectedMessageId : null;
      this.set({ thread, selectedMessageId: selected });
    } catch (error) {
      if (seq === this.threadSeq && error instanceof ApiError && error.status === 404) this.lostThread();
    }
  }

  async refreshAfterOwnAction(): Promise<void> {
    await Promise.all([this.mergeList().catch(() => undefined), this.refreshThread()]);
  }

  selectMessage(messageId: string | null): void {
    if (this.state.selectedMessageId !== messageId) this.set({ selectedMessageId: messageId });
  }

  requestHeadingFocus(threadId: string | null): void {
    this.set({ focusHeadingFor: threadId });
  }

  clearFocusRequests(): void {
    if (this.state.focusHeadingFor !== null || this.state.focusRowId !== null) this.set({ focusHeadingFor: null, focusRowId: null });
  }

  openThreadFromList(threadId: string, options: { focusHeading: boolean }): void {
    if (options.focusHeading) this.requestHeadingFocus(threadId);
    navigate(inboxUrl({ ...this.state.route, threadId }));
  }

  step(direction: 1 | -1): void {
    const { rows, threadId, route } = this.state;
    const index = rows.findIndex((row) => row.id === threadId);
    const target = rows[index === -1 ? (direction === 1 ? 0 : -1) : index + direction];
    if (target && target.id !== route.threadId) this.openThreadFromList(target.id, { focusHeading: true });
  }

  async sendReply(input: { text: string; key: string; playerName: string }): Promise<'sent' | 'closed' | 'failed'> {
    const { threadId } = this.state;
    if (threadId === null) return 'failed';
    announce('Inbox announcements', 'Sending reply...');
    await nextFrame();
    try {
      await api(`/api/threads/${threadId}/replies`, { method: 'POST', body: { body: input.text }, key: input.key });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'thread_closed') {
        announce('Inbox announcements', error.message);
        void this.refreshAfterOwnAction();
        return 'closed';
      }
      if (!(error instanceof ApiError && error.code === 'idempotency_in_progress')) {
        announce('Inbox announcements', 'Reply not sent. Try again.');
        return 'failed';
      }
    }
    announce('Inbox announcements', `Reply sent to ${input.playerName}.`);
    void this.refreshAfterOwnAction();
    return 'sent';
  }

  async closeThread(): Promise<void> {
    const { threadId, rows, route } = this.state;
    if (threadId === null) return;
    announce('Inbox announcements', 'Closing thread...');
    try {
      await api(`/api/threads/${threadId}/close`, { method: 'POST', body: {} });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'not_answered') announce('Inbox announcements', 'Answer the player before closing.');
      else if (error instanceof ApiError && error.code === 'already_closed') {
        announce('Inbox announcements', 'This thread is already closed.');
        void this.refreshAfterOwnAction();
      } else announce('Inbox announcements', 'Thread not closed. Try again.');
      return;
    }
    announce('Inbox announcements', 'Thread closed.');
    const index = rows.findIndex((row) => row.id === threadId);
    const next = rows[index + 1] ?? rows[index - 1];
    if (next && index !== -1) this.openThreadFromList(next.id, { focusHeading: true });
    else {
      this.set({ focusRowId: rows[0]?.id ?? null });
      navigate(inboxUrl({ ...route, threadId: null }));
    }
    void this.mergeList().catch(() => undefined);
  }

  start(): void {
    void this.runStream();
  }

  private async runStream(): Promise<void> {
    while (!this.disposed) {
      const abort = (this.stream = new AbortController());
      try {
        const response = await request('/api/stream', { signal: abort.signal, headers: { Accept: 'text/event-stream' } });
        if (!response.ok) return;
        this.schedule({ full: true });
        await readEvents(response, (event) => this.onFrame(event.name, event.data));
      } catch (error) {
        if (this.disposed || (error instanceof ApiError && error.status === 401)) return;
      }
      if (this.disposed) return;
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
    }
  }

  private onFrame(name: string, data: string): void {
    if (name === 'rules') return this.schedule({ full: true, rules: true });
    const frame = JSON.parse(data) as { thread_id: string; reason: string };
    this.schedule({
      threads: [frame.thread_id],
      arrivals: frame.reason === 'message' ? [frame.thread_id] : [],
      refusals: frame.reason === 'refused' ? [frame.thread_id] : [],
    });
  }

  private schedule(input: { full?: boolean; rules?: boolean; threads?: string[]; arrivals?: string[]; refusals?: string[] }): void {
    const job = (this.pending ??= { rules: false, threads: new Set(), arrivals: new Set(), refusals: new Set(), full: false });
    for (const id of input.threads ?? []) job.threads.add(id);
    for (const id of input.arrivals ?? []) job.arrivals.add(id);
    for (const id of input.refusals ?? []) job.refusals.add(id);
    job.full ||= input.full ?? false;
    job.rules ||= input.rules ?? false;
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending && !this.disposed) {
        const job = this.pending;
        this.pending = null;
        await this.process(job).catch(() => undefined);
      }
    } finally {
      this.draining = false;
    }
  }

  private async process(job: Job): Promise<void> {
    if (this.loadingList > 0) this.missedWhileLoading = true;
    const known = new Map(this.state.rows.map((row) => [row.id, row.status]));
    if (this.state.thread) known.set(this.state.thread.id, this.state.thread.status);
    await this.mergeList();
    const { threadId } = this.state;
    if (threadId !== null && (job.full || job.threads.has(threadId))) {
      await this.refreshThread();
      if (job.rules) void this.lookup(threadId);
    }
    for (const id of job.arrivals) await this.announceArrival(id, known.get(id));
    for (const id of job.refusals) await this.announceRefusal(id);
  }

  private async announceArrival(threadId: string, before: ThreadStatus | undefined): Promise<void> {
    if (before === 'waiting') return;
    const row = this.state.rows.find((candidate) => candidate.id === threadId);
    if (row) {
      if (row.status === 'waiting') announce('Inbox announcements', `${row.player.name} is waiting.`);
      return;
    }
    const thread = await api<ThreadBody>(`/api/threads/${threadId}`).catch(() => null);
    if (thread?.status === 'waiting') announce('Inbox announcements', `${thread.player.name} is waiting.`);
  }

  private async announceRefusal(threadId: string): Promise<void> {
    const thread = this.state.thread?.id === threadId ? this.state.thread : await api<ThreadBody>(`/api/threads/${threadId}`).catch(() => null);
    const refused = thread?.messages.filter((message) => message.event?.verdict === 'refused').at(-1);
    if (!thread || !refused) return;
    const forensics = await api<ForensicsBody>(`/api/messages/${refused.id}/forensics`);
    const verdict = forensics.lines.find((line) => line.stage === 'signature')?.verdict ?? '';
    announce('Inbox announcements', `Refused a game-server event for ${thread.player.name}: ${verdict.replace('signature refused: ', '')}.`);
  }
}
