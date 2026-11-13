import type {
  ConfigJson,
  GameJson,
  HistoryEntry,
  Op,
  PlayerSettings,
  PuzzleJson,
  PuzzleTile,
  WriteMessage,
} from '../shared/types';

export interface ErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  lines?: string[];
}

export class ApiFailure extends Error {
  readonly status: number;

  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let failure: ErrorBody = { error: 'not_found', message: 'Something went wrong.' };
    try {
      failure = (await response.json()) as ErrorBody;
    } catch {
      /* the body was not JSON */
    }
    throw new ApiFailure(response.status, failure);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  config: (): Promise<ConfigJson> => request('GET', '/api/config'),
  me: (): Promise<{ id: string; display_name: string }> => request('GET', '/api/players/me'),
  createPlayer: (displayName: string): Promise<{ id: string; display_name: string }> =>
    request('POST', '/api/players', { display_name: displayName }),
  settings: (): Promise<PlayerSettings> => request('GET', '/api/players/me/settings'),
  saveSettings: (settings: PlayerSettings): Promise<PlayerSettings> =>
    request('PUT', '/api/players/me/settings', settings),
  puzzles: (search: string): Promise<{ puzzles: PuzzleTile[] }> =>
    request('GET', `/api/puzzles${search}`),
  puzzle: (id: string): Promise<PuzzleJson> => request('GET', `/api/puzzles/${id}`),
  upload: async (body: BodyInit): Promise<{ puzzle: PuzzleJson; solution: string[][] }> => {
    const response = await fetch('/api/puzzles', { method: 'POST', body });
    if (!response.ok) {
      const failure = (await response.json()) as ErrorBody;
      throw new ApiFailure(response.status, failure);
    }
    return (await response.json()) as { puzzle: PuzzleJson; solution: string[][] };
  },
  createGame: (puzzleId: string, mode: 'shared' | 'race'): Promise<GameJson> =>
    request('POST', '/api/games', { puzzle_id: puzzleId, mode }),
  game: (id: string): Promise<GameJson> => request('GET', `/api/games/${id}`),
  ops: (id: string): Promise<{ ops: Op[] }> => request('GET', `/api/games/${id}/ops`),
  write: (id: string, message: unknown): Promise<WriteMessage> =>
    request('POST', `/api/games/${id}/ops`, message),
  linkOff: (id: string): Promise<GameJson> => request('POST', `/api/games/${id}/link/off`, {}),
  linkReplace: (id: string): Promise<GameJson> =>
    request('POST', `/api/games/${id}/link/replace`, {}),
  team: (id: string, team: 1 | 2 | null): Promise<GameJson> =>
    request('POST', `/api/games/${id}/team`, { team }),
  raceStart: (id: string): Promise<GameJson> => request('POST', `/api/games/${id}/race/start`, {}),
  link: (code: string): Promise<{
    game_id: string;
    puzzle_title: string;
    status: string;
    player_count: number;
  }> => request('GET', `/api/links/${code}`),
  join: (code: string): Promise<GameJson> => request('POST', `/api/links/${code}/join`, {}),
  history: (): Promise<{ entries: HistoryEntry[] }> => request('GET', '/api/history'),
};
