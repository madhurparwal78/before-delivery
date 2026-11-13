import type { Answer, ContentRecord, Interview, Ingredient, Pack, Product, Retailer, Scenario } from "../shared/content.js";
import { SCENARIO_IDS, isScenarioId, modeOf } from "../shared/scenarios.js";

/** Every content shape rule of the brief is decided in this file. */
const TEXT_MAX = 1200;
const INTERVIEWS_MAX = 12;
const ANSWERS_MAX = 6;
const PACKS_MAX = 3;
const INGREDIENTS_MAX = 10;
const LIST_MAX = 6;
const RETAILERS_MAX = 4;
const SLUG = /^[a-z][a-z0-9-]{1,39}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

type Fields = Record<string, unknown>;

function asFields(value: unknown): Fields | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}

function hasKeys(fields: Fields, keys: readonly string[]): boolean {
  const own = Object.keys(fields);
  return own.length === keys.length && keys.every((key) => key in fields);
}

function text(value: unknown): value is string {
  return typeof value === "string" && [...value].length >= 1 && [...value].length <= TEXT_MAX;
}

function whole(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function listOf<T>(value: unknown, min: number, max: number, item: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const parsed: T[] = [];
  for (const entry of value) {
    const one = item(entry);
    if (one === null) return null;
    parsed.push(one);
  }
  return parsed;
}

function texts(value: unknown, max: number): string[] | null {
  return listOf(value, 1, max, (entry) => (text(entry) ? entry : null));
}

function parsePack(value: unknown): Pack | null {
  const fields = asFields(value);
  if (!fields || !hasKeys(fields, ["sticks", "price_yen"])) return null;
  const { sticks, price_yen } = fields;
  return whole(sticks, 1, 100) && whole(price_yen, 1, 100000) ? { sticks, price_yen } : null;
}

function parseIngredient(value: unknown): Ingredient | null {
  const fields = asFields(value);
  if (!fields || !hasKeys(fields, ["name", "mg"])) return null;
  const { name, mg } = fields;
  return text(name) && whole(mg, 1, 10000) ? { name, mg } : null;
}

function parseRetailer(value: unknown): Retailer | null {
  const fields = asFields(value);
  if (!fields || !hasKeys(fields, ["name", "url"])) return null;
  const { name, url } = fields;
  return text(name) && text(url) && url.startsWith("https://") ? { name, url } : null;
}

function parseProduct(value: unknown): Product | null {
  const fields = asFields(value);
  if (!fields || !hasKeys(fields, ["name", "format", "serving", "packs", "ingredients", "how_to_use", "storage", "cautions", "stores"])) return null;
  const { name, format, serving, storage } = fields;
  const packs = listOf(fields["packs"], 1, PACKS_MAX, parsePack);
  const ingredients = listOf(fields["ingredients"], 1, INGREDIENTS_MAX, parseIngredient);
  const howToUse = texts(fields["how_to_use"], LIST_MAX);
  const cautions = texts(fields["cautions"], LIST_MAX);
  const stores = listOf(fields["stores"], 1, RETAILERS_MAX, parseRetailer);
  if (!text(name) || !text(format) || !text(serving) || !text(storage)) return null;
  if (!packs || !ingredients || !howToUse || !cautions || !stores) return null;
  return { name, format, serving, packs, ingredients, how_to_use: howToUse, storage, cautions, stores };
}

function parseAnswer(value: unknown): Answer | null {
  const fields = asFields(value);
  if (!fields || !hasKeys(fields, ["question", "answer"])) return null;
  const { question, answer } = fields;
  return text(question) && text(answer) ? { question, answer } : null;
}

function parseInterview(value: unknown): Interview | null {
  const fields = asFields(value);
  if (!fields || !hasKeys(fields, ["slug", "name", "role", "category", "lede", "hue", "answers"])) return null;
  const { slug, name, role, category, lede, hue } = fields;
  const answers = listOf(fields["answers"], 1, ANSWERS_MAX, parseAnswer);
  if (!text(slug) || !SLUG.test(slug) || !text(name) || !text(role) || !text(lede) || !whole(hue, 0, 359) || !answers) return null;
  if (category !== "expert" && category !== "everyday") return null;
  return { slug, name, role, category, lede, hue, answers };
}

function parseScenario(value: unknown): Scenario | null {
  const fields = asFields(value);
  if (!fields || !hasKeys(fields, ["id", "mode", "name", "title", "time", "copy", "moment"])) return null;
  const { id, mode, name, title, time, copy, moment } = fields;
  if (typeof id !== "string" || !isScenarioId(id) || mode !== modeOf(id)) return null;
  if (!text(name) || !text(title) || !text(copy) || !text(moment) || !text(time) || !CLOCK.test(time)) return null;
  return { id, mode: modeOf(id), name, title, time, copy, moment };
}

/** The record in the shape the grading route accepts, or null when it breaks the published shape. */
export function parseRecord(value: unknown): ContentRecord | null {
  const fields = asFields(value);
  if (!fields || !hasKeys(fields, ["product", "interviews", "scenarios"])) return null;
  const product = parseProduct(fields["product"]);
  const interviews = listOf(fields["interviews"], 1, INTERVIEWS_MAX, parseInterview);
  const scenarios = listOf(fields["scenarios"], SCENARIO_IDS.length, SCENARIO_IDS.length, parseScenario);
  if (!product || !interviews || !scenarios) return null;
  if (new Set(interviews.map((interview) => interview.slug)).size !== interviews.length) return null;
  if (new Set(scenarios.map((scenario) => scenario.id)).size !== SCENARIO_IDS.length) return null;
  return { product, interviews, scenarios };
}
