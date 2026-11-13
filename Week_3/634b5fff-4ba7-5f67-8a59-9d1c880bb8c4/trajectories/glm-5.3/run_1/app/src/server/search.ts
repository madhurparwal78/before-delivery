import { config } from './config.js';
import { MeiliSearch } from 'meilisearch';
import { query } from './db.js';
import { publicBoxState } from './orders.js';

export class SearchDown extends Error {}

export const publicIndexName = config.namespace ? `${config.namespace}-press_public` : 'press_public';
export const staffIndexName = config.namespace ? `${config.namespace}-press_staff` : 'press_staff';

const client = new MeiliSearch({ host: config.meilisearch.url, apiKey: config.meilisearch.apiKey });

export const publicIndex = client.index(publicIndexName);
export const staffIndex = client.index(staffIndexName);

export async function searchUp(): Promise<boolean> {
  try {
    const res = await client.health();
    return (res.status ?? 'available') === 'available';
  } catch {
    return false;
  }
}

export type PassageDoc = { id: string; kind: 'passage'; passageId: string; chapter: string; text: string };
export type BoxDoc = { id: string; kind: 'box'; number: number; plate: string };
export interface StaffBoxDoc { number: number; plate: string; state: string; recipientName: string | null; reference: string | null }

export async function provisionIndexes(): Promise<void> {
  await client.createIndex(publicIndexName, { primaryKey: 'id' });
  await client.createIndex(staffIndexName, { primaryKey: 'id' });
  await publicIndex.updateSettings({
    searchableAttributes: ['text', 'number', 'plate'],
    typoTolerance: { enabled: true },
  });
  await staffIndex.updateSettings({
    searchableAttributes: ['number', 'plate', 'recipientName'],
  });
}

export async function searchPublic(q: string): Promise<{ hits: Record<string, unknown>[] }> {
  const res = await publicIndex.search(q, { limit: 20 });
  const hits = res.hits as unknown as { document?: Record<string, unknown> }[];
  // Passage hits carry passageId, chapter and an excerpt; box hits carry
  // number, plate and a live state.
  const out: Record<string, unknown>[] = [];
  for (const h of hits) {
    const doc = (h.document ?? h) as Record<string, unknown>;
    if (doc.kind === 'box') {
      const rows = await query<{ box_state: string }>('SELECT box_state FROM boxes WHERE number = $1', [doc.number]);
      const state = rows[0] ? publicBoxState(rows[0].box_state) : 'available';
      out.push({ kind: 'box', number: doc.number, plate: doc.plate, state });
    } else if (doc.kind === 'passage') {
      out.push({ kind: 'passage', passageId: doc.passageId, chapter: doc.chapter, excerpt: String(doc.text ?? '').slice(0, 160) });
    }
  }
  return { hits: out };
}

export async function searchStaff(q: string): Promise<{ hits: StaffBoxDoc[] }> {
  const res = await staffIndex.search(q, { limit: 20 });
  const raw = res.hits as unknown as { document?: StaffBoxDoc }[];
  return {
    hits: raw.map((h) => {
      const d = h.document ?? (h as unknown as StaffBoxDoc);
      return { number: d.number, plate: d.plate, state: d.state, recipientName: d.recipientName, reference: d.reference };
    }),
  };
}
