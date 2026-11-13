import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type {
  EntrantView, LiveMessage, MatchView, MeBody, PublicEntrantView, ShareBody, StandingsView, TournamentView,
} from '../shared/api.js';
import { isDecided } from '../shared/rules.js';
import { api, failureOf } from './api.js';
import { orderMatches } from './bracketModel.js';
import { syncServerTime } from './clock.js';
import { setLiveConnection } from './notices.js';

export interface Snapshot {
  loaded: boolean;
  missing: string | null;
  tournament: TournamentView | null;
  entrants: Array<EntrantView | PublicEntrantView>;
  matches: MatchView[];
  standings: StandingsView | null;
  me: MeBody | null;
  announcement: string;
  paused: boolean;
}

type Source = { kind: 'user'; id: string } | { kind: 'share'; code: string };

export interface AdvanceMotion { name: string; fromMatchId: string; toMatchId: string }

const FRESH_MS = 1500;
const REPLAY_ON_OPEN = 20;
const RETRY_MS = [500, 1000, 2000];
const entrantId = (slot: MatchView['upper']): string | null => (slot !== null && 'entrant_id' in slot ? slot.entrant_id : null);

// One tournament as the browser holds it: REST snapshot plus the live channel, merged by match version.
export class TournamentStore {
  private snapshot: Snapshot = { loaded: false, missing: null, tournament: null, entrants: [], matches: [], standings: null,
    me: null, announcement: '', paused: false };
  private readonly listeners = new Set<() => void>();
  readonly onAdvance = new Set<(motion: AdvanceMotion) => void>();
  readonly onReset = new Set<(ids: string[]) => void>();
  private socket: WebSocket | null = null;
  private lastSeq: number | null = null;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private meTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly lastDecided = new Map<string, { matchId: string; at: number }>();
  private lastTournamentState = '';
  // Messages at or below this sequence were already reflected in the snapshot; they replay without animation.
  private quietUntil = 0;
  private quiet = false;

