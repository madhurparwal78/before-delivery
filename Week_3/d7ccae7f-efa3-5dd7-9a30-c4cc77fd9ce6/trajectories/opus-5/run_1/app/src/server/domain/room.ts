import { randomBytes } from 'node:crypto';
import { ESTIMATE_BIN_COUNT } from '../../shared/protocol.js';
import type { PlayerQuestion, Reveal, SequenceItem } from '../../shared/protocol.js';
import { isRecord, readInteger, readString, type Json } from '../parse.js';
import { parseStoredSpec, type QuestionSpec } from './questions.js';
import type { Scored, Submission } from './scoring.js';
import { scoreSubmission, sequenceRun } from './scoring.js';

export interface SnapshotImage {
  key: string;
  contentType: string;
  bytes: number;
}

export interface SnapshotQuestion {
  id: string;
  position: number;
  version: number;
  prompt: string;
  timeLimitSeconds: number;
  image: SnapshotImage | null;
  spec: QuestionSpec;
  itemIds: string[];
}

/** The one reader of a stored picture record. */
export function parseStoredImage(stored: unknown): SnapshotImage | null {
  if (!isRecord(stored)) return null;
  const key = readString(stored, 'key');
  const contentType = readString(stored, 'contentType');
  const bytes = readInteger(stored, 'bytes');
  if (key === null || contentType === null || bytes === null) return null;
  return { key, contentType, bytes };
}

export function parseSnapshot(stored: unknown): SnapshotQuestion[] {
  if (!Array.isArray(stored)) return [];
  return stored.map((entry) => {
    const row = entry as Json;
    const storedSpec = isRecord(row['spec']) ? row['spec'] : {};
    const type = readString(storedSpec, 'type');
    const spec = parseStoredSpec(
      type === 'estimate' ? 'estimate' : type === 'sequence' ? 'sequence' : 'multiple_choice',
      storedSpec,
    );
    const image = parseStoredImage(row['image']);
    const itemIds = Array.isArray(row['itemIds'])
      ? row['itemIds'].filter((id): id is string => typeof id === 'string')
      : [];
    return {
      id: readString(row, 'id') ?? '',
      position: readInteger(row, 'position') ?? 1,
      version: readInteger(row, 'version') ?? 1,
      prompt: readString(row, 'prompt') ?? '',
      timeLimitSeconds: readInteger(row, 'timeLimitSeconds') ?? 20,
      image,
      spec,
      itemIds,
    };
  });
}

export function snapshotForStorage(question: {
  id: string;
  position: number;
  version: number;
  prompt: string;
  timeLimitSeconds: number;
  image: SnapshotImage | null;
  spec: QuestionSpec;
}): SnapshotQuestion {
  const itemIds =
    question.spec.type === 'sequence' ? question.spec.items.map(() => newItemId()) : [];
  return {
    id: question.id,
    position: question.position,
    version: question.version,
    prompt: question.prompt,
    timeLimitSeconds: question.timeLimitSeconds,
    image: question.image,
    spec: question.spec,
    itemIds,
  };
}

function newItemId(): string {
  return randomBytes(9).toString('base64url');
}

export function shuffledItemIds(question: SnapshotQuestion): string[] {
  const ids = [...question.itemIds];
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = randomBytes(1)[0]! % (i + 1);
    const a = ids[i] as string;
    ids[i] = ids[j] as string;
    ids[j] = a;
  }
  return ids;
}

/** The one projection of a snapshot question into the player-facing payload. */
export function playerQuestion(
  question: SnapshotQuestion,
  index: number,
  opensAt: number,
  deadlineAt: number,
  imageUrl: string | null,
  presentedIds: readonly string[],
): PlayerQuestion {
  const common = {
    index,
    prompt: question.prompt,
    timeLimitMs: question.timeLimitSeconds * 1000,
    opensAt,
    deadlineAt,
    imageUrl,
  };
  const spec = question.spec;
  if (spec.type === 'multiple_choice') {
    return { ...common, type: 'multiple_choice', options: [...spec.options] };
  }
  if (spec.type === 'estimate') {
    return {
      ...common,
      type: 'estimate',
      min: spec.min,
      max: spec.max,
      step: spec.step,
      unit: spec.unit,
    };
  }
  return { ...common, type: 'sequence', items: sequenceItems(question, presentedIds) };
}

