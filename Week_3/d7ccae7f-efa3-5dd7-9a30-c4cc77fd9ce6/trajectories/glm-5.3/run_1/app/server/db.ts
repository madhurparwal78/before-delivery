import type { Pool, PoolClient } from 'pg';
import type {
  DeckRecord,
  QuestionContent,
  RoomSnapshot,
  SeatRecord,
} from './domain.ts';
import { errors } from './errors.ts';

export interface Row {
  [key: string]: unknown;
}

export function str(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`expected string ${key}`);
  return value;
}

export function int(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  throw new Error(`expected number ${key}`);
}

export function nullableInt(row: Row, key: string): number | null {
  if (row[key] === null) return null;
  return int(row, key);
}

export function parseContent(raw: string | null | object): QuestionContent {
  if (raw === null || raw === undefined) throw new Error('missing question content');
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (typeof parsed !== 'object' || parsed === null) throw new Error('bad content');
  const obj = parsed as Record<string, unknown>;
  const type = obj.type;
  if (type === 'multiple_choice') {
    const options = Array.isArray(obj.options) ? obj.options : [];
    if (!options.every((o): o is string => typeof o === 'string')) {
      throw new Error('bad options');
    }
    const correctIndex = Number(obj.correctIndex);
    if (!Number.isInteger(correctIndex)) throw new Error('bad correctIndex');
    return { type: 'multiple_choice', options, correctIndex };
  }
  if (type === 'estimate') {
    for (const key of ['min', 'max', 'step', 'answer', 'tolerance'] as const) {
      if (!Number.isFinite(Number(obj[key]))) throw new Error(`bad estimate ${key}`);
    }
    const unit = typeof obj.unit === 'string' ? obj.unit : '';
    return {
      type: 'estimate',
      min: Number(obj.min),
      max: Number(obj.max),
      step: Number(obj.step),
      answer: Number(obj.answer),
      tolerance: Number(obj.tolerance),
      unit,
    };
  }
  if (type === 'sequence') {
    const items = Array.isArray(obj.items) ? obj.items : [];
    if (!items.every((o): o is string => typeof o === 'string')) {
      throw new Error('bad items');
    }
    return { type: 'sequence', items };
  }
  throw new Error('unknown question type');
}

interface QuestionRow extends Row {
  id: string;
  position: number;
  version: number;
  prompt: string;
  time_limit_seconds: number;
  content: string | null;
  image_content_type: string | null;
  image_bytes: number | null;
  image_object_key: string | null;
}

export function questionFromRow(row: QuestionRow) {
  const image =
    row.image_object_key !== null &&
    row.image_content_type !== null &&
    row.image_bytes !== null
      ? {
          contentType: row.image_content_type as 'image/png' | 'image/jpeg' | 'image/webp',
          bytes: row.image_bytes,
          objectKey: row.image_object_key,
        }
      : null;
  return {
    id: row.id,
    position: int(row, 'position'),
    version: int(row, 'version'),
    prompt: str(row, 'prompt'),
    timeLimitSeconds: int(row, 'time_limit_seconds'),
    image,
    content: parseContent(row.content as unknown as object),
  };
}

const deckSelect = `
  select d.id, d.title, d.version,
         q.id as q_id, q.position as q_position, q.version as q_version,
         q.prompt as q_prompt, q.time_limit_seconds as q_time,
         q.content as q_content,
         q.image_content_type as q_img_type, q.image_bytes as q_img_bytes,
         q.image_object_key as q_img_key
  from decks d
  left join questions q on q.deck_id = d.id
`;