  constructor(private readonly source: Source) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  private set(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  // Load the snapshot first, then open the live channel a few messages back, so a change made while the page was
  // loading still reaches it (matches merge by version, so replaying them is harmless) and the announcement is current.
  start(): void {
    void this.load().then(() => {
      this.quietUntil = this.snapshot.tournament?.live_seq ?? 0;
      this.lastSeq = Math.max(0, (this.snapshot.tournament?.live_seq ?? 0) - REPLAY_ON_OPEN);
      this.connect();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.meTimer) clearTimeout(this.meTimer);
    this.socket?.close();
  }

  private wsUrl(id: string): string {
    const base = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
    const params = new URLSearchParams();
    if (this.source.kind === 'share') params.set('share', this.source.code);
    if (this.lastSeq !== null) params.set('after', String(this.lastSeq));
    const query = params.toString();
    return `${base}/api/tournaments/${id}/live${query ? `?${query}` : ''}`;
  }

  private connect(): void {
    const id = this.source.kind === 'user' ? this.source.id : this.snapshot.tournament?.id;
    if (!id || this.stopped) return;
    const socket = new WebSocket(this.wsUrl(id));
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.set({ paused: false });
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as LiveMessage;
      this.lastSeq = message.seq;
      this.apply(message);
    };
    socket.onclose = (event) => {
      if (this.stopped) return;
      if (event.code === 4404) {
        this.set({ missing: 'This link no longer works.', loaded: true });
        return;
      }
      this.set({ paused: true });
      const delay = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)] as number;
      this.attempt += 1;
      this.retry = setTimeout(() => {
        this.connect();
      }, delay);
    };
  }

  private applyShare(body: ShareBody): void {
    syncServerTime(body.tournament.server_time);
    this.lastTournamentState = body.tournament.state;
    this.set({ tournament: body.tournament, entrants: body.entrants, matches: orderMatches(body.matches), standings: body.standings });
  }

  async load(): Promise<void> {
    try {
      if (this.source.kind === 'share') {
        this.applyShare(await api.get<ShareBody>(`/api/share/${this.source.code}`));
      } else {
        const base = `/api/tournaments/${this.source.id}`;
        const { tournament } = await api.get<{ tournament: TournamentView }>(base);
        syncServerTime(tournament.server_time);
        this.lastTournamentState = tournament.state;
        const [entrants, matches, standings, me] = await Promise.all([
          api.get<{ entrants: EntrantView[] }>(`${base}/entrants`),
          api.get<{ matches: MatchView[] }>(`${base}/matches`),
          tournament.format === 'round_robin' || tournament.format === 'swiss' ? api.get<StandingsView>(`${base}/standings`) : null,
          tournament.my_role === 'player' ? api.get<MeBody>(`${base}/me`) : null,
        ]);
        this.set({ tournament, entrants: entrants.entrants, matches: orderMatches(matches.matches), standings, me });
      }
      this.set({ loaded: true, missing: null });
    } catch (error) {
      this.set({ loaded: true, missing: failureOf(error).message });
    }
  }

  applyEntrants(entrants: EntrantView[], seedingVersion: number): void {
    const tournament = this.snapshot.tournament;
    this.set({ entrants, tournament: tournament && { ...tournament, seeding_version: seedingVersion } });
  }

  upsertMatch(match: MatchView): void {
    this.quiet = false;
    this.mergeMatches([match]);
  }

  private mergeMatches(incoming: MatchView[]): void {
    const byId = new Map(this.snapshot.matches.map((m) => [m.id, m]));
    const before = new Map(byId);
    for (const match of incoming) {
      const known = byId.get(match.id);
      if (known && known.version >= match.version) continue;
      byId.set(match.id, match);
    }
    for (const match of incoming) this.detectAdvance(before.get(match.id), byId.get(match.id) as MatchView);
    this.set({ matches: orderMatches([...byId.values()]) });
  }

  // A winner (or loser) arriving in a new slot right after their match was decided travels from that card to this one.
  private detectAdvance(previous: MatchView | undefined, next: MatchView): void {
    if (previous === next || this.quiet) return;
    if (isDecided(next.state) && !(previous && isDecided(previous.state))) {
      for (const id of [entrantId(next.upper), entrantId(next.lower)]) {
        if (id) this.lastDecided.set(id, { matchId: next.id, at: performance.now() });
      }
    }
    for (const slot of [next.upper, next.lower]) {
      const id = entrantId(slot);
      if (!id || !slot || 'bye' in slot) continue;
      const wasThere = previous && (entrantId(previous.upper) === id || entrantId(previous.lower) === id);
      const source = this.lastDecided.get(id);
      if (!wasThere && source && source.matchId !== next.id && performance.now() - source.at < FRESH_MS) {
        this.onAdvance.forEach((listener) => listener({ name: slot.name, fromMatchId: source.matchId, toMatchId: next.id }));
      }
    }
  }

  private scheduleMe(): void {
    if (this.source.kind !== 'user' || this.snapshot.tournament?.my_role !== 'player' || this.meTimer) return;
    this.meTimer = setTimeout(() => {
      this.meTimer = null;
      void api.get<MeBody>(`/api/tournaments/${(this.source as { id: string }).id}/me`)
        .then((me) => this.set({ me })).catch(() => undefined);
    }, 50);
  }

  private apply(message: LiveMessage): void {
    syncServerTime(message.at);
    this.quiet = message.seq <= this.quietUntil;
    switch (message.type) {
      case 'match.updated':
        this.mergeMatches([message.data.match]);
        break;
      case 'matches.reset':
        this.mergeMatches(message.data.matches);
        if (!this.quiet) this.onReset.forEach((listener) => listener(message.data.matches.map((m) => m.id)));
        break;
      case 'standings.updated':
        if (this.snapshot.standings) this.set({ standings: { ...this.snapshot.standings, rows: message.data.rows } });
        break;
      case 'checkin.updated': {
        const { checked_in_count: count, entrant } = message.data;
        const entrants = this.snapshot.entrants.map((e) => (e.name === entrant.name && 'checked_in' in e ? { ...e, checked_in: entrant.checked_in } : e));
        this.set({ entrants, tournament: this.snapshot.tournament && { ...this.snapshot.tournament, checked_in_count: count } });
        break;
      }
      case 'entrants.updated':
        this.set({ entrants: message.data.entrants });
        break;
      case 'tournament.updated': {
        const current = this.snapshot.tournament;
        const next = message.data.tournament;
        this.set({ tournament: { ...next, my_role: current?.my_role ?? next.my_role } });
        if (next.state !== this.lastTournamentState) {
          this.lastTournamentState = next.state;
          void this.load();
        }
        break;
      }
      case 'announcement':
        this.set({ announcement: message.data.text });
        break;
    }
    this.scheduleMe();
  }
}

export function useTournamentStore(source: Source): { store: TournamentStore; snapshot: Snapshot } {
  const key = source.kind === 'user' ? `u:${source.id}` : `s:${source.code}`;
  const store = useMemo(() => new TournamentStore(source), [key]);
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => setLiveConnection(!snapshot.paused), [snapshot.paused]);
  return { store, snapshot };
}
