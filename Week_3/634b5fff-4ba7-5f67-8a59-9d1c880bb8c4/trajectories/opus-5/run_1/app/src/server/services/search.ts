import { MeiliSearch } from 'meilisearch';
import { config, names } from '../config.js';

export class SearchUnreachable extends Error {}

const client = new MeiliSearch({ host: config.meilisearch.url, apiKey: config.meilisearch.apiKey });

export interface PassageDocument {
  id: string;
  kind: 'passage';
  passageId: string;
  chapter: string;
  text: string;
}

export interface PublicBoxDocument {
  id: string;
  kind: 'box';
  number: number;
  plate: string;
}

export interface StaffBoxDocument {
  id: string;
  number: number;
  plate: string;
  state: string;
  recipientName: string | null;
  reference: string | null;
}

function wrap(error: unknown): never {
  throw new SearchUnreachable(String(error));
}

export async function ensureIndexes(): Promise<void> {
  await client.createIndex(names.publicIndex, { primaryKey: 'id' }).catch(() => undefined);
  await client.createIndex(names.staffIndex, { primaryKey: 'id' }).catch(() => undefined);
  await client.index(names.publicIndex).updateSettings({
    searchableAttributes: ['text', 'number', 'plate'],
    filterableAttributes: ['kind'],
    typoTolerance: { enabled: true },
  });
  await client.index(names.staffIndex).updateSettings({
    searchableAttributes: ['number', 'plate', 'recipientName'],
    filterableAttributes: ['state'],
    typoTolerance: { enabled: true },
  });
}

export async function putPassages(documents: PassageDocument[]): Promise<void> {
  try {
    await client.index(names.publicIndex).addDocuments(documents);
  } catch (error) {
    wrap(error);
  }
}

export async function putPublicBoxes(documents: PublicBoxDocument[]): Promise<void> {
  try {
    await client.index(names.publicIndex).addDocuments(documents);
  } catch (error) {
    wrap(error);
  }
}

export async function removePublicBoxes(boxNumbers: number[]): Promise<void> {
  try {
    await client.index(names.publicIndex).deleteDocuments(boxNumbers.map((number) => `box-${number}`));
  } catch (error) {
    wrap(error);
  }
}

export async function putStaffBoxes(documents: StaffBoxDocument[]): Promise<void> {
  try {
    await client.index(names.staffIndex).addDocuments(documents);
  } catch (error) {
    wrap(error);
  }
}

export type PublicDocument = PassageDocument | PublicBoxDocument;

export async function searchPublic(text: string): Promise<PublicDocument[]> {
  try {
    const reply = await client.index(names.publicIndex).search(text, { limit: 20 });
    return reply.hits as unknown as PublicDocument[];
  } catch (error) {
    wrap(error);
  }
}

export async function searchStaff(text: string): Promise<StaffBoxDocument[]> {
  try {
    const reply = await client.index(names.staffIndex).search(text, { limit: 20 });
    return reply.hits as unknown as StaffBoxDocument[];
  } catch (error) {
    wrap(error);
  }
}
