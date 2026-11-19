import { createHash } from "node:crypto";
import type { Value } from "../shared/expression.js";
import { now } from "./clock.js";
import { compile } from "./conditions.js";
import { evaluate } from "../shared/expression.js";
import type { Env } from "./env.js";
import { fail, notFound, validation } from "./errors.js";
import { publish } from "./live.js";
import { nextSequence, pad } from "./db.js";
import { applyPolicies } from "./rules.js";
import { findRecord, nowIso, save } from "./records.js";
import { configList } from "./store.js";
import { startItemFlow } from "./workflows.js";
import { recordScope } from "./world.js";

export interface Variable {
  name: string;
  label: string;
  type: "text" | "multiline" | "select" | "checkbox" | "date" | "number" | "reference";
  required: boolean;
  default: Value | { requester: "department" };
  choices: { value: string; label: string; when: { variable: string; equals: string } | null }[];
}

export interface CatalogItem {
  id: string;
  name: string;
  variables: Variable[];
  workflow: string;
}

export interface Guide {
  id: string;
  name: string;
  questions: Variable[];
  rules: { item: string; condition: string }[];
}

export async function loadItems(env: Env): Promise<CatalogItem[]> {
  return (await configList<CatalogItem>("catalog_item", "live", env.tx)).map((r) => r.content);
}

export async function itemById(env: Env, id: string): Promise<CatalogItem | undefined> {
  return (await loadItems(env)).find((i) => i.id === id);
}

/** Item with each default resolved for the person looking at it. */
export function resolveDefaults(env: Env, item: CatalogItem): CatalogItem {
  return {
    ...item,
    variables: item.variables.map((v) => ({
      ...v,
      default: typeof v.default === "object" && v.default !== null && !Array.isArray(v.default) ? (v.default.requester === "department" ? env.user.department : null) : v.default,
    })),
  };
}

function offeredChoices(variable: Variable, values: Record<string, Value>): Variable["choices"] {
  return variable.choices.filter((c) => c.when === null || String(values[c.when.variable] ?? "") === c.when.equals);
}

const EMPTY = (v: Value | undefined): boolean => v === undefined || v === null || v === "";

/** Checks submitted values against the variables, their offered choices, and the item's form policies. */
async function validateVariables(env: Env, item: CatalogItem, submitted: Record<string, Value>): Promise<Record<string, Value>> {
  const resolved = resolveDefaults(env, item);
  const values: Record<string, Value> = { ...submitted };
  for (const v of resolved.variables) if (EMPTY(values[v.name]) && !EMPTY(v.default as Value)) values[v.name] = v.default as Value;
  const policies = await env.formPolicies();
  const states = applyPolicies(policies, recordScope(env.world, { table: "request_item", number: null, fields: {} }, env.actorRef, { variables: values }), null, item.id);
  const errors: Record<string, string> = {};
  const clean: Record<string, Value> = {};
  for (const v of resolved.variables) {
    const state = states[v.name] ?? {};
    let value = values[v.name] ?? null;
    if (state.visible === false) {
      continue;
    }
    if (state.read_only && submitted[v.name] !== undefined && submitted[v.name] !== (v.default as Value)) errors[v.name] = `${v.label} is read-only.`;
    if (EMPTY(value)) {
      if (v.required || state.mandatory) errors[v.name] = `${v.label} is required.`;
      continue;
    }
    if (v.type === "select") {
      const offered = offeredChoices(v, values);
      if (!offered.some((c) => c.value === String(value))) errors[v.name] = `${v.label} must be one of ${offered.map((c) => c.label).join(", ")}.`;
      value = String(value);
    } else if (v.type === "number" && typeof value !== "number") {
      errors[v.name] = `${v.label} must be a number.`;
    } else if (v.type === "checkbox" && typeof value !== "boolean") {
      errors[v.name] = `${v.label} must be true or false.`;
    } else if (v.type === "date" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
      errors[v.name] = `${v.label} must be a date such as 2027-01-31.`;
    }
    clean[v.name] = value;
  }
  if (Object.keys(errors).length > 0) fail(422, "validation", `${Object.keys(errors).length} problems to fix before saving.`, errors);
  return clean;
}

export async function addCartLine(env: Env, body: { item?: string; quantity?: number; variables?: Record<string, Value> }): Promise<{ id: number; item: string; quantity: number; variables: Record<string, Value> }> {
  const item = typeof body.item === "string" ? await itemById(env, body.item) : undefined;
  if (!item) return validation("Choose a catalog item.", { item: "Choose a catalog item." });
  const quantity = body.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return validation("Quantity must be a whole number from 1 to 10.", { quantity: "Quantity must be a whole number from 1 to 10." });
  const variables = await validateVariables(env, item, body.variables ?? {});
  const rows = await env.tx.query<{ id: number }>("INSERT INTO cart_lines (username, item, quantity, variables) VALUES ($1, $2, $3, $4) RETURNING id", [env.user.username, item.id, quantity, JSON.stringify(variables)]);
  return { id: rows[0]!.id, item: item.id, quantity, variables };
}

