import { z } from "zod";

const questionTypes = ["multiple_choice", "estimate", "sequence"] as const;
const roomStates = ["lobby", "question_open", "locked", "reveal", "leaderboard", "podium", "ended"] as const;
export const hostCommands = ["open_question", "lock", "reveal", "show_leaderboard", "show_podium", "end"] as const;

export type QuestionType = (typeof questionTypes)[number];
export type RoomState = (typeof roomStates)[number];
export type HostCommand = (typeof hostCommands)[number];

const epochMs = z.number().int();
const questionBase = {
  index: z.number().int(),
  prompt: z.string(),
  timeLimitMs: z.number().int(),
  opensAt: epochMs,
  deadlineAt: epochMs,
  imageUrl: z.string().nullable(),
};

const playerQuestionSchema = z.discriminatedUnion("type", [
  z.object({ ...questionBase, type: z.literal("multiple_choice"), options: z.array(z.string()) }),
  z.object({
    ...questionBase,
    type: z.literal("estimate"),
    min: z.number(),
    max: z.number(),
    step: z.number(),
    unit: z.string(),
  }),
  z.object({
    ...questionBase,
    type: z.literal("sequence"),
    items: z.array(z.object({ id: z.string(), label: z.string() })),
  }),
]);
export type PlayerQuestion = z.infer<typeof playerQuestionSchema>;

const outcome = z.enum(["correct", "partial", "wrong", "none"]);
const revealBase = {
  questionIndex: z.number().int(),
  answered: z.number().int(),
  seated: z.number().int(),
  results: z.array(z.object({ seatId: z.string(), points: z.number().int(), outcome, streak: z.number().int() })),
};

export const revealSchema = z.discriminatedUnion("type", [
  z.object({
    ...revealBase,
    type: z.literal("multiple_choice"),
    counts: z.array(z.number().int()),
    correctIndex: z.number().int(),
  }),
  z.object({
    ...revealBase,
    type: z.literal("estimate"),
    bins: z.array(z.object({ from: z.number(), to: z.number(), count: z.number().int() })),
    answer: z.number(),
    tolerance: z.number(),
    inBandBins: z.array(z.number().int()),
  }),
  z.object({
    ...revealBase,
    type: z.literal("sequence"),
    buckets: z.array(z.number().int()),
    correctOrder: z.array(z.string()),
  }),
]);
export type Reveal = z.infer<typeof revealSchema>;

const standingsSchema = z.array(
  z.object({
    rank: z.number().int(),
    seatId: z.string(),
    nickname: z.string(),
    score: z.number().int(),
    streak: z.number().int(),
  }),
);
export type Standings = z.infer<typeof standingsSchema>;

const roomStateSchema = z.enum(roomStates);
const presencePlayers = z.array(z.object({ seatId: z.string(), nickname: z.string(), connected: z.boolean() }));

export const roomEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("player_joined"),
    data: z.object({ seatId: z.string(), nickname: z.string(), seated: z.number().int() }),
  }),
  z.object({
    type: z.literal("presence"),
    data: z.object({ seated: z.number().int(), connected: z.number().int(), players: presencePlayers }),
  }),
  z.object({ type: z.literal("question_open"), data: playerQuestionSchema }),
  z.object({
    type: z.literal("answer_count"),
    data: z.object({ questionIndex: z.number().int(), answered: z.number().int(), seated: z.number().int() }),
  }),
  z.object({
    type: z.literal("locked"),
    data: z.object({ questionIndex: z.number().int(), reason: z.enum(["host", "deadline"]) }),
  }),
  z.object({ type: z.literal("reveal"), data: revealSchema }),
  z.object({ type: z.literal("leaderboard"), data: z.object({ standings: standingsSchema }) }),
  z.object({ type: z.literal("podium"), data: z.object({ top: standingsSchema, standings: standingsSchema }) }),
  z.object({ type: z.literal("ended"), data: z.object({ reason: z.enum(["host", "idle"]) }) }),
]);
export type RoomEvent = z.infer<typeof roomEventSchema>;
export type StoredEvent = RoomEvent & { id: number };

