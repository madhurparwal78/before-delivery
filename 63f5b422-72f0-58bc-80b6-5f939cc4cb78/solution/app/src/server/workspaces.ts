import { slugify } from "../shared/apply.js";
import { invalid, notFound } from "../shared/errors.js";
import type { DocBody, Role, WorkspaceDoc } from "../shared/types.js";
import { all, newId, one, pool, type Db } from "./db.js";

/** The tokens every new workspace starts with (Seed data). */
const DEFAULT_TOKENS: WorkspaceDoc["tokens"] = [
  { name: "ink", kind: "color", value: "black" },
  { name: "paper", kind: "color", value: "white" },
  { name: "space-md", kind: "size", value: 16, unit: "px" },
  { name: "size-xl", kind: "size", value: 40, unit: "px" },
];

async function takenSlugs(db: Db): Promise<Set<string>> {
  return new Set((await all<{ slug: string }>(db, "SELECT slug FROM workspaces")).map((r) => r.slug));
}

/** Store a new workspace document and its owner. The slug is unique among workspaces. */
export async function insertWorkspace(db: Db, body: Omit<DocBody, "id" | "slug">, ownerId: string): Promise<WorkspaceDoc> {
  await db.query("LOCK TABLE workspaces IN SHARE ROW EXCLUSIVE MODE");
  const slug = slugify(body.name, await takenSlugs(db));
  const doc: WorkspaceDoc = { id: newId("w"), name: body.name, slug, seq: 0, tokens: body.tokens, pages: body.pages, components: body.components, collection: body.collection };
  await db.query("INSERT INTO workspaces (id, slug, seq, doc) VALUES ($1, $2, 0, $3)", [doc.id, slug, JSON.stringify(doc)]);
  await db.query("INSERT INTO members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [doc.id, ownerId]);
  return doc;
}

function nameProblem(name: unknown): string | null {
  return typeof name === "string" && name.trim().length >= 1 && name.length <= 80 ? null : "A name is 1 to 80 characters.";
}

function starterDocument(name: string): Omit<DocBody, "id" | "slug"> {
  return {
    name,
    tokens: structuredClone(DEFAULT_TOKENS),
    pages: [
      {
        id: newId("pg"),
        name: "Home",
        slug: "home",
        order: 0,
        root: { id: newId("n"), type: "page", name: "Home", props: {}, styles: { desktop: {}, tablet: {}, phone: {} }, children: [] },
      },
    ],
    components: [],
    collection: { name: "Entries", fields: [], entries: [] },
  };
}

export async function createWorkspace(db: Db, rawName: unknown, ownerId: string): Promise<WorkspaceDoc> {
  const problem = nameProblem(rawName);
  if (problem) throw invalid({ name: problem });
  return insertWorkspace(db, starterDocument((rawName as string).trim()), ownerId);
}

export async function loadDoc(workspaceId: string, db: Db = pool): Promise<WorkspaceDoc> {
  const row = await one<{ doc: WorkspaceDoc; seq: number }>(db, "SELECT doc, seq FROM workspaces WHERE id = $1", [workspaceId]);
  if (!row) throw notFound();
  return { ...row.doc, seq: row.seq };
}

export async function workspacesOf(userId: string): Promise<{ id: string; name: string; slug: string; role: Role }[]> {
  return all(
    pool,
    "SELECT w.id, w.doc->>'name' AS name, w.slug, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = $1 ORDER BY m.joined_at, w.created_at",
    [userId],
  );
}
