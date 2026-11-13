export interface Quizmaster {
  id: string;
  email: string;
  displayName: string;
}

export interface ImageInfo {
  status: 'attached';
  contentType: string;
  bytes: number;
  previewUrl: string;
}

export interface Question {
  id: string;
  position: number;
  version: number;
  type: 'multiple_choice' | 'estimate' | 'sequence';
  prompt: string;
  timeLimitSeconds: number;
  image: ImageInfo | null;
  options?: string[];
  correctIndex?: number;
  min?: number;
  max?: number;
  step?: number;
  answer?: number;
  tolerance?: number;
  unit?: string;
  items?: string[];
}

export interface Deck {
  id: string;
  title: string;
  version: number;
  questions: Question[];
}

export interface DeckSummary {
  id: string;
  title: string;
  version: number;
  questionCount: number;
  updatedAt: number;
}

export interface Standing {
  rank: number;
  seatId: string;
  nickname: string;
  score: number;
  streak: number;
}

export interface RevealResult {
  seatId: string;
  points: number;
  outcome: 'correct' | 'partial' | 'wrong' | 'none';
  streak: number;
}

export interface Reveal {
  questionIndex: number;
  type: 'multiple_choice' | 'estimate' | 'sequence';
  answered: number;
  seated: number;
  results: RevealResult[];
  counts?: number[];
  correctIndex?: number;
  bins?: { from: number; to: number; count: number }[];
  answer?: number;
  tolerance?: number;
  inBandBins?: number[];
  buckets?: number[];
  correctOrder?: string[];
}

export interface PlayerQuestion {
  index: number;
  type: 'multiple_choice' | 'estimate' | 'sequence';
  prompt: string;
  timeLimitMs: number;
  opensAt: number;
  deadlineAt: number;
  imageUrl: string | null;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  items?: { id: string; label: string }[];
}

export interface PlayerView {
  state: 'lobby' | 'question_open' | 'locked' | 'reveal' | 'leaderboard' | 'podium' | 'ended';
  questionCount: number;
  questionIndex: number | null;
  question: PlayerQuestion | null;
  reveal: Reveal | null;
  standings: Standing[];
  you: {
    seatId: string;
    nickname: string;
    score: number;
    streak: number;
    rank: number | null;
    answeredCurrent: boolean;
  } | null;
  lastEventId: number;
}

export interface StagePlayer {
  seatId: string;
  nickname: string;
  score: number;
  rank: number;
  connected: boolean;
}

export interface HostRoom {
  id: string;
  pin: string;
  state: 'lobby' | 'question_open' | 'locked' | 'reveal' | 'leaderboard' | 'podium' | 'ended';
  deckTitle: string;
  questionCount: number;
  questionIndex: number | null;
  question: PlayerQuestion | null;
  answered: number;
  seated: number;
  connected: number;
  players: StagePlayer[];
  reveal: Reveal | null;
  standings: Standing[];
  transport: 'live' | 'backup';
  lastEventId: number;
}

export interface JoinResponse {
  roomId: string;
  seatId: string;
  nickname: string;
  rejoinToken: string;
  clientId: string;
}

export interface RejoinResponse {
  roomId: string;
  seatId: string;
  nickname: string;
  score: number;
  streak: number;
  clientId: string;
}

export interface RoomEvent {
  id: number;
  type: string;
  data: unknown;
}

export interface NightSummary {
  roomId: string;
  deckTitle: string;
  endedAt: number;
  seated: number;
  podium: { rank: number; nickname: string; score: number }[];
}

export interface NightDetail {
  roomId: string;
  deckTitle: string;
  endedAt: number;
  standings: { rank: number; nickname: string; score: number }[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? status));
    this.status = status;
    this.body = body;
  }

  field(field: string): string | undefined {
    const fields = this.body.fields;
    if (fields && typeof fields === 'object') {
      const value = (fields as Record<string, unknown>)[field];
      if (typeof value === 'string') return value;
    }
    return undefined;
  }
}

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

export const api = {
  signup: (body: { email: string; password: string; displayName: string }) =>
    request<{ quizmaster: Quizmaster }>('/api/auth/signup', 'POST', body),
  login: (body: { email: string; password: string }) =>
    request<{ quizmaster: Quizmaster }>('/api/auth/login', 'POST', body),
  logout: () => request<void>('/api/auth/logout', 'POST'),
  me: () => request<{ quizmaster: Quizmaster }>('/api/auth/me', 'GET'),
  decks: () => request<{ decks: DeckSummary[] }>('/api/decks', 'GET'),
  createDeck: (title: string) => request<{ deck: Deck }>('/api/decks', 'POST', { title }),
  deck: (deckId: string) => request<{ deck: Deck }>(`/api/decks/${deckId}`, 'GET'),
  saveTitle: (deckId: string, title: string, version: number) =>
    request<{ deck: Deck }>(`/api/decks/${deckId}`, 'PATCH', { title, version }),
  addQuestion: (deckId: string, body: Record<string, unknown>) =>
    request<{ question: Question }>(`/api/decks/${deckId}/questions`, 'POST', body),
  saveQuestion: (deckId: string, questionId: string, body: Record<string, unknown>) =>
    request<{ question: Question }>(`/api/decks/${deckId}/questions/${questionId}`, 'PUT', body),
  deleteQuestion: (deckId: string, questionId: string) =>
    request<void>(`/api/decks/${deckId}/questions/${questionId}`, 'DELETE'),
  uploadImage: (deckId: string, questionId: string, file: File) => {
    const form = new FormData();
    form.append('image', file);
    return fetch(`/api/decks/${deckId}/questions/${questionId}/image`, { method: 'POST', body: form })
      .then(async (res) => {
        const text = await res.text();
        let parsed: Record<string, unknown> = {};
        if (text) {
          try {
            parsed = JSON.parse(text) as Record<string, unknown>;
          } catch {
            parsed = {};
          }
        }
        if (!res.ok) throw new ApiError(res.status, parsed);
        return parsed as { question: Question };
      });
  },
  removeImage: (deckId: string, questionId: string) =>
    request<void>(`/api/decks/${deckId}/questions/${questionId}/image`, 'DELETE'),
  createRoom: (deckId: string) => request<{ room: HostRoom }>('/api/rooms', 'POST', { deckId }),
  hostRoom: (roomId: string) => request<{ room: HostRoom }>(`/api/rooms/${roomId}/host`, 'GET'),
  command: (roomId: string, command: string) =>
    request<{ room: HostRoom }>(`/api/rooms/${roomId}/commands`, 'POST', { command }),
  join: (pin: string, nickname: string) =>
    request<JoinResponse>('/api/rooms/join', 'POST', { pin, nickname }),
  rejoin: (rejoinToken: string) =>
    request<RejoinResponse>('/api/rooms/rejoin', 'POST', { rejoinToken }),
  playerState: (roomId: string, clientId: string) =>
    request<PlayerView>(`/api/rooms/${roomId}/state?clientId=${encodeURIComponent(clientId)}`, 'GET'),
  answer: (roomId: string, body: Record<string, unknown>) =>
    request<{ answer: { latencyMs: number; remainingMs: number } }>(`/api/rooms/${roomId}/answers`, 'POST', body),
  nights: () => request<{ nights: NightSummary[] }>('/api/nights', 'GET'),
  night: (roomId: string) => request<{ night: NightDetail }>(`/api/nights/${roomId}`, 'GET'),
  serverTime: () => request<{ serverNow: number }>('/api/time', 'GET'),
};