function rowsToDecks(rows: QuestionRow[]): DeckRecord[] {
  const decks = new Map<string, DeckRecord>();
  for (const row of rows) {
    let deck = decks.get(row.id);
    if (!deck) {
      deck = {
        id: row.id,
        title: str(row, 'title'),
        version: int(row, 'version'),
        questions: [],
      };
      decks.set(row.id, deck);
    }
    if (row.q_id) {
      deck.questions.push(
        questionFromRow({
          id: row.q_id,
          position: row.q_position,
          version: row.q_version,
          prompt: row.q_prompt,
          time_limit_seconds: row.q_time,
          content: row.q_content,
          image_content_type: row.q_img_type,
          image_bytes: row.q_img_bytes,
          image_object_key: row.q_img_key,
        } as QuestionRow),
      );
    }
  }
  for (const deck of decks.values()) deck.questions.sort((a, b) => a.position - b.position);
  return [...decks.values()];
}

export async function loadDeck(db: PoolClient | Pool, quizmasterId: string, deckId: string): Promise<DeckRecord> {
  const result = await db.query(`${deckSelect}
    where d.id = $1 and d.quizmaster_id = $2
    order by q.position asc`, [deckId, quizmasterId]);
  const decks = rowsToDecks(result.rows as QuestionRow[]);
  if (decks.length === 0) throw errors.notFound();
  return decks[0];
}

export interface RawRoomRow extends Row {
  id: string;
  deck_id: string;
  deck_title: string;
  pin: string;
  state: string;
  question_index: number | null;
  opens_at: bigint | null;
  deadline_at: bigint | null;
  locked_reason: string | null;
  ended_reason: string | null;
  ended_at: bigint | null;
  empty_since: bigint | null;
  snapshot: string | Record<string, unknown>;
  last_event_id: string | number;
}

export function roomFromRow(row: RawRoomRow): RoomSnapshot {
  const snapshot: unknown = typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot;
  if (typeof snapshot !== 'object' || snapshot === null) throw new Error('bad snapshot');
  const questionsRaw = (snapshot as { questions?: unknown }).questions;
  if (!Array.isArray(questionsRaw)) throw new Error('bad snapshot questions');
  const questions = questionsRaw.map((q) => {
    if (typeof q !== 'object' || q === null) throw new Error('bad snapshot question');
    const obj = q as Record<string, unknown>;
    const image =
      typeof obj.image === 'object' && obj.image !== null
        ? (obj.image as RoomSnapshot['questions'][number]['image'])
        : null;
    return {
      id: String(obj.id),
      position: Number(obj.position),
      version: Number(obj.version),
      prompt: String(obj.prompt),
      timeLimitSeconds: Number(obj.timeLimitSeconds),
      image,
      content: parseContent(obj.content as unknown as object),
    };
  });
  return {
    id: str(row, 'id'),
    quizmasterId: str(row, 'quizmaster_id'),
    deckId: str(row, 'deck_id'),
    deckTitle: str(row, 'deck_title'),
    pin: str(row, 'pin'),
    state: str(row, 'state') as RoomSnapshot['state'],
    questionIndex: row.question_index === null ? null : int(row, 'question_index'),
    opensAt: row.opens_at === null ? null : Number(row.opens_at),
    deadlineAt: row.deadline_at === null ? null : Number(row.deadline_at),
    lockedReason: (row.locked_reason as RoomSnapshot['lockedReason']) ?? null,
    endedReason: (row.ended_reason as RoomSnapshot['endedReason']) ?? null,
    endedAt: row.ended_at === null ? null : Number(row.ended_at),
    emptySince: row.empty_since === null ? null : Number(row.empty_since),
    questions,
    lastEventId: Number(row.last_event_id),
  };
}

export async function loadSeats(db: PoolClient | Pool, roomId: string): Promise<SeatRecord[]> {
  const result = await db.query(
    'select * from seats where room_id = $1 order by joined_at asc, id asc',
    [roomId],
  );
  return (result.rows as Row[]).map((row) => ({
    seatId: str(row, 'id'),
    nickname: str(row, 'nickname'),
    rejoinTokenHash: str(row, 'rejoin_token_hash'),
    joinedAt: int(row, 'joined_at'),
    score: int(row, 'score'),
    streak: int(row, 'streak'),
    cumulativeMs: int(row, 'cumulative_ms'),
    rank: int(row, 'rank'),
  }));
}
