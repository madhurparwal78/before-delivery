import type { Reply } from "./context.js";
import { createUser, signUpProblems, takenFields } from "./accounts.js";
import { transaction, type Tx } from "./db.js";
import { ApiError, validation } from "./errors.js";
import { checkTags, checkTitle, checkVisibility, insertPen } from "./pens.js";
import { newId } from "./ids.js";
import { integerOrNull, saveVersion } from "./versions.js";

type Entry = Record<string, unknown>;

function entries(raw: unknown, name: string): Entry[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))) {
    throw validation({ [name]: `Send ${name} as a list of objects.` });
  }
  return raw as Entry[];
}

function text(entry: Entry, field: string): string {
  const value = entry[field];
  if (typeof value !== "string") throw validation({ [field]: `Send ${field} as text.` });
  return value;
}

async function userId(tx: Tx, known: Map<string, string>, handle: string): Promise<string> {
  const cached = known.get(handle);
  if (cached) return cached;
  const found = await tx.query<{ id: string }>("SELECT id FROM users WHERE handle = $1", [handle]);
  const row = found.rows[0];
  if (!row) throw validation({ owner: `${handle} is not a known handle.` });
  known.set(handle, row.id);
  return row.id;
}

function forkedFrom(raw: unknown, penIds: Map<string, string>): { pen: string; version: number } {
  const lineage = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pen = typeof lineage["key"] === "string" ? penIds.get(lineage["key"]) : undefined;
  const version = integerOrNull(lineage["version"]);
  if (pen === undefined || version === null) throw validation({ forked_from: "Fork from a pen listed earlier, with a version number." });
  return { pen, version };
}

function memberKeys(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((key) => typeof key === "string")) throw validation({ collections: "List the pens of a collection by key." });
  return raw;
}

function createdAt(entry: Entry, previous: Date | undefined): Date | undefined {
  if (entry["created_at"] === undefined) return undefined;
  const moment = new Date(text(entry, "created_at"));
  if (Number.isNaN(moment.getTime()) || (previous !== undefined && moment <= previous)) {
    throw validation({ created_at: "Version times must be dates that increase along the list." });
  }
  return moment;
}

export async function seedGrading(body: Entry): Promise<Reply> {
  const users = entries(body["users"], "users");
  const pens = entries(body["pens"], "pens");
  const likes = entries(body["likes"], "likes");
  const collections = entries(body["collections"], "collections");

  const taken: Record<string, string> = {};
  for (const user of users) Object.assign(taken, await takenFields(text(user, "handle"), text(user, "email")));
  if (Object.keys(taken).length > 0) throw new ApiError("duplicate", Object.values(taken)[0] as string, { fields: taken });

  return transaction(async (tx) => {
    const handles = new Map<string, string>();
    const created: Record<string, string> = {};
    for (const user of users) {
      const handle = text(user, "handle");
      const email = text(user, "email");
      const password = text(user, "password");
      const problems = signUpProblems(handle, email, password);
      if (Object.keys(problems).length > 0) throw validation(problems);
      const account = await createUser(tx, { handle, email, password, verified: user["verified"] === true });
      handles.set(handle, account.id);
      created[handle] = account.id;
    }

    const penIds = new Map<string, string>();
    for (const pen of pens) {
      const key = text(pen, "key");
      const lineage = pen["forked_from"] === undefined ? undefined : forkedFrom(pen["forked_from"], penIds);
      const id = await insertPen(tx, {
        ownerId: await userId(tx, handles, text(pen, "owner")),
        title: checkTitle(pen["title"]),
        visibility: pen["visibility"] === undefined ? "private" : checkVisibility(pen["visibility"]),
        tags: pen["tags"] === undefined ? [] : checkTags(pen["tags"]),
        forkOf: lineage,
      });
      penIds.set(key, id);
      let previous: Date | undefined;
      for (const [index, version] of entries(pen["versions"], "versions").entries()) {
        previous = createdAt(version, previous);
        await saveVersion(tx, {
          penId: id,
          base: index,
          content: async () => ({ files: version["files"], libraries: version["libraries"] ?? [] }),
          createdAt: previous,
        });
      }
    }

    for (const like of likes) {
      const pen = penIds.get(text(like, "pen"));
      if (pen === undefined) throw validation({ likes: "Like a pen listed in this call." });
      await tx.query("INSERT INTO pen_likes (pen_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [
        pen,
        await userId(tx, handles, text(like, "user")),
      ]);
    }

    const collectionIds: Record<string, string> = {};
    for (const collection of collections) {
      const id = newId();
      await tx.query("INSERT INTO collections (id, owner_id, title) VALUES ($1, $2, $3)", [
        id,
        await userId(tx, handles, text(collection, "owner")),
        checkTitle(collection["title"], "collection"),
      ]);
      for (const [position, member] of memberKeys(collection["pens"]).entries()) {
        const pen = penIds.get(member);
        if (pen === undefined) throw validation({ collections: "Collect pens listed in this call." });
        await tx.query("INSERT INTO collection_pens (collection_id, pen_id, position) VALUES ($1, $2, $3)", [id, pen, position]);
      }
      collectionIds[text(collection, "key")] = id;
    }

    return { status: 201, body: { users: created, pens: Object.fromEntries(penIds), collections: collectionIds } };
  });
}
