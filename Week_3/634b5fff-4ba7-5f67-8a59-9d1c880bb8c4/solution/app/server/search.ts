import { plateOf } from "../shared/domain.js";
import { TALE } from "../shared/tale.js";
import { config, named } from "./config.js";

/** Meilisearch: typo-tolerant public search over the tale and unsold boxes, staff search over every box. */

export class SearchUnreachable extends Error {
  constructor() {
    super("search unreachable");
  }
}

const PUBLIC = (): string => named("press_public");
const STAFF = (): string => named("press_staff");

const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> => {
  let response: Response;
  try {
    response = await fetch(`${config.meili.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${config.meili.apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new SearchUnreachable();
  }
  if (response.status >= 500) throw new SearchUnreachable();
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const accepted = (reply: { status: number }): void => {
  if (reply.status >= 400) throw new SearchUnreachable();
};

const ensureIndex = async (uid: string, searchable: string[]): Promise<void> => {
  accepted(await call("POST", "/indexes", { uid, primaryKey: "id" }));
  accepted(await call("PUT", `/indexes/${uid}/settings/searchable-attributes`, searchable));
};

interface PublicBoxDocument { id: string; kind: "box"; number: number; plate: string }
export interface StaffBoxDocument {
  id: string; number: number; plate: string; state: string; recipientName: string | null; reference: string | null;
}

/** Creates both indexes with their searchable attributes and the tale passages; safe to repeat. */
export const prepareIndexes = async (): Promise<void> => {
  await ensureIndex(PUBLIC(), ["text", "number", "plate"]);
  await ensureIndex(STAFF(), ["number", "plate", "recipientName"]);
  accepted(await call("POST", `/indexes/${PUBLIC()}/documents`, TALE.map((passage) => ({
    id: passage.passageId, kind: "passage", passageId: passage.passageId, chapter: passage.chapter, text: passage.text,
  }))));
};

export const upsertPublicBoxes = async (numbers: number[]): Promise<void> => {
  if (numbers.length === 0) return;
  accepted(await call("POST", `/indexes/${PUBLIC()}/documents`, numbers.map((number): PublicBoxDocument => ({
    id: `box-${number}`, kind: "box", number, plate: plateOf(number),
  }))));
};

export const removePublicBoxes = async (numbers: number[]): Promise<void> => {
  if (numbers.length === 0) return;
  accepted(await call("POST", `/indexes/${PUBLIC()}/documents/delete-batch`, numbers.map((number) => `box-${number}`)));
};

export const upsertStaffBoxes = async (documents: StaffBoxDocument[]): Promise<void> => {
  if (documents.length === 0) return;
  accepted(await call("POST", `/indexes/${STAFF()}/documents`, documents));
};

interface RawPublicHit {
  kind: "passage" | "box";
  id: string;
  number?: number;
  plate?: string;
  passageId?: string;
  chapter?: string;
  excerpt?: string;
}

export const searchPublic = async (query: string): Promise<RawPublicHit[]> => {
  const reply = await call("POST", `/indexes/${PUBLIC()}/search`, {
    q: query, limit: 20, attributesToCrop: ["text"], cropLength: 28, attributesToHighlight: ["text"],
    highlightPreTag: "", highlightPostTag: "",
  });
  accepted(reply);
  const hits = (reply.body as { hits: (RawPublicHit & { _formatted?: { text?: string } })[] }).hits;
  return hits.map((hit) => ({
    kind: hit.kind, id: hit.id, number: hit.number, plate: hit.plate, passageId: hit.passageId, chapter: hit.chapter,
    excerpt: hit._formatted?.text,
  }));
};

export const searchStaff = async (query: string): Promise<StaffBoxDocument[]> => {
  const reply = await call("POST", `/indexes/${STAFF()}/search`, { q: query, limit: 50 });
  accepted(reply);
  return (reply.body as { hits: StaffBoxDocument[] }).hits;
};

