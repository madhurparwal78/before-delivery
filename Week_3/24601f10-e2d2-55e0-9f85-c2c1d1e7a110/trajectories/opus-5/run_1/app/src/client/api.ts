import type {
  ApiEntrant,
  ApiMatch,
  ApiTournament,
  ConfigResponse,
  EditPreviewResponse,
  ErrorBody,
  HistoryRow,
  PreviewMatch,
  SharePayload,
  Standings,
} from '../shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

const request = async <T>(method: string, path: string, body?: unknown, raw?: FormData): Promise<T> => {
  const response = await fetch(path, {
    method,
    headers: raw === undefined && body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    throw new ApiError(response.status, (parsed ?? { error: 'wrong_state', message: 'Something went wrong.' }) as ErrorBody);
  }
  return parsed as T;
};

export const api = {
  config: () => request<ConfigResponse>('GET', '/api/config'),
  me: () => request<{ user: { username: string } }>('GET', '/api/me'),
  signUp: (username: string, password: string) =>
    request<{ user: { username: string } }>('POST', '/api/auth/signup', { username, password }),
  signIn: (username: string, password: string) =>
    request<{ user: { username: string } }>('POST', '/api/auth/signin', { username, password }),
  signOut: () => request<void>('POST', '/api/auth/signout'),

  tournaments: () => request<{ tournaments: ApiTournament[] }>('GET', '/api/tournaments'),
  createTournament: (body: { name: string; format: string; time_zone: string; fill: string }) =>
    request<{ tournament: ApiTournament }>('POST', '/api/tournaments', body),
  tournament: (id: string) => request<{ tournament: ApiTournament }>('GET', `/api/tournaments/${id}`),
  deleteTournament: (id: string) => request<void>('DELETE', `/api/tournaments/${id}`),
  entrants: (id: string) => request<{ entrants: ApiEntrant[] }>('GET', `/api/tournaments/${id}/entrants`),
  addEntrant: (id: string, name: string, username?: string) =>
    request<{ entrant: ApiEntrant }>('POST', `/api/tournaments/${id}/entrants`, { name, username }),
  linkEntrant: (entrantId: string, username: string | null) =>
    request<{ entrant: ApiEntrant }>('PATCH', `/api/entrants/${entrantId}`, { username }),
  removeEntrant: (entrantId: string) => request<void>('DELETE', `/api/entrants/${entrantId}`),
  saveSeeding: (id: string, order: string[], seedingVersion: number) =>
    request<{ entrants: ApiEntrant[]; seeding_version: number }>('PUT', `/api/tournaments/${id}/seeding`, {
      order,
      seeding_version: seedingVersion,
    }),
  preview: (id: string) => request<{ matches: PreviewMatch[] }>('GET', `/api/tournaments/${id}/preview`),
  uploadRoster: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ entrants: ApiEntrant[]; sha256: string; file_name: string }>(
      'POST',
      `/api/tournaments/${id}/roster`,
      undefined,
      form,
    );
  },
  uploadLogo: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ logo_url: string; sha256: string }>('POST', `/api/tournaments/${id}/logo`, undefined, form);
  },
  addCoOrganizer: (id: string, username: string) =>
    request<{ co_organizers: string[] }>('POST', `/api/tournaments/${id}/co-organizers`, { username }),
  removeCoOrganizer: (id: string, username: string) =>
    request<void>('DELETE', `/api/tournaments/${id}/co-organizers/${username}`),
  openCheckin: (id: string, closesAt: string | null) =>
    request<{ tournament: ApiTournament }>('POST', `/api/tournaments/${id}/checkin/open`,
      closesAt === null ? {} : { closes_at: closesAt }),
  closeCheckin: (id: string) =>
    request<{ tournament: ApiTournament }>('POST', `/api/tournaments/${id}/checkin/close`),
  backToDraft: (id: string) => request<{ tournament: ApiTournament }>('POST', `/api/tournaments/${id}/draft`),
  checkIn: (id: string) =>
    request<{ entrant: ApiEntrant; checked_in_count: number }>('POST', `/api/tournaments/${id}/checkin`),
  setCheckedIn: (entrantId: string, checkedIn: boolean) =>
    request<{ entrant: ApiEntrant; checked_in_count: number }>('PUT', `/api/entrants/${entrantId}/checkin`, {
      checked_in: checkedIn,
    }),
  start: (id: string) =>
    request<{ tournament: ApiTournament; removed: string[] }>('POST', `/api/tournaments/${id}/start`),
  nextRound: (id: string) =>
    request<{ round: number; matches: ApiMatch[] }>('POST', `/api/tournaments/${id}/rounds`),
  matches: (id: string) => request<{ matches: ApiMatch[] }>('GET', `/api/tournaments/${id}/matches`),
  standings: (id: string) => request<Standings>('GET', `/api/tournaments/${id}/standings`),
  myEntrant: (id: string) =>
    request<{ entrant: ApiEntrant; checked_in: boolean; next_match: ApiMatch | null }>(
      'GET',
      `/api/tournaments/${id}/me`,
    ),
  disputes: (id: string) => request<{ matches: ApiMatch[] }>('GET', `/api/tournaments/${id}/disputes`),
  rotateShare: (id: string) => request<{ share_url: string }>('POST', `/api/tournaments/${id}/share/rotate`),

  call: (matchId: string, version: number) =>
    request<{ match: ApiMatch }>('POST', `/api/matches/${matchId}/call`, { version }),
  report: (matchId: string, upper: number, lower: number, version: number) =>
    request<{ match: ApiMatch; outcome: string }>('POST', `/api/matches/${matchId}/report`, {
      upper_games: upper,
      lower_games: lower,
      version,
    }),
  confirm: (matchId: string, version: number) =>
    request<{ match: ApiMatch }>('POST', `/api/matches/${matchId}/confirm`, { version }),
  dispute: (matchId: string, upper: number, lower: number, version: number) =>
    request<{ match: ApiMatch }>('POST', `/api/matches/${matchId}/dispute`, {
      upper_games: upper,
      lower_games: lower,
      version,
    }),
  result: (matchId: string, upper: number, lower: number, version: number) =>
    request<{ match: ApiMatch }>('POST', `/api/matches/${matchId}/result`, {
      upper_games: upper,
      lower_games: lower,
      version,
    }),
  resolve: (matchId: string, upper: number, lower: number, version: number) =>
    request<{ match: ApiMatch }>('POST', `/api/matches/${matchId}/resolve`, {
      upper_games: upper,
      lower_games: lower,
      version,
    }),
  editPreview: (matchId: string, upper: number, lower: number, version: number) =>
    request<EditPreviewResponse>('POST', `/api/matches/${matchId}/edit-preview`, {
      upper_games: upper,
      lower_games: lower,
      version,
    }),
  edit: (matchId: string, upper: number, lower: number, token: string) =>
    request<{ match: ApiMatch; reset: string[] }>('POST', `/api/matches/${matchId}/edit`, {
      upper_games: upper,
      lower_games: lower,
      preview_token: token,
    }),

  share: (code: string) => request<SharePayload>('GET', `/api/share/${code}`),
  history: (username: string) => request<{ rows: HistoryRow[] }>('GET', `/api/users/${username}/history`),
};
