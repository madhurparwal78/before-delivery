// The term index the app builds itself: postings kept in Postgres for live generations, built in memory for archived ones.
import { pool } from "../db";
import { analyze, positionSpan } from "./analysis";
import type { FieldType, Scalar } from "./fields";
import type { StoredEvent } from "./events";

interface IndexedEvent {
  postings: Array<{ field: string; term: string; tf: number; positions: number[] }>;
  lengths: Array<{ field: string; dl: number }>;
}

/** Indexes every text field by token and every keyword field by whole value. */
export function indexEvent(flat: Map<string, Scalar[]>, typeOf: (field: string) => FieldType | undefined): IndexedEvent {
  const indexed: IndexedEvent = { postings: [], lengths: [] };
  for (const [field, values] of flat) {
    const type = typeOf(field);
    const terms = new Map<string, number[]>();
    let dl = 0;
    if (type === "text") {
      let base = 0;
      for (const value of values) {
        if (typeof value !== "string") continue;
        for (const token of analyze("standard", value)) {
          terms.set(token.token, [...(terms.get(token.token) ?? []), base + token.position]);
          dl++;
        }
        base += positionSpan("standard", value);
      }
      indexed.lengths.push({ field, dl });
    } else if (type === "keyword") {
      values.forEach((value, at) => {
        if (typeof value === "string") terms.set(value, [...(terms.get(value) ?? []), at]);
      });
    }
    for (const [term, positions] of terms) indexed.postings.push({ field, term, tf: positions.length, positions });
  }
  return indexed;
}

export interface PostingHit {
  id: string;
  tf: number;
  positions: number[];
}

export interface FieldLengths {
  count: number;
  total: number;
  byEvent: Map<string, number>;
}

export interface TermIndex {
  postings(field: string, term: string, generations: number[]): Promise<PostingHit[]>;
  /** Up to `limit` distinct terms of a field. */
  dictionary(field: string, generations: number[], limit: number): Promise<string[]>;
  lengths(field: string): Promise<FieldLengths>;
}

export class PostgresTermIndex implements TermIndex {
  constructor(private readonly streamId: number, private readonly from: number, private readonly to: number) {}

  async postings(field: string, term: string, generations: number[]): Promise<PostingHit[]> {
    const { rows } = await pool.query<{ ext_id: string; tf: number; positions: number[] }>(
      `SELECT ext_id, tf, positions FROM postings
       WHERE stream_id = $1 AND field = $2 AND term = $3 AND generation = ANY($4) AND ts >= $5 AND ts < $6`,
      [this.streamId, field, term, generations, this.from, this.to],
    );
    return rows.map((row) => ({ id: row.ext_id, tf: row.tf, positions: row.positions }));
  }

  async dictionary(field: string, generations: number[], limit: number): Promise<string[]> {
    const { rows } = await pool.query<{ term: string }>(
      `SELECT DISTINCT term FROM postings
       WHERE stream_id = $1 AND field = $2 AND generation = ANY($3) AND ts >= $4 AND ts < $5 LIMIT $6`,
      [this.streamId, field, generations, this.from, this.to, limit],
    );
    return rows.map((row) => row.term);
  }

  async lengths(field: string): Promise<FieldLengths> {
    const { rows } = await pool.query<{ ext_id: string; dl: number }>(
      "SELECT ext_id, dl FROM field_lengths WHERE stream_id = $1 AND field = $2 AND ts >= $3 AND ts < $4",
      [this.streamId, field, this.from, this.to],
    );
    return collectLengths(rows.map((row) => [row.ext_id, row.dl]));
  }
}

function collectLengths(pairs: Array<[string, number]>): FieldLengths {
  const lengths: FieldLengths = { count: pairs.length, total: 0, byEvent: new Map() };
  for (const [id, dl] of pairs) {
    lengths.total += dl;
    lengths.byEvent.set(id, dl);
  }
  return lengths;
}

/** The same index built in memory from archived events read back from a segment. */
export class MemoryTermIndex implements TermIndex {
  private readonly byField = new Map<string, Map<string, Array<PostingHit & { generation: number }>>>();
  private readonly lengthPairs = new Map<string, Array<[string, number]>>();

