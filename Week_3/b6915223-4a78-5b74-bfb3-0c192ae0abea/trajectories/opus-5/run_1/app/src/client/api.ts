import type {
  ApiErrorBody,
  Club,
  CurrentGameweek,
  DraftView,
  HistoryView,
  LeagueCreated,
  LeagueSummary,
  LeagueView,
  LedgerView,
  MatchEvent,
  Me,
  NoticesView,
  PlayerRow,
  PriceRunResult,
  SquadView,
  TransferHistoryRow,
  TransferPreview,
  TransfersResult,
} from '../shared/types.ts';

export class RequestFailed extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

const send = async <T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> => {
  const response = await fetch(path, {
    method,
    headers:
      body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    throw new RequestFailed(response.status, parsed as ApiErrorBody);
  }
  return parsed as T;
};

export const api = {
  signUp: (email: string, password: string, teamName: string) =>
    send<Me>('POST', '/api/auth/signup', { email, password, team_name: teamName }),
  signIn: (email: string, password: string) =>
    send<Me>('POST', '/api/auth/signin', { email, password }),
  signOut: () => send<void>('POST', '/api/auth/signout'),
  me: () => send<Me>('GET', '/api/me'),

  clubs: () => send<{ clubs: Club[] }>('GET', '/api/clubs'),
  players: (search: string) => send<{ players: PlayerRow[] }>('GET', `/api/players${search}`),
  currentGameweek: () => send<CurrentGameweek>('GET', '/api/gameweeks/current'),

  squad: () => send<SquadView>('GET', '/api/squad'),
  createSquad: (players: string[]) => send<SquadView>('POST', '/api/squad', { players }),
  savePicks: (payload: {
    gameweek: number;
    starting: string[];
    bench: string[];
    captain: string;
    vice_captain: string;
  }) => send<SquadView>('PUT', '/api/picks', payload),
  playChip: (gameweek: number, chip: string) =>
    send<SquadView>('POST', '/api/chips', { gameweek, chip }),
  cancelChip: (gameweek: number) => send<SquadView>('DELETE', `/api/chips/${gameweek}`),

  preview: (gameweek: number, out: string[], incoming: string[]) =>
    send<TransferPreview>('POST', '/api/transfers/preview', { gameweek, out, in: incoming }),
  draft: () => send<DraftView>('GET', '/api/transfers/draft'),
  saveDraft: (gameweek: number, out: string[], incoming: string[]) =>
    send<DraftView>('PUT', '/api/transfers/draft', { gameweek, out, in: incoming }),
  clearDraft: () => send<DraftView>('DELETE', '/api/transfers/draft'),
  confirmTransfers: (
    gameweek: number,
    out: string[],
    incoming: string[],
    hitPoints: number,
    key: string,
  ) =>
    send<TransfersResult>(
      'POST',
      '/api/transfers',
      { gameweek, out, in: incoming, hit_points: hitPoints },
      { 'Idempotency-Key': key },
    ),

  history: () => send<HistoryView>('GET', '/api/history'),
  transferHistory: () =>
    send<{ transfers: TransferHistoryRow[] }>('GET', '/api/history/transfers'),
  ledger: () => send<LedgerView>('GET', '/api/history/ledger'),

  leagues: () => send<{ leagues: LeagueSummary[] }>('GET', '/api/leagues'),
  createLeague: (name: string) => send<LeagueCreated>('POST', '/api/leagues', { name }),
  joinLeague: (code: string) => send<LeagueCreated>('POST', '/api/leagues/join', { code }),
  league: (id: string) => send<LeagueView>('GET', `/api/leagues/${id}`),
  newJoinCode: (id: string) => send<{ code: string }>('POST', `/api/leagues/${id}/code`),
  memberHistory: (leagueId: string, managerId: string) =>
    send<HistoryView>('GET', `/api/leagues/${leagueId}/members/${managerId}/history`),

  notices: () => send<NoticesView>('GET', '/api/notices'),
  readAllNotices: () => send<void>('POST', '/api/notices/read-all'),

  publishFixtures: (
    gameweek: number,
    fixtures: { home: string; away: string; kickoff: string }[],
  ) => send<CurrentGameweek>('PUT', `/api/operator/gameweeks/${gameweek}/fixtures`, { fixtures }),
  startGameweek: (gameweek: number) =>
    send<{ number: number; status: string }>(
      'POST',
      `/api/operator/gameweeks/${gameweek}/start`,
    ),
  closeGameweek: (gameweek: number) =>
    send<{ number: number; status: string; next_gameweek: number | null }>(
      'POST',
      `/api/operator/gameweeks/${gameweek}/close`,
    ),
  recordEvent: (payload: {
    event_id: string;
    fixture_id: string;
    player_id: string;
    type: string;
    value?: number;
  }) => send<MatchEvent>('POST', '/api/operator/events', payload),
  voidEvent: (eventId: string) =>
    send<MatchEvent>('POST', `/api/operator/events/${eventId}/void`),
  events: (gameweek: number) =>
    send<{ events: MatchEvent[] }>('GET', `/api/operator/gameweeks/${gameweek}/events`),
  priceRun: (runDate: string, moves: { player_id: string; delta_tenths: number }[]) =>
    send<PriceRunResult>('POST', '/api/operator/price-runs', { run_date: runDate, moves }),
};
