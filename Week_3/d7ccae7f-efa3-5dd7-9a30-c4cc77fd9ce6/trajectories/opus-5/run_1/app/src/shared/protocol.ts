export type QuestionType = 'multiple_choice' | 'estimate' | 'sequence';

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

export type Outcome = 'correct' | 'partial' | 'wrong' | 'none';

export interface QuestionImage {
  status: 'attached';
  contentType: string;
  bytes: number;
  previewUrl: string;
}

interface QuestionBase {
  id: string;
  position: number;
  version: number;
  prompt: string;
  timeLimitSeconds: number;
  image: QuestionImage | null;
}

export interface MultipleChoiceQuestion extends QuestionBase {
  type: 'multiple_choice';
  options: string[];
  correctIndex: number;
}

export interface EstimateQuestion extends QuestionBase {
  type: 'estimate';
  min: number;
  max: number;
  step: number;
  answer: number;
  tolerance: number;
  unit: string;
}

export interface SequenceQuestion extends QuestionBase {
  type: 'sequence';
  items: string[];
}

export type Question = MultipleChoiceQuestion | EstimateQuestion | SequenceQuestion;

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

interface PlayerQuestionBase {
  index: number;
  prompt: string;
  timeLimitMs: number;
  opensAt: number;
  deadlineAt: number;
  imageUrl: string | null;
}

export interface PlayerMultipleChoiceQuestion extends PlayerQuestionBase {
  type: 'multiple_choice';
  options: string[];
}

export interface PlayerEstimateQuestion extends PlayerQuestionBase {
  type: 'estimate';
  min: number;
  max: number;
  step: number;
  unit: string;
}

export interface SequenceItem {
  id: string;
  label: string;
}

export interface PlayerSequenceQuestion extends PlayerQuestionBase {
  type: 'sequence';
  items: SequenceItem[];
}

export type PlayerQuestion =
  | PlayerMultipleChoiceQuestion
  | PlayerEstimateQuestion
  | PlayerSequenceQuestion;

export interface RevealResult {
  seatId: string;
  points: number;
  outcome: Outcome;
  streak: number;
}

interface RevealBase {
  questionIndex: number;
  answered: number;
  seated: number;
  results: RevealResult[];
}

export interface MultipleChoiceReveal extends RevealBase {
  type: 'multiple_choice';
  counts: number[];
  correctIndex: number;
}

export interface EstimateBin {
  from: number;
  to: number;
  count: number;
}

export interface EstimateReveal extends RevealBase {
  type: 'estimate';
  bins: EstimateBin[];
  answer: number;
  tolerance: number;
  inBandBins: number[];
}

export interface SequenceReveal extends RevealBase {
  type: 'sequence';
  buckets: number[];
  correctOrder: string[];
}

export type Reveal = MultipleChoiceReveal | EstimateReveal | SequenceReveal;

export interface Standing {
  rank: number;
  seatId: string;
  nickname: string;
  score: number;
  streak: number;
}

export interface HostPlayer {
  seatId: string;
  nickname: string;
  score: number;
  rank: number;
  connected: boolean;
}

export interface HostRoom {
  id: string;
  pin: string;
  state: RoomState;
  deckTitle: string;
  questionCount: number;
  questionIndex: number | null;
  question: PlayerQuestion | null;
  answered: number;
  seated: number;
  connected: number;
  players: HostPlayer[];
  reveal: Reveal | null;
  standings: Standing[];
  transport: 'live' | 'backup';
  lastEventId: number;
}

export interface PlayerView {
  state: RoomState;
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
    rank: number;
    answeredCurrent: boolean;
  };
  lastEventId: number;
}

export interface PresenceEntry {
  seatId: string;
  nickname: string;
  connected: boolean;
}

export type RoomEventType =
  | 'player_joined'
  | 'presence'
  | 'question_open'
  | 'answer_count'
  | 'locked'
  | 'reveal'
  | 'leaderboard'
  | 'podium'
  | 'ended';

export type RoomEventData =
  | { seatId: string; nickname: string; seated: number }
  | { seated: number; connected: number; players: PresenceEntry[] }
  | PlayerQuestion
  | { questionIndex: number; answered: number; seated: number }
  | { questionIndex: number; reason: 'host' | 'deadline' }
  | Reveal
  | { standings: Standing[] }
  | { top: Standing[]; standings: Standing[] }
  | { reason: 'host' | 'idle' };

export interface RoomEvent {
  id: number;
  type: RoomEventType;
  data: RoomEventData;
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

export interface Quizmaster {
  id: string;
  email: string;
  displayName: string;
}

export interface JoinResult {
  roomId: string;
  seatId: string;
  nickname: string;
  rejoinToken: string;
  clientId: string;
}

export interface RejoinResult {
  roomId: string;
  seatId: string;
  nickname: string;
  score: number;
  streak: number;
  clientId: string;
}

export interface AnswerAccepted {
  questionIndex: number;
  latencyMs: number;
  remainingMs: number;
}

export const MAX_DECK_QUESTIONS = 50;
export const MAX_SEATS = 200;
export const ESTIMATE_BIN_COUNT = 8;
export const IMAGE_MAX_BYTES = 2_000_000;
export const JSON_BODY_LIMIT = 64_000;
export const UPLOAD_BODY_LIMIT = 2_100_000;