function sequenceItems(question: SnapshotQuestion, presentedIds: readonly string[]): SequenceItem[] {
  const spec = question.spec;
  if (spec.type !== 'sequence') return [];
  const labelById = new Map<string, string>();
  question.itemIds.forEach((id, position) => labelById.set(id, spec.items[position] ?? ''));
  const order = presentedIds.length === question.itemIds.length ? presentedIds : question.itemIds;
  return order.map((id) => ({ id, label: labelById.get(id) ?? '' }));
}

export interface RevealSeat {
  seatId: string;
  nickname: string;
  streak: number;
  joinedAfterIndex: number;
}

export interface RevealAnswer {
  seatId: string;
  latencyMs: number;
  submission: Submission;
}

export interface RevealComputation {
  reveal: Reveal;
  scored: Map<string, Scored>;
}

export function computeReveal(
  question: SnapshotQuestion,
  questionIndex: number,
  seats: readonly RevealSeat[],
  answers: ReadonlyMap<string, RevealAnswer>,
): RevealComputation {
  const windowMs = question.timeLimitSeconds * 1000;
  const scored = new Map<string, Scored>();
  for (const seat of seats) {
    const answer = answers.get(seat.seatId) ?? null;
    scored.set(
      seat.seatId,
      scoreSubmission(
        question.spec,
        question.itemIds,
        answer ? answer.submission : null,
        answer ? answer.latencyMs : 0,
        windowMs,
        seat.streak,
      ),
    );
  }
  const results = seats.map((seat) => {
    const result = scored.get(seat.seatId) as Scored;
    return {
      seatId: seat.seatId,
      points: result.points,
      outcome: result.outcome,
      streak: result.streak,
    };
  });
  const base = {
    questionIndex,
    answered: answers.size,
    seated: seats.length,
    results,
  };
  const spec = question.spec;
  if (spec.type === 'multiple_choice') {
    const counts = spec.options.map(() => 0);
    for (const answer of answers.values()) {
      const choice = answer.submission.choice;
      if (choice !== undefined && choice >= 0 && choice < counts.length) {
        counts[choice] = (counts[choice] as number) + 1;
      }
    }
    return {
      reveal: { ...base, type: 'multiple_choice', counts, correctIndex: spec.correctIndex },
      scored,
    };
  }
  if (spec.type === 'estimate') {
    const width = (spec.max - spec.min) / ESTIMATE_BIN_COUNT;
    const bins = Array.from({ length: ESTIMATE_BIN_COUNT }, (_unused, index) => ({
      from: tidy(spec.min + index * width),
      to: index === ESTIMATE_BIN_COUNT - 1 ? tidy(spec.max) : tidy(spec.min + (index + 1) * width),
      count: 0,
    }));
    for (const answer of answers.values()) {
      const estimate = answer.submission.estimate;
      if (estimate === undefined) continue;
      const slot = width > 0 ? Math.floor((estimate - spec.min) / width) : 0;
      const index = Math.min(ESTIMATE_BIN_COUNT - 1, Math.max(0, slot));
      const bin = bins[index] as { count: number };
      bin.count += 1;
    }
    const low = spec.answer - spec.tolerance;
    const high = spec.answer + spec.tolerance;
    const inBandBins = bins
      .map((bin, index) => ({ bin, index }))
      .filter(({ bin }) => bin.from <= high && bin.to >= low)
      .map(({ index }) => index);
    return {
      reveal: {
        ...base,
        type: 'estimate',
        bins,
        answer: spec.answer,
        tolerance: spec.tolerance,
        inBandBins,
      },
      scored,
    };
  }
  const itemCount = question.itemIds.length;
  const buckets = Array.from({ length: itemCount + 1 }, () => 0);
  for (const seat of seats) {
    const answer = answers.get(seat.seatId);
    const run = answer ? sequenceRun(answer.submission.order ?? [], question.itemIds) : 0;
    const slot = Math.min(itemCount, Math.max(0, run));
    buckets[slot] = (buckets[slot] as number) + 1;
  }
  return {
    reveal: { ...base, type: 'sequence', buckets, correctOrder: [...question.itemIds] },
    scored,
  };
}

function tidy(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
