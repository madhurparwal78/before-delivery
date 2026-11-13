export type QuestionType = 'multiple_choice' | 'estimate' | 'sequence';

export type QuestionContent =
  | { type: 'multiple_choice'; options: string[]; correctIndex: number }
  | {
      type: 'estimate';
      min: number;
      max: number;
      step: number;
      answer: number;
      tolerance: number;
      unit: string;
    }
  | { type: 'sequence'; items: string[] };

export interface StoredQuestion {
  id: string;
  position: number;
  version: number;
  prompt: string;
  timeLimitSeconds: number;
  image: ImageInfo | null;
  content: QuestionContent;
}

export interface ImageInfo {
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: number;
  objectKey: string;
}

export interface DeckRecord {
  id: string;
  title: string;
  version: number;
  questions: StoredQuestion[];
}

export type RoomState =
  | 'lobby'
  | 'question_open'
  | 'locked'
  | 'reveal'
  | 'leaderboard'
  | 'podium'
  | 'ended';

export type HostCommand =
  | 'open_question'
  | 'lock'
  | 'reveal'
  | 'show_leaderboard'
  | 'show_podium'
  | 'end';

export interface RoomSnapshot {
  id: string;
  quizmasterId: string;
  deckId: string;
  deckTitle: string;
  pin: string;
  state: RoomState;
  questionIndex: number | null;
  questions: StoredQuestion[];
  opensAt: number | null;
  deadlineAt: number | null;
  lockedReason: 'host' | 'deadline' | null;
  endedReason: 'host' | 'idle' | null;
  endedAt: number | null;
  emptySince: number | null;
  lastEventId: number;
}

export interface SeatRecord {
  seatId: string;
  nickname: string;
  rejoinTokenHash: string;
  joinedAt: number;
  score: number;
  streak: number;
  cumulativeMs: number;
  rank: number;
}

export interface RevealPayload {
  questionIndex: number;
  type: QuestionType;
  answered: number;
  seated: number;
  results: { seatId: string; points: number; outcome: 'correct' | 'partial' | 'wrong' | 'none'; streak: number }[];
  counts?: number[];
  correctIndex?: number;
  bins?: { from: number; to: number; count: number }[];
  answer?: number;
  tolerance?: number;
  inBandBins?: number[];
  buckets?: number[];
  correctOrder?: string[];
}

export interface Standing {
  rank: number;
  seatId: string;
  nickname: string;
  score: number;
  streak: number;
}
