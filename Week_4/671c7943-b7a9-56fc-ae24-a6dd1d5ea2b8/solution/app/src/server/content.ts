import { characterCount, isCategory } from "../shared/rules.js";
import type { Content, StatisticPart } from "../shared/types.js";
import { ENQUIRY_LOCK, inTransaction, insertContent, pool, writeStartingContent } from "./db.js";

export async function loadContent(): Promise<Content> {
  const { rows } = await pool.query<Content>(
    `SELECT COALESCE((SELECT json_agg(content ORDER BY position) FROM projects), '[]') AS projects,
            COALESCE((SELECT json_agg(content ORDER BY position) FROM statistics), '[]') AS stats`,
  );
  const [content] = rows as [Content];
  return content;
}

/** Replaces every project and statistic, keeping the given order, and adds one to the edition. */
export async function replaceContent(content: Content): Promise<number> {
  return inTransaction(async (client) => {
    await client.query("SELECT edition FROM content_edition FOR UPDATE");
    await client.query("DELETE FROM projects");
    await client.query("DELETE FROM statistics");
    await insertContent(client, content.projects, content.stats);
    const { rows } = await client.query<{ edition: number }>("UPDATE content_edition SET edition = edition + 1 RETURNING edition");
    const [updated] = rows as [{ edition: number }];
    return updated.edition;
  });
}

/** Restores the starting content at edition 1, deletes every enquiry and restarts references. */
export async function restoreStartingContent(): Promise<number> {
  return inTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [ENQUIRY_LOCK]);
    await client.query("DELETE FROM enquiries");
    return writeStartingContent(client);
  });
}

type Json = Record<string, unknown>;

const TEXT_MAX = 1200;
const SLUG = /^[a-z][a-z0-9-]{1,39}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const MOTIFS: readonly unknown[] = ["arcs", "grid", "stack"];

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Json, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => key in value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && characterCount(value) >= 1 && characterCount(value) <= TEXT_MAX;
}

function isWhole(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function listOf(value: unknown, min: number, max: number, each: (item: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.length >= min && value.length <= max && value.every(each);
}

function isPaletteColour(item: unknown): boolean {
  return isObject(item) && hasExactKeys(item, ["name", "hex"]) && isText(item["name"]) && typeof item["hex"] === "string" && HEX.test(item["hex"]);
}

function isScreen(item: unknown): boolean {
  return isObject(item) && hasExactKeys(item, ["caption"]) && isText(item["caption"]);
}

function isResult(item: unknown): boolean {
  return isObject(item) && hasExactKeys(item, ["value", "label"]) && isText(item["value"]) && isText(item["label"]);
}

const PROJECT_KEYS = [
  "slug", "title", "client", "category", "year", "hue", "motif", "role", "duration", "standfirst", "overview",
  "objectives", "palette", "screens", "process", "results",
] as const;

const PROJECT_TEXT = ["title", "client", "role", "duration", "standfirst", "overview"] as const;

function isProject(item: unknown): boolean {
  if (!isObject(item) || !hasExactKeys(item, PROJECT_KEYS)) return false;
  const slug = item["slug"];
  return (
    typeof slug === "string" && SLUG.test(slug) &&
    PROJECT_TEXT.every((key) => isText(item[key])) &&
    isCategory(item["category"]) &&
    isWhole(item["year"], 2000, 2026) &&
    isWhole(item["hue"], 0, 359) &&
    MOTIFS.includes(item["motif"]) &&
    listOf(item["objectives"], 1, 5, isText) &&
    listOf(item["palette"], 1, 5, isPaletteColour) &&
    listOf(item["screens"], 1, 6, isScreen) &&
    listOf(item["process"], 4, 4, (weeks) => isWhole(weeks, 1, 12)) &&
    listOf(item["results"], 1, 4, isResult)
  );
}

function isPart(item: unknown): boolean {
  return isObject(item) && hasExactKeys(item, ["label", "value"]) && isText(item["label"]) && isWhole(item["value"], 0, 99999);
}

function isStatistic(item: unknown): boolean {
  if (!isObject(item) || !hasExactKeys(item, ["id", "value", "label", "note", "parts"])) return false;
  const { value, parts } = item;
  return (
    isText(item["id"]) && isText(item["label"]) && isText(item["note"]) &&
    isWhole(value, 1, 99999) &&
    listOf(parts, 2, 4, isPart) &&
    (parts as StatisticPart[]).reduce((sum, part) => sum + part.value, 0) === value
  );
}

function allUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/** Returns the content when the body matches the published shape, otherwise null. */
export function parseContent(body: unknown): Content | null {
  if (!isObject(body) || !hasExactKeys(body, ["projects", "stats"])) return null;
  const { projects, stats } = body;
  if (!listOf(projects, 1, 24, isProject) || !listOf(stats, 1, 4, isStatistic)) return null;
  const content = { projects, stats } as Content;
  const unique = allUnique(content.projects.map((project) => project.slug)) && allUnique(content.stats.map((stat) => stat.id));
  return unique ? content : null;
}
