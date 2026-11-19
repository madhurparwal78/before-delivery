import type { JsonObject, JsonValue } from "../../shared/json.js";
import { openCollection, requireOwner } from "../access.js";
import { config } from "../config.js";
import { db, transaction } from "../db.js";
import { defaultIndexName, parseIndexKeys } from "../engine/indexes.js";
import { summariseSchema } from "../engine/schema.js";
import { compact, isPlainObject } from "../engine/value.js";
import { parseValidator } from "../engine/validator.js";
import { fail } from "../errors.js";
import { route } from "../http.js";
import { ID_INDEX, createIndex, dropIndex, loadIndexes } from "../store.js";

/** Indexes, validation rules and the schema summary. */

const base = "/api/projects/:pid/collections/:cid";

route("GET", `${base}/indexes`, async (ctx) => {
  const { collection } = await openCollection(ctx);
  const indexes = await loadIndexes(db, collection.id);
  return { status: 200, body: { indexes: indexes.map((index) => ({ name: index.name, keys: index.keys, unique: index.unique })) } };
});

route("POST", `${base}/indexes`, async (ctx) => {
  const { role, collection } = await openCollection(ctx);
  requireOwner(role);
  const body = ctx.object();
  const keys = parseIndexKeys(body["keys"]);
  const unique = body["unique"] === undefined ? false : body["unique"];
  if (typeof unique !== "boolean") fail("invalid_field", { field: "unique" });
  const named = body["name"];
  if (named !== undefined && (typeof named !== "string" || named === "")) fail("invalid_index");
  const definition = { name: (named as string | undefined) ?? defaultIndexName(keys), keys, unique: unique as boolean };
  await transaction((client) => createIndex(client, collection.id, definition));
  return { status: 201, body: { index: definition } };
});

route("DELETE", `${base}/indexes/:name`, async (ctx) => {
  const { role, collection } = await openCollection(ctx);
  requireOwner(role);
  const name = ctx.params["name"] as string;
  if (name === ID_INDEX.name) fail("cannot_drop_id_index");
  await transaction((client) => dropIndex(client, collection.id, name));
  return { status: 204 };
});

route("GET", `${base}/validator`, async (ctx) => {
  const { collection } = await openCollection(ctx);
  return { status: 200, body: { validator: collection.validator } };
});

route("PUT", `${base}/validator`, async (ctx) => {
  const { role, collection } = await openCollection(ctx);
  requireOwner(role);
  const body = ctx.object();
  if (!("validator" in body)) fail("invalid_field", { field: "validator" });
  const value = body["validator"] as JsonValue;
  const validator: JsonObject | null = value === null ? null : parseValidator(value);
  await db.query("UPDATE collections SET validator = $2 WHERE id = $1", [collection.id, validator === null ? null : compact(validator)]);
  return { status: 200, body: { validator } };
});

route("GET", `${base}/schema`, async (ctx) => {
  const { collection } = await openCollection(ctx);
  const result = await db.query<{ body: string }>("SELECT body FROM documents WHERE collection_id = $1 ORDER BY id LIMIT $2", [collection.id, config.limits.schemaSample]);
  const sample = result.rows.map((row) => JSON.parse(row.body) as JsonObject).filter((doc) => isPlainObject(doc));
  return { status: 200, body: { sampled: sample.length, fields: summariseSchema(sample) } };
});

