import type {
  CommitResponse,
  CorrectionDto,
  EventDto,
  IndexTableDto,
  OperatorClubRow,
  ProtestDto,
  PublicationDto,
  RegistrationDto,
  RotaHeat,
  RunDto,
  RunGridEntry,
  SeasonResponse,
  SessionUser,
  StandingsResponse,
  StandingsView,
} from '../shared/api';

export interface StationClaimResponse {
  station: { id: string; name: string; heat: number; assignmentEmail: 'sent' | 'pending' };
  registration: RegistrationDto;
}

export class RequestFailed extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string>) {
    super(message);
    this.name = 'RequestFailed';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload: unknown = text.length > 0 ? JSON.parse(text) : {};
  if (!response.ok) {
    const shape = payload as { error?: string; message?: string; fields?: Record<string, string> };
    throw new RequestFailed(
      response.status,
      shape.error ?? 'request_failed',
      shape.message ?? 'Request failed.',
      shape.fields ?? {},
    );
  }
  return payload as T;
}

export const api = {
  session: {
    current: (): Promise<{ user: SessionUser }> => request('GET', '/api/session'),
    signIn: (email: string, password: string): Promise<{ user: SessionUser }> =>
      request('POST', '/api/session', { email, password }),
    signOut: (): Promise<void> => request('DELETE', '/api/session'),
    signUp: (
      clubSlug: string,
      input: { name: string; email: string; password: string },
    ): Promise<{ user: SessionUser }> =>
      request('POST', `/api/clubs/${encodeURIComponent(clubSlug)}/signup`, input),
  },
  operator: {
    clubs: (): Promise<{ clubs: OperatorClubRow[] }> => request('GET', '/api/operator/clubs'),
    onboard: (input: {
      slug: string;
      name: string;
      timeZone: string;
      chair: { name: string; email: string; password: string };
    }): Promise<{ club: { slug: string; name: string }; chair: { user: SessionUser } }> =>
      request('POST', '/api/operator/clubs', input),
  },
  indexTables: {
    list: (): Promise<{ tables: IndexTableDto[] }> => request('GET', '/api/index-tables'),
    load: (input: {
      effectiveDate: string;
      factors: Record<string, string>;
    }): Promise<{ table: IndexTableDto }> => request('POST', '/api/index-tables', input),
  },
  events: {
    list: (): Promise<{ events: EventDto[] }> => request('GET', '/api/events'),
    get: (id: string): Promise<{ event: EventDto }> => request('GET', `/api/events/${id}`),
    create: (input: Record<string, unknown>): Promise<{ event: EventDto }> =>
      request('POST', '/api/events', input),
    update: (id: string, input: Record<string, unknown>): Promise<{ event: EventDto }> =>
      request('PATCH', `/api/events/${id}`, input),
    transition: (id: string, to: string): Promise<{ event: EventDto }> =>
      request('POST', `/api/events/${id}/transition`, { to }),
    runningHeat: (id: string, heat: number): Promise<{ event: EventDto }> =>
      request('POST', `/api/events/${id}/running-heat`, { heat }),
    registrations: (id: string): Promise<{ registrations: RegistrationDto[] }> =>
      request('GET', `/api/events/${id}/registrations`),
    register: (
      id: string,
      input: { classCode: string; carNumber: number; carDescription: string },
    ): Promise<{ registration: RegistrationDto }> =>
      request('POST', `/api/events/${id}/registrations`, input),
    rota: (id: string): Promise<{ heats: RotaHeat[] }> => request('GET', `/api/events/${id}/rota`),
    runs: (id: string, heat: number): Promise<{ entries: RunGridEntry[] }> =>
      request('GET', `/api/events/${id}/runs?heat=${heat}`),
    standings: (
      id: string,
      view: StandingsView,
      classCode: string | null,
    ): Promise<StandingsResponse> =>
      request(
        'GET',
        `/api/events/${id}/standings?view=${view}${
          classCode ? `&class=${encodeURIComponent(classCode)}` : ''
        }`,
      ),
    corrections: (id: string): Promise<{ corrections: CorrectionDto[] }> =>
      request('GET', `/api/events/${id}/corrections`),
    protests: (id: string): Promise<{ protests: ProtestDto[] }> =>
      request('GET', `/api/events/${id}/protests`),
    fileProtest: (
      id: string,
      input: { registrationId: string; text: string },
    ): Promise<{ protest: ProtestDto }> => request('POST', `/api/events/${id}/protests`, input),
    publication: (id: string): Promise<PublicationDto> =>
      request('GET', `/api/events/${id}/publication`),
    publish: (id: string): Promise<{ event: EventDto; publication: PublicationDto }> =>
      request('POST', `/api/events/${id}/publish`, {}),
  },
  registrations: {
    withdraw: (id: string): Promise<void> => request('DELETE', `/api/registrations/${id}`),
    checkIn: (id: string, signature: string): Promise<{ registration: RegistrationDto }> =>
      request('POST', `/api/registrations/${id}/check-in`, { signature }),
    commitRun: (
      id: string,
      runNumber: number,
      input:
        | { outcome: 'time'; rawTime: string; cones: number }
        | { outcome: 'dnf' }
        | { outcome: 'rerun' },
    ): Promise<CommitResponse> =>
      request('POST', `/api/registrations/${id}/runs/${runNumber}`, input),
  },
  runs: {
    correct: (
      id: string,
      input:
        | { outcome: 'time'; rawTime: string; cones: number; reason: string }
        | { outcome: 'dnf'; cones: number; reason: string },
    ): Promise<{
      run: RunDto;
      correction: CorrectionDto;
      entry: CommitResponse['entry'];
      rankChange: CommitResponse['rankChange'];
    }> => request('POST', `/api/runs/${id}/corrections`, input),
  },
  stations: {
    claim: (id: string): Promise<StationClaimResponse> =>
      request('POST', `/api/stations/${id}/claim`, {}),
    assign: (id: string, registrationId: string): Promise<StationClaimResponse> =>
      request('POST', `/api/stations/${id}/assign`, { registrationId }),
    release: (id: string): Promise<void> => request('DELETE', `/api/stations/${id}/claim`),
  },
  protests: {
    decide: (
      id: string,
      input: { decision: 'upheld' | 'denied'; note: string },
    ): Promise<{ protest: ProtestDto }> => request('POST', `/api/protests/${id}/decision`, input),
  },
  season: {
    standings: (year?: number): Promise<SeasonResponse> =>
      request('GET', year === undefined ? '/api/season' : `/api/season?year=${year}`),
  },
};
