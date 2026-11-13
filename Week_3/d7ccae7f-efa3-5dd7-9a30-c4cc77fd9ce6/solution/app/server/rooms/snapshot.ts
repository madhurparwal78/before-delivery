import { randomBytes } from "node:crypto";
import { z } from "zod";
import { revealSchema, type PlayerQuestion, type QuestionType, type Reveal } from "../../shared/schemas.js";
import { presignGet } from "../s3.js";

export const storedImageSchema = z.object({ key: z.string(), contentType: z.string(), bytes: z.number().int() });
export type StoredImage = z.infer<typeof storedImageSchema>;

const snapshotFields = z.discriminatedUnion("type", [
  z.object({ type: z.literal("multiple_choice"), options: z.array(z.string()), correctIndex: z.number().int() }),
  z.object({
    type: z.literal("estimate"),
    min: z.number(),
    max: z.number(),
    step: z.number(),
    answer: z.number(),
    tolerance: z.number(),
    unit: z.string(),
  }),
  z.object({
    type: z.literal("sequence"),
    items: z.array(z.object({ id: z.string(), label: z.string() })),
    shuffled: z.array(z.string()),
  }),
]);

export type RoomQuestion = z.infer<typeof snapshotFields> & {
  index: number;
  prompt: string;
  timeLimitMs: number;
  opensAt: number | null;
  deadlineAt: number | null;
  image: StoredImage | null;
  reveal: Reveal | null;
};

export type RoomQuestionRow = {
  index: number;
  type: QuestionType;
  prompt: string;
  time_limit_ms: number;
  fields: unknown;
  image: unknown;
  opens_at: string | number | null;
  deadline_at: string | number | null;
  reveal: unknown;
};

export const ROOM_QUESTION_COLUMNS = "index, type, prompt, time_limit_ms, fields, image, opens_at, deadline_at, reveal";

export function readRoomQuestion(row: RoomQuestionRow): RoomQuestion {
  return {
    ...snapshotFields.parse({ type: row.type, ...(row.fields as object) }),
    index: row.index,
    prompt: row.prompt,
    timeLimitMs: row.time_limit_ms,
    opensAt: row.opens_at === null ? null : Number(row.opens_at),
    deadlineAt: row.deadline_at === null ? null : Number(row.deadline_at),
    image: row.image === null ? null : storedImageSchema.parse(row.image),
    reveal: row.reveal === null ? null : revealSchema.parse(row.reveal),
  };
}

function shuffled<T>(items: T[]): T[] {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor((randomBytes(4).readUInt32BE() / 2 ** 32) * (i + 1));
    [order[i], order[j]] = [order[j] as T, order[i] as T];
  }
  return order;
}

// Freezes a deck question for a room: sequence items get opaque ids and a server-chosen order.
export function freezeFields(type: QuestionType, fields: Record<string, unknown>): Record<string, unknown> {
  if (type !== "sequence") return fields;
  const labels = z.array(z.string()).parse(fields["items"]);
  const items = labels.map((label) => ({ id: randomBytes(9).toString("base64url"), label }));
  let order = shuffled(items.map((item) => item.id));
  if (order.every((id, position) => id === items[position]?.id)) order = [...order.slice(1), order[0] as string];
  return { items, shuffled: order };
}

// The one projection of a room question onto what phones and the stage may see before the reveal.
export function playerQuestion(question: RoomQuestion): PlayerQuestion {
  const base = {
    index: question.index,
    prompt: question.prompt,
    timeLimitMs: question.timeLimitMs,
    opensAt: question.opensAt as number,
    deadlineAt: question.deadlineAt as number,
    imageUrl: question.image ? presignGet(question.image.key) : null,
  };
  switch (question.type) {
    case "multiple_choice":
      return { ...base, type: "multiple_choice", options: question.options };
    case "estimate":
      return { ...base, type: "estimate", min: question.min, max: question.max, step: question.step, unit: question.unit };
    case "sequence": {
      const byId = new Map(question.items.map((item) => [item.id, item]));
      return { ...base, type: "sequence", items: question.shuffled.map((id) => byId.get(id) as { id: string; label: string }) };
    }
  }
}
