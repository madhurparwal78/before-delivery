import type { ContentRecord, Interview, Product, Scenario } from './content.js';
import { SCENARIO_ORDER } from './seed.js';

const SLUG = /^[a-z][a-z0-9-]{1,39}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): boolean {
  return typeof value === 'string' && value.length >= 1 && value.length <= 1200;
}

function whole(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function exactlyFields(value: Record<string, unknown>, fields: string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === fields.length && fields.slice().sort().every((field, i) => keys[i] === field);
}

function checkProduct(value: unknown): Product | null {
  if (!isRecord(value)) return null;
  if (
    !exactlyFields(value, [
      'name',
      'format',
      'serving',
      'packs',
      'ingredients',
      'how_to_use',
      'storage',
      'cautions',
      'stores',
    ])
  )
    return null;
  if (!text(value['name']) || !text(value['format']) || !text(value['serving']) || !text(value['storage']))
    return null;
  const packs = value['packs'];
  if (!Array.isArray(packs) || packs.length < 1 || packs.length > 3) return null;
  for (const pack of packs) {
    if (!isRecord(pack) || !exactlyFields(pack, ['sticks', 'price_yen'])) return null;
    if (!whole(pack['sticks'], 1, 100) || !whole(pack['price_yen'], 1, 100000)) return null;
  }
  const ingredients = value['ingredients'];
  if (!Array.isArray(ingredients) || ingredients.length < 1 || ingredients.length > 10) return null;
  for (const ingredient of ingredients) {
    if (!isRecord(ingredient) || !exactlyFields(ingredient, ['name', 'mg'])) return null;
    if (!text(ingredient['name']) || !whole(ingredient['mg'], 1, 10000)) return null;
  }
  const howToUse = value['how_to_use'];
  if (!Array.isArray(howToUse) || howToUse.length < 1 || howToUse.length > 6 || !howToUse.every(text))
    return null;
  const cautions = value['cautions'];
  if (!Array.isArray(cautions) || cautions.length < 1 || cautions.length > 6 || !cautions.every(text))
    return null;
  const stores = value['stores'];
  if (!Array.isArray(stores) || stores.length < 1 || stores.length > 4) return null;
  for (const store of stores) {
    if (!isRecord(store) || !exactlyFields(store, ['name', 'url'])) return null;
    if (!text(store['name'])) return null;
    const url = store['url'];
    if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  }
  return value as unknown as Product;
}

function checkInterview(value: unknown): Interview | null {
  if (!isRecord(value)) return null;
  if (!exactlyFields(value, ['slug', 'name', 'role', 'category', 'lede', 'hue', 'answers'])) return null;
  const slug = value['slug'];
  if (typeof slug !== 'string' || !SLUG.test(slug)) return null;
  if (!text(value['name']) || !text(value['role']) || !text(value['lede'])) return null;
  const category = value['category'];
  if (category !== 'expert' && category !== 'everyday') return null;
  if (!whole(value['hue'], 0, 359)) return null;
  const answers = value['answers'];
  if (!Array.isArray(answers) || answers.length < 1 || answers.length > 6) return null;
  for (const answer of answers) {
    if (!isRecord(answer) || !exactlyFields(answer, ['question', 'answer'])) return null;
    if (!text(answer['question']) || !text(answer['answer'])) return null;
  }
  return value as unknown as Interview;
}

function checkScenario(value: unknown, index: number): Scenario | null {
  if (!isRecord(value)) return null;
  if (!exactlyFields(value, ['id', 'mode', 'name', 'title', 'time', 'copy', 'moment'])) return null;
  const expectedId: string = SCENARIO_ORDER[index] ?? '';
  if (value['id'] !== expectedId) return null;
  const mode = value['mode'];
  if (mode !== 'on' && mode !== 'off') return null;
  if (mode !== (expectedId.startsWith('off') ? 'off' : 'on')) return null;
  if (!text(value['name']) || !text(value['title']) || !text(value['copy']) || !text(value['moment']))
    return null;
  const time = value['time'];
  if (typeof time !== 'string' || !TIME.test(time)) return null;
  return value as unknown as Scenario;
}

export function parseGradingBody(body: unknown): ContentRecord | null {
  if (!isRecord(body) || !exactlyFields(body, ['product', 'interviews', 'scenarios'])) return null;
  const product = checkProduct(body['product']);
  if (!product) return null;
  const interviewValues = body['interviews'];
  if (!Array.isArray(interviewValues) || interviewValues.length < 1 || interviewValues.length > 12)
    return null;
  const interviews: Interview[] = [];
  const slugs = new Set<string>();
  for (const interviewValue of interviewValues) {
    const interview = checkInterview(interviewValue);
    if (!interview) return null;
    if (slugs.has(interview.slug)) return null;
    slugs.add(interview.slug);
    interviews.push(interview);
  }
  const scenarioValues = body['scenarios'];
  if (!Array.isArray(scenarioValues) || scenarioValues.length !== SCENARIO_ORDER.length) return null;
  const scenarios: Scenario[] = [];
  for (let index = 0; index < scenarioValues.length; index += 1) {
    const scenario = checkScenario(scenarioValues[index], index);
    if (!scenario) return null;
    scenarios.push(scenario);
  }
  return { edition: 0, product, interviews, scenarios };
}
