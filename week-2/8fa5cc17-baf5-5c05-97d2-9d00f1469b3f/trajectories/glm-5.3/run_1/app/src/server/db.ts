// Database access: pool, schema application, idempotent seed data.

import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { hashPassword } from "./password.js";
import { sanitizeBody, plainText } from "../shared/richtext.js";
import { SCHEMA_SQL } from "./schema.js";

export interface Db {
  pool: Pool;
}

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 12 });
}

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

export async function seedIfEmpty(pool: Pool): Promise<void> {
  const ownerCount = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM owner_account");
  if (Number(ownerCount.rows[0].n) > 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await seedWorkspace(client);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function seedWorkspace(client: PoolClient): Promise<void> {
  const now = new Date().toISOString();
  const ownerId = randomUUID();
  const passwordHash = await hashPassword("commonplace-1847");
  await client.query(
    "INSERT INTO owner_account (id, email, email_norm, display_name, password_hash) VALUES ($1, $2, $3, $4, $5)",
    [ownerId, "tamsin@oakgall.test", "tamsin@oakgall.test", "Tamsin Okoro", passwordHash]
  );
  await client.query("INSERT INTO settings (id, home_time_zone, theme) VALUES (1, $1, $2)", ["Europe/London", "paper"]);

  // types in library order
  const typeSpecs: Array<{ name: string; builtin: boolean; order: number; fields: Array<{ name: string; kind: string; required: boolean; options: string[] | null; target: string | null }> }> = [
    { name: "Source", builtin: true, order: 0, fields: [
      { name: "Author", kind: "relation", required: false, options: null, target: "Person" },
      { name: "Year", kind: "number", required: false, options: null, target: null },
      { name: "Kind", kind: "select", required: false, options: ["Book", "Article", "Chapter", "Thesis"], target: null },
      { name: "Link", kind: "url", required: false, options: null, target: null },
    ] },
    { name: "Person", builtin: true, order: 1, fields: [{ name: "Affiliation", kind: "text", required: false, options: null, target: null }] },
    { name: "Concept", builtin: true, order: 2, fields: [{ name: "Definition", kind: "text", required: false, options: null, target: null }] },
    { name: "Daily note", builtin: true, order: 3, fields: [] },
  ];
  const typeIds = new Map<string, string>();
  for (const t of typeSpecs) {
    const id = randomUUID();
    typeIds.set(t.name, id);
    await client.query(
      "INSERT INTO object_types (id, name, builtin, library_order, created_at) VALUES ($1, $2, $3, $4, $5)",
      [id, t.name, t.builtin, t.order, now]
    );
  }
  // fields need all types to exist first (relation targets)
  for (const t of typeSpecs) {
    let pos = 0;
    for (const f of t.fields) {
      await client.query(
        "INSERT INTO type_fields (id, type_id, name, kind, required, options, target_type_id, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [randomUUID(), typeIds.get(t.name), f.name, f.kind, f.required, JSON.stringify(f.options), f.target ? typeIds.get(f.target) ?? null : null, pos]
      );
      pos += 1;
    }
  }

  // objects
  interface ObjSpec {
    title: string;
    type: string;
    properties: Record<string, unknown>;
    share: "follow" | "never";
    texts: string[];
    quotes: string[]; // titles of objects whose first text block to quote
  }
  const objectSpecs: ObjSpec[] = [
    { title: "Hesper Vane", type: "Person", properties: { Affiliation: "Collegium of Lower Fen" }, share: "follow", texts: [], quotes: [] },
    { title: "Odile Marchetti", type: "Person", properties: { Affiliation: "Saltmarsh Institute" }, share: "follow", texts: [], quotes: [] },
    { title: "The Gathered Margin", type: "Source", properties: { Author: "Hesper Vane", Year: 1987, Kind: "Book" }, share: "follow", texts: [
      "Every reader keeps two books: the one in hand and the one they write in its margins.",
      "A heading is a promise to return.",
    ], quotes: [] },
    { title: "Reading by Lamplight", type: "Source", properties: { Author: "Odile Marchetti", Year: 2011, Kind: "Article" }, share: "follow", texts: [
      "Lamplight narrows the page until only one line can be trusted at a time.",
    ], quotes: [] },
    { title: "Florilegium", type: "Concept", properties: { Definition: "A gathering of excerpts arranged for reuse." }, share: "follow", texts: [
      "Gathered under one heading, borrowed lines start to argue with each other.",
    ], quotes: ["The Gathered Margin", "Reading by Lamplight"] },
    { title: "Chapter three argument", type: "Concept", properties: { Definition: null }, share: "never", texts: [
      "The margin is where the argument starts, not where it ends.",
    ], quotes: ["Reading by Lamplight"] },
  ];

  const objectIds = new Map<string, string>();
  const firstTextBlocks = new Map<string, string>(); // title -> first block id
  for (const spec of objectSpecs) {
    const id = randomUUID();
    objectIds.set(spec.title, id);
    await client.query(
      "INSERT INTO objects (id, type_id, title, daily_date, share_visibility, created_at, updated_at) VALUES ($1, $2, $3, NULL, $4, $5, $5)",
      [id, typeIds.get(spec.type), spec.title, spec.share, now]
    );
    for (const [fieldName, value] of Object.entries(spec.properties)) {
      if (value === null) continue;
      let stored: unknown = value;
      if (fieldName === "Author") stored = objectIds.get(String(value)) ?? null;
      await client.query("INSERT INTO properties (object_id, field_name, value) VALUES ($1, $2, $3)", [id, fieldName, JSON.stringify(stored)]);
    }
    let position = 1;
    for (const text of spec.texts) {
      const blockId = randomUUID();
      const body = sanitizeBody(text);
      await client.query(
        "INSERT INTO blocks (id, object_id, kind, position, body, version, origin_block_id, attachment_id, created_at, updated_at) VALUES ($1, $2, 'text', $3, $4, 1, NULL, NULL, $5, $5)",
        [blockId, id, position, body, now]
      );
      await client.query(
        "INSERT INTO revisions (block_id, version, body, plain, label, ops, is_full, created_at) VALUES ($1, 1, $2, $3, 'Seed', NULL, TRUE, $4)",
        [blockId, body, plainText(body), now]
      );
      if (position === 1) firstTextBlocks.set(spec.title, blockId);
      position += 1;
    }
  }

  // quotes
  let edgeOrder = 0;
  for (const spec of objectSpecs) {
    let position = spec.texts.length + 1;
    for (const originTitle of spec.quotes) {
      const originBlockId = firstTextBlocks.get(originTitle);
      if (originBlockId === undefined) continue;
      const quoteBlockId = randomUUID();
      await client.query(
        "INSERT INTO blocks (id, object_id, kind, position, body, version, origin_block_id, attachment_id, created_at, updated_at) VALUES ($1, $2, 'quote', $3, '', 1, $4, NULL, $5, $5)",
        [quoteBlockId, objectIds.get(spec.title), position, originBlockId, now]
      );
      await client.query(
        "INSERT INTO link_edges (from_object_id, to_object_id, kind, block_id, field_name, created_at) VALUES ($1, $2, 'quote', $3, NULL, $4)",
        [objectIds.get(spec.title), objectIds.get(originTitle), quoteBlockId, now]
      );
      edgeOrder += 1;
      position += 1;
    }
  }

  // relation edges (Author)
  for (const spec of objectSpecs) {
    const author = spec.properties["Author"];
    if (author === undefined) continue;
    await client.query(
      "INSERT INTO link_edges (from_object_id, to_object_id, kind, block_id, field_name, created_at) VALUES ($1, $2, 'relation', NULL, 'Author', $3)",
      [objectIds.get(spec.title), objectIds.get(String(author)), now]
    );
    edgeOrder += 1;
  }

  // collection
  const collectionId = randomUUID();
  await client.query("INSERT INTO collections (id, name, created_at) VALUES ($1, $2, $3)", [collectionId, "Advisor reading — autumn", now]);
  for (const title of ["The Gathered Margin", "Florilegium", "Chapter three argument"]) {
    await client.query("INSERT INTO collection_members (collection_id, object_id) VALUES ($1, $2)", [collectionId, objectIds.get(title)]);
  }

  // saved query
  await client.query(
    "INSERT INTO saved_queries (id, name, type_id, text, group_by, sort, created_at) VALUES ($1, $2, $3, '', NULL, $4, $5)",
    [randomUUID(), "Sources by backlinks", typeIds.get("Source"), JSON.stringify([{ key: "@backlinks", dir: "desc" }]), now]
  );
}