export const hostRoomSchema = z.object({
  id: z.string(),
  pin: z.string(),
  state: roomStateSchema,
  deckTitle: z.string(),
  questionCount: z.number().int(),
  questionIndex: z.number().int().nullable(),
  question: playerQuestionSchema.nullable(),
  answered: z.number().int(),
  seated: z.number().int(),
  connected: z.number().int(),
  players: z.array(
    z.object({
      seatId: z.string(),
      nickname: z.string(),
      score: z.number().int(),
      rank: z.number().int(),
      connected: z.boolean(),
    }),
  ),
  reveal: revealSchema.nullable(),
  standings: standingsSchema,
  transport: z.enum(["live", "backup"]),
  lastEventId: z.number().int(),
});
export type HostRoom = z.infer<typeof hostRoomSchema>;

export const playerViewSchema = z.object({
  state: roomStateSchema,
  questionCount: z.number().int(),
  questionIndex: z.number().int().nullable(),
  question: playerQuestionSchema.nullable(),
  reveal: revealSchema.nullable(),
  standings: standingsSchema,
  you: z.object({
    seatId: z.string(),
    nickname: z.string(),
    score: z.number().int(),
    streak: z.number().int(),
    rank: z.number().int(),
    answeredCurrent: z.boolean(),
  }),
  lastEventId: z.number().int(),
});
export type PlayerView = z.infer<typeof playerViewSchema>;

const imageSchema = z.object({
  status: z.literal("attached"),
  contentType: z.string(),
  bytes: z.number().int(),
  previewUrl: z.string(),
});
const questionIdentity = {
  id: z.string(),
  position: z.number().int(),
  version: z.number().int(),
  prompt: z.string(),
  timeLimitSeconds: z.number().int(),
  image: imageSchema.nullable(),
};

export const deckQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    ...questionIdentity,
    type: z.literal("multiple_choice"),
    options: z.array(z.string()),
    correctIndex: z.number().int(),
  }),
  z.object({
    ...questionIdentity,
    type: z.literal("estimate"),
    min: z.number(),
    max: z.number(),
    step: z.number(),
    answer: z.number(),
    tolerance: z.number(),
    unit: z.string(),
  }),
  z.object({ ...questionIdentity, type: z.literal("sequence"), items: z.array(z.string()) }),
]);
export type DeckQuestion = z.infer<typeof deckQuestionSchema>;

export const deckSchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.number().int(),
  questions: z.array(deckQuestionSchema),
});
export type Deck = z.infer<typeof deckSchema>;

export const deckSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.number().int(),
  questionCount: z.number().int(),
  updatedAt: epochMs,
});
export type DeckSummary = z.infer<typeof deckSummarySchema>;

export const nightSummarySchema = z.object({
  roomId: z.string(),
  deckTitle: z.string(),
  endedAt: epochMs,
  seated: z.number().int(),
  podium: z.array(z.object({ rank: z.number().int(), nickname: z.string(), score: z.number().int() })),
});
export type NightSummary = z.infer<typeof nightSummarySchema>;

export const nightDetailSchema = z.object({
  roomId: z.string(),
  deckTitle: z.string(),
  endedAt: epochMs,
  standings: z.array(z.object({ rank: z.number().int(), nickname: z.string(), score: z.number().int() })),
});
export type NightDetail = z.infer<typeof nightDetailSchema>;

export const quizmasterSchema = z.object({ id: z.string(), email: z.string(), displayName: z.string() });
export type Quizmaster = z.infer<typeof quizmasterSchema>;

export const errorBodySchema = z.object({
  error: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
  remainingMs: z.number().optional(),
  currentVersion: z.number().optional(),
  state: z.string().optional(),
});

export const joinedSchema = z.object({
  roomId: z.string(),
  seatId: z.string(),
  nickname: z.string(),
  rejoinToken: z.string(),
  clientId: z.string(),
});

export const rejoinedSchema = z.object({
  roomId: z.string(),
  seatId: z.string(),
  nickname: z.string(),
  score: z.number().int(),
  streak: z.number().int(),
  clientId: z.string(),
});

export const answerReceiptSchema = z.object({
  answer: z.object({ questionIndex: z.number().int(), latencyMs: z.number().int(), remainingMs: z.number().int() }),
});

export const PIN_LENGTH = 6;
export const NICKNAME_MAX = 20;
export const PICTURE_LIMIT_BYTES = 2_000_000;
export const JSON_LIMIT_BYTES = 64_000;
export const UPLOAD_LIMIT_BYTES = 2_100_000;
export const SEAT_LIMIT = 200;
export const BACKUP_POLL_WINDOW_MS = 30_000;
export const PODIUM_DOLLY_MS = 1400;
export const PILLAR_GAP_MS = 90;
export const PILLAR_SETTLE_MS = 600;