  constructor(events: StoredEvent[], typesOf: (generation: number) => Map<string, FieldType>) {
    for (const event of events) {
      const types = typesOf(event.generation);
      const indexed = indexEvent(event.flat, (field) => types.get(field));
      for (const posting of indexed.postings) {
        const terms = this.byField.get(posting.field) ?? new Map();
        const hits = terms.get(posting.term) ?? [];
        hits.push({ id: event.id, tf: posting.tf, positions: posting.positions, generation: event.generation });
        terms.set(posting.term, hits);
        this.byField.set(posting.field, terms);
      }
      for (const { field, dl } of indexed.lengths) this.lengthPairs.set(field, [...(this.lengthPairs.get(field) ?? []), [event.id, dl]]);
    }
  }

  async postings(field: string, term: string, generations: number[]): Promise<PostingHit[]> {
    return (this.byField.get(field)?.get(term) ?? []).filter((hit) => generations.includes(hit.generation));
  }

  async dictionary(field: string, _generations: number[], limit: number): Promise<string[]> {
    return [...(this.byField.get(field)?.keys() ?? [])].slice(0, limit);
  }

  async lengths(field: string): Promise<FieldLengths> {
    return collectLengths(this.lengthPairs.get(field) ?? []);
  }
}

/** Live and archived indexes answering as one. */
export class CompositeIndex implements TermIndex {
  constructor(private readonly parts: TermIndex[]) {}

  async postings(field: string, term: string, generations: number[]): Promise<PostingHit[]> {
    return (await Promise.all(this.parts.map((part) => part.postings(field, term, generations)))).flat();
  }

  async dictionary(field: string, generations: number[], limit: number): Promise<string[]> {
    const lists = await Promise.all(this.parts.map((part) => part.dictionary(field, generations, limit)));
    return [...new Set(lists.flat())].slice(0, limit);
  }

  async lengths(field: string): Promise<FieldLengths> {
    const merged: FieldLengths = { count: 0, total: 0, byEvent: new Map() };
    for (const part of await Promise.all(this.parts.map((p) => p.lengths(field)))) {
      merged.count += part.count;
      merged.total += part.total;
      for (const [id, dl] of part.byEvent) merged.byEvent.set(id, dl);
    }
    return merged;
  }
}

/** Writes the postings and lengths of events into Postgres, in batches. */
export async function persistIndex(
  client: { query: (text: string, values: unknown[]) => Promise<unknown> },
  streamId: number,
  entries: Array<{ id: string; generation: number; ts: number; indexed: IndexedEvent }>,
): Promise<void> {
  const BATCH = 20_000;
  const postings = { gen: [] as number[], field: [] as string[], term: [] as string[], id: [] as string[], ts: [] as number[], tf: [] as number[], pos: [] as string[] };
  const lengths = { gen: [] as number[], field: [] as string[], id: [] as string[], ts: [] as number[], dl: [] as number[] };
  const flushPostings = async (): Promise<void> => {
    if (postings.id.length === 0) return;
    await client.query(
      `INSERT INTO postings (stream_id, generation, field, term, ext_id, ts, tf, positions)
       SELECT $1, g, f, t, i, s, tf, p::int[] FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::bigint[], $7::int[], $8::text[]) AS u(g, f, t, i, s, tf, p)`,
      [streamId, postings.gen, postings.field, postings.term, postings.id, postings.ts, postings.tf, postings.pos],
    );
    for (const list of Object.values(postings)) list.length = 0;
  };
  for (const entry of entries) {
    for (const posting of entry.indexed.postings) {
      postings.gen.push(entry.generation);
      postings.field.push(posting.field);
      postings.term.push(posting.term);
      postings.id.push(entry.id);
      postings.ts.push(entry.ts);
      postings.tf.push(posting.tf);
      postings.pos.push(`{${posting.positions.join(",")}}`);
      if (postings.id.length >= BATCH) await flushPostings();
    }
    for (const length of entry.indexed.lengths) {
      lengths.gen.push(entry.generation);
      lengths.field.push(length.field);
      lengths.id.push(entry.id);
      lengths.ts.push(entry.ts);
      lengths.dl.push(length.dl);
    }
  }
  await flushPostings();
  if (lengths.id.length > 0) {
    await client.query(
      `INSERT INTO field_lengths (stream_id, generation, field, ext_id, ts, dl)
       SELECT $1, g, f, i, s, d FROM unnest($2::int[], $3::text[], $4::text[], $5::bigint[], $6::int[]) AS u(g, f, i, s, d)`,
      [streamId, lengths.gen, lengths.field, lengths.id, lengths.ts, lengths.dl],
    );
  }
}
