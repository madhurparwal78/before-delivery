import { timingSafeEqual } from "node:crypto";
import type { JsonObject, JsonValue } from "../../shared/json.js";
import { isObject } from "../../shared/json.js";
import { hashPassword } from "../auth.js";
import { config } from "../config.js";
import { transaction } from "../db.js";
import { asDocument } from "../engine/document.js";
import { defaultIndexName, parseIndexKeys } from "../engine/indexes.js";
import { compact } from "../engine/value.js";
import { parseValidator } from "../engine/validator.js";
import { fail } from "../errors.js";
import { route } from "../http.js";
import { createIndex, insertDocuments, prepareDocument } from "../store.js";
import { normalEmail } from "./accounts.js";
import { collectionName } from "./projects.js";
import { compileQuery } from "./queries.js";

/** The key-protected grading route: confirmed users, projects, members, collections and their contents in one call. */

const list = (value: JsonValue | undefined, field: string): JsonValue[] => (value === undefined ? [] : Array.isArray(value) ? value : fail("invalid_field", { field }));
const entry = (value: JsonValue | undefined, field: string): JsonObject => (isObject(value) ? value : fail("invalid_field", { field }));
const word = (value: JsonValue | undefined, field: string): string => (typeof value === "string" && value !== "" ? value : fail("invalid_field", { field }));

function keyMatches(given: string | string[] | undefined): boolean {
  if (typeof given !== "string" || config.gradingKey === "") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(config.gradingKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

route(
  "POST",
  "/api/grading/seed",
  async (ctx) => {
    if (!keyMatches(ctx.req.headers["x-grading-key"])) fail("not_found");
    const body = ctx.object();
    const hashed = await Promise.all(
      list(body["users"], "users").map(async (raw) => {
        const user = entry(raw, "users");
        const email = normalEmail(user["email"]);
        if (email === null) fail("invalid_field", { field: "email" });
        return { email, name: word(user["name"], "name"), hash: await hashPassword(word(user["password"], "password")) };
      }),
    );
    const answer = await transaction(async (client) => {
      const userIds = new Map<string, string>();
      for (const user of hashed) {
        const created = await client.query<{ id: string }>(
          "INSERT INTO users (email, name, password_hash, confirmed) VALUES ($1, $2, $3, true) ON CONFLICT (email) DO NOTHING RETURNING id",
          [user.email, user.name, user.hash],
        );
        if (!created.rows[0]) return fail("email_taken");
        userIds.set(user.email, created.rows[0].id);
      }
      const answer: JsonObject = { users: Object.fromEntries(userIds), projects: {} };
      const known = async (raw: JsonValue | undefined, field: string): Promise<string> => {
        const email = normalEmail(raw);
        if (email === null) return fail("invalid_field", { field });
        const id = userIds.get(email) ?? (await client.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email])).rows[0]?.id;
        return id ?? fail("invalid_field", { field });
      };
      for (const rawProject of list(body["projects"], "projects")) {
        const spec = entry(rawProject, "projects");
        const name = word(spec["name"], "name");
        const ownerId = await known(spec["owner"], "owner");
        const taken = await client.query("SELECT 1 FROM projects WHERE owner_id = $1 AND name = $2", [ownerId, name]);
        if (taken.rowCount) return fail("name_taken");
        const project = (await client.query<{ id: string }>("INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id", [name, ownerId])).rows[0] as { id: string };
        await client.query("INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, 'owner')", [project.id, ownerId]);
        for (const rawMember of list(spec["members"], "members")) {
          const member = entry(rawMember, "members");
          const role = member["role"];
          if (role !== "editor" && role !== "reader") fail("invalid_field", { field: "role" });
          await client.query("INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [project.id, await known(member["email"], "email"), role]);
        }
        const collections: JsonObject = {};
        for (const rawCollection of list(spec["collections"], "collections")) {
          const content = entry(rawCollection, "collections");
          const collectionLabel = collectionName(content["name"], "name");
          const created = (await client.query<{ id: string }>("INSERT INTO collections (project_id, name) VALUES ($1, $2) RETURNING id", [project.id, collectionLabel])).rows[0] as { id: string };
          const rules = { id: created.id, validator: null };
          const docs = list(content["documents"], "documents").map((raw) => prepareDocument(asDocument(raw, "documents"), rules, false));
          if (docs.length > 0) await insertDocuments(client, created.id, docs);
          for (const rawIndex of list(content["indexes"], "indexes")) {
            const index = entry(rawIndex, "indexes");
            const keys = parseIndexKeys(index["keys"]);
            await createIndex(client, created.id, { name: typeof index["name"] === "string" ? index["name"] : defaultIndexName(keys), keys, unique: index["unique"] === true });
          }
          const validator = content["validator"] === undefined || content["validator"] === null ? null : parseValidator(content["validator"]);
          if (validator !== null) await client.query("UPDATE collections SET validator = $2 WHERE id = $1", [created.id, compact(validator)]);
          const queries: JsonObject = {};
          for (const rawQuery of list(content["saved_queries"], "saved_queries")) {
            const saved = entry(rawQuery, "saved_queries");
            const { spec: query } = compileQuery(saved);
            const row = await client.query<{ id: string }>(
              "INSERT INTO saved_queries (collection_id, name, filter, projection, sort, query_limit) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
              [created.id, word(saved["name"], "name"), compact(query.filter), query.projection && compact(query.projection), query.sort && compact(query.sort), query.limit],
            );
            queries[word(saved["name"], "name")] = (row.rows[0] as { id: string }).id;
          }
          collections[collectionLabel] = { id: created.id, documents: docs.map((doc) => doc["_id"] as string), saved_queries: queries };
        }
        (answer["projects"] as JsonObject)[name] = { id: project.id, collections };
      }
      return answer;
    });
    return { status: 201, body: answer };
  },
  "grading",
);
