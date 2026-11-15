import { accountDuplicates, accountFieldErrors, emailKey } from "./accounts";
import { hashPassword, newId } from "./auth";
import { transaction } from "./db";
import { ApiError, StorageUnavailable, validation } from "./errors";
import { json, readJson, type Context, type Reply } from "./http";
import { tagsError, titleError } from "./pens";
import { appendVersion, parseSnapshot, type Snapshot } from "./versions";

type Seed = Record<string, unknown>;

function list(value: unknown, name: string): Seed[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
    throw validation({ [name]: `Send ${name} as a list of objects.` });
  }
  return value as Seed[];
}

interface SeedVersion {
  snapshot: Snapshot;
  createdAt: Date | null;
}

function seedVersions(pen: Seed, key: string): SeedVersion[] {
  const versions = list(pen.versions, `pens.${key}.versions`).map((version) => {
    const createdAt = version.created_at === undefined ? null : new Date(String(version.created_at));
    if (createdAt && Number.isNaN(createdAt.getTime())) throw validation({ [`pens.${key}.versions`]: "created_at must be an ISO time." });
    return { snapshot: parseSnapshot(version), createdAt };
  });
  for (let index = 1; index < versions.length; index += 1) {
    const previous = versions[index - 1]?.createdAt;
    const current = versions[index]?.createdAt;
    if (previous && current && current.getTime() <= previous.getTime()) {
      throw validation({ [`pens.${key}.versions`]: "created_at values must increase along the list." });
    }
  }
  return versions;
}

export async function gradingSeed(ctx: Context): Promise<Reply> {
  const body = readJson(ctx);
  const users = list(body.users, "users");
  const pens = list(body.pens, "pens");
  const likes = list(body.likes, "likes");
  const collections = list(body.collections, "collections");

  const handles = new Set<string>();
  for (const user of users) {
    const duplicates = await accountDuplicates(user.handle, user.email);
    if (Object.keys(duplicates).length > 0 || handles.has(String(user.handle))) throw new ApiError("duplicate", { fields: duplicates });
    const fields = accountFieldErrors(user.handle, user.email, "seeded accounts may use any password");
    if (Object.keys(fields).length > 0) throw validation(fields);
    handles.add(String(user.handle));
  }

  const penKeys = new Set<string>();
  const plannedPens = pens.map((pen) => {
    const key = String(pen.key ?? "");
    if (key === "" || penKeys.has(key)) throw validation({ pens: "Each pen needs a distinct key." });
    const title = pen.title ?? "Untitled pen";
    const visibility = pen.visibility ?? "private";
    const tags = pen.tags ?? [];
    const fields: Record<string, string> = {};
    const titleProblem = titleError(title);
    if (titleProblem) fields[`pens.${key}.title`] = titleProblem;
    if (!["private", "unlisted", "public"].includes(String(visibility))) fields[`pens.${key}.visibility`] = "Choose private, unlisted or public.";
    const tagProblem = tagsError(tags);
    if (tagProblem) fields[`pens.${key}.tags`] = tagProblem;
    if (typeof pen.owner !== "string") fields[`pens.${key}.owner`] = "Name the owner's handle.";
    const forked = pen.forked_from as Seed | undefined;
    if (forked !== undefined && (typeof forked !== "object" || forked === null || !penKeys.has(String(forked.key)) || !Number.isInteger(forked.version))) {
      fields[`pens.${key}.forked_from`] = "forked_from must name an earlier pen key and a version.";
    }
    if (Object.keys(fields).length > 0) throw validation(fields);
    penKeys.add(key);
    return {
      key,
      id: newId(),
      owner: pen.owner as string,
      title: title as string,
      visibility: visibility as string,
      tags: tags as string[],
      versions: seedVersions(pen, key),
      forkedFrom: forked ? { key: String(forked.key), version: forked.version as number } : null,
    };
  });

  const userIds: Record<string, string> = {};
  const penIds: Record<string, string> = Object.fromEntries(plannedPens.map((pen) => [pen.key, pen.id]));
  const collectionIds: Record<string, string> = {};

  try {
    await transaction(async (client) => {
      for (const user of users) {
        const id = newId();
        const passwordHash = typeof user.password === "string" ? await hashPassword(user.password) : null;
        await client.query("INSERT INTO users (id, handle, email, email_key, password_hash, verified) VALUES ($1, $2, $3, $4, $5, $6)", [
          id,
          user.handle,
          user.email,
          emailKey(String(user.email)),
          passwordHash,
          user.verified === true,
        ]);
        userIds[String(user.handle)] = id;
      }
      const userId = async (handle: unknown): Promise<string> => {
        const found = await client.query<{ id: string }>("SELECT id FROM users WHERE handle = $1", [handle]);
        const id = found.rows[0]?.id;
        if (!id) throw validation({ user: `No account has the handle ${String(handle)}.` });
        return id;
      };
      for (const pen of plannedPens) {
        await client.query(
          "INSERT INTO pens (id, owner_id, title, visibility, tags, forked_from_pen, forked_from_version) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [pen.id, await userId(pen.owner), pen.title, pen.visibility, pen.tags, pen.forkedFrom ? penIds[pen.forkedFrom.key] : null, pen.forkedFrom?.version ?? null],
        );
        let head = 0;
        for (const version of pen.versions) {
          await appendVersion(client, { id: pen.id, head }, version.snapshot, null, version.createdAt);
          head += 1;
        }
      }
      for (const like of likes) {
        const penId = penIds[String(like.pen)];
        if (!penId) throw validation({ likes: `No pen in this call has the key ${String(like.pen)}.` });
        await client.query("INSERT INTO likes (user_id, pen_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [await userId(like.user), penId]);
      }
      for (const collection of collections) {
        const id = newId();
        const title = collection.title ?? "Untitled collection";
        await client.query("INSERT INTO collections (id, owner_id, title) VALUES ($1, $2, $3)", [id, await userId(collection.owner), String(title)]);
        const members = Array.isArray(collection.pens) ? collection.pens : [];
        for (const [position, key] of members.entries()) {
          const penId = penIds[String(key)];
          if (!penId) throw validation({ collections: `No pen in this call has the key ${String(key)}.` });
          await client.query("INSERT INTO collection_pens (collection_id, pen_id, position) VALUES ($1, $2, $3)", [id, penId, position]);
        }
        collectionIds[String(collection.key)] = id;
      }
    });
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError("storage_unavailable", { message: "Storage is unreachable, so the versions were not seeded." });
    throw error;
  }
  return json(201, { users: userIds, pens: penIds, collections: collectionIds });
}