export async function cartLines(env: Env): Promise<Array<{ id: number; item: string; quantity: number; variables: Record<string, Value> }>> {
  const rows = await env.tx.query("SELECT * FROM cart_lines WHERE username = $1 ORDER BY id", [env.user.username]);
  return rows.map((r) => ({ id: r.id as number, item: r.item as string, quantity: r.quantity as number, variables: r.variables as Record<string, Value> }));
}

export async function removeCartLine(env: Env, id: number): Promise<void> {
  const rows = await env.tx.query("DELETE FROM cart_lines WHERE id = $1 AND username = $2 RETURNING id", [id, env.user.username]);
  if (rows.length === 0) notFound();
}

export async function resolveGuide(env: Env, guide: Guide, answers: Record<string, Value>): Promise<string[]> {
  const errors: Record<string, string> = {};
  for (const q of guide.questions) {
    const value = answers[q.name];
    if (EMPTY(value)) {
      if (q.required || q.type === "select") errors[q.name] = `${q.label} is required.`;
    } else if (q.type === "select" && !offeredChoices(q, answers).some((c) => c.value === String(value))) {
      errors[q.name] = `${q.label} must be one of ${offeredChoices(q, answers).map((c) => c.label).join(", ")}.`;
    }
  }
  if (Object.keys(errors).length > 0) fail(422, "validation", `${Object.keys(errors).length} problems to fix before saving.`, errors);
  const scope = recordScope(env.world, { table: "request_item", number: null, fields: {} }, env.actorRef, { answers });
  return guide.rules.filter((r) => evaluate(compile(r.condition), scope) === true).map((r) => r.item);
}

export async function loadGuide(env: Env, id: string): Promise<Guide | null> {
  const rows = await env.tx.query("SELECT * FROM guides WHERE id = $1", [id]);
  const g = rows[0];
  return g ? { id: g.id as string, name: g.name as string, questions: g.questions as Variable[], rules: g.rules as Guide["rules"] } : null;
}

function fingerprintOf(method: string, path: string, body: unknown): string {
  const canonical = JSON.stringify(body ?? null, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
  return createHash("sha256").update(`${method}\n${path}\n${canonical}`).digest("hex");
}

interface CheckoutResult {
  status: number;
  body: { request: { number: string; items: { number: string; item: string; state: string }[] } };
}

/** One request, one request item per cart line, and each item's workflow started; replays answer from the stored response. */
export async function checkout(env: Env, body: { requested_for: string | null }, key: string | null): Promise<CheckoutResult> {
  const scope = env.user.username;
  const fingerprint = fingerprintOf("POST", "/api/cart/checkout", body);
  if (key !== null) {
    await env.tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`checkout:${scope}:${key}`]);
    const stored = (await env.tx.query("SELECT * FROM idempotency_keys WHERE scope = $1 AND key = $2 AND created_at > $3", [scope, key, new Date(now() - 86_400_000).toISOString()]))[0];
    if (stored) {
      if (stored.fingerprint !== fingerprint) fail(409, "idempotency_conflict", "This key was already used for a different request.");
      return { status: stored.status as number, body: stored.body as CheckoutResult["body"] };
    }
  }
  const lines = await cartLines(env);
  if (lines.length === 0) fail(422, "empty_cart", "Your cart is empty.");
  if (body.requested_for !== null && !env.world.people.has(body.requested_for)) validation("Unknown person.", { requested_for: "Choose an existing person." });
  const requestedFor = body.requested_for ?? scope;
  const number = `ASK-${pad(await nextSequence(env.tx, "request"))}`;
  await env.tx.query("INSERT INTO requests (number, requester, requested_for, created_at) VALUES ($1, $2, $3, $4)", [number, scope, requestedFor, nowIso()]);
  const items: { number: string; item: string; state: string }[] = [];
  const created: Array<{ number: string; item: CatalogItem }> = [];
  for (const line of lines) {
    const item = (await itemById(env, line.item))!;
    const rec = await save(env, {
      table: "request_item",
      number: null,
      submitted: {
        request: { value: number },
        item: { value: item.id },
        short_description: { value: item.name },
        quantity: { value: line.quantity },
        variables: { value: line.variables },
        requested_for: { value: requestedFor },
      },
      system: true,
    });
    await env.tx.query("UPDATE records SET created_by = $2 WHERE number = $1", [rec.number, scope]);
    created.push({ number: rec.number, item });
  }
  await env.tx.query("DELETE FROM cart_lines WHERE username = $1", [scope]);
  for (const { number: itemNumber, item } of created) {
    await startItemFlow(env, item, itemNumber);
    const fresh = await findRecord(env.tx, itemNumber);
    items.push({ number: itemNumber, item: item.id, state: String(fresh?.fields.state ?? "submitted") });
  }
  const result: CheckoutResult = { status: 201, body: { request: { number, items } } };
  if (key !== null) await env.tx.query("INSERT INTO idempotency_keys (scope, key, fingerprint, status, body, created_at) VALUES ($1, $2, $3, $4, $5, $6)", [scope, key, fingerprint, result.status, JSON.stringify(result.body), nowIso()]);
  env.tx.after.push(() => publish("list:request_item", "changed", { number }));
  return result;
}
