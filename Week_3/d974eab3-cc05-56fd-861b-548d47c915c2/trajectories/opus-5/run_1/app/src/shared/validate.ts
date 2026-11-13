import {
  SCENARIO_ORDER,
  isScenarioId,
  modeOfScenarioId,
  type ScenarioId,
} from './scenarios';
import type { Interview, Product, Scenario } from './types';

export interface GradingBody {
  product: Product;
  interviews: Interview[];
  scenarios: Scenario[];
}

const TEXT_MIN = 1;
const TEXT_MAX = 1200;
const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const own = Object.keys(value);
  return (
    own.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Every text field is 1 to 1,200 characters long, both ends included. */
function isText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= TEXT_MIN &&
    value.length <= TEXT_MAX
  );
}

function isWholeNumber(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function isSizedArray(
  value: unknown,
  min: number,
  max: number,
): value is unknown[] {
  return Array.isArray(value) && value.length >= min && value.length <= max;
}

function isPack(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['sticks', 'price_yen']) &&
    isWholeNumber(value['sticks'], 1, 100) &&
    isWholeNumber(value['price_yen'], 1, 100_000)
  );
}

function isIngredient(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['name', 'mg']) &&
    isText(value['name']) &&
    isWholeNumber(value['mg'], 1, 10_000)
  );
}

function isStoreLink(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['name', 'url']) &&
    isText(value['name']) &&
    isText(value['url']) &&
    (value['url'] as string).startsWith('https://')
  );
}

function isProduct(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'name',
      'format',
      'serving',
      'packs',
      'ingredients',
      'how_to_use',
      'storage',
      'cautions',
      'stores',
    ]) &&
    isText(value['name']) &&
    isText(value['format']) &&
    isText(value['serving']) &&
    isText(value['storage']) &&
    isSizedArray(value['packs'], 1, 3) &&
    value['packs'].every(isPack) &&
    isSizedArray(value['ingredients'], 1, 10) &&
    value['ingredients'].every(isIngredient) &&
    isSizedArray(value['how_to_use'], 1, 6) &&
    value['how_to_use'].every(isText) &&
    isSizedArray(value['cautions'], 1, 6) &&
    value['cautions'].every(isText) &&
    isSizedArray(value['stores'], 1, 4) &&
    value['stores'].every(isStoreLink)
  );
}

function isAnswer(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['question', 'answer']) &&
    isText(value['question']) &&
    isText(value['answer'])
  );
}

function isInterview(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'slug',
      'name',
      'role',
      'category',
      'lede',
      'hue',
      'answers',
    ]) &&
    typeof value['slug'] === 'string' &&
    SLUG_PATTERN.test(value['slug']) &&
    isText(value['name']) &&
    isText(value['role']) &&
    isText(value['lede']) &&
    (value['category'] === 'expert' || value['category'] === 'everyday') &&
    isWholeNumber(value['hue'], 0, 359) &&
    isSizedArray(value['answers'], 1, 6) &&
    value['answers'].every(isAnswer)
  );
}

function isInterviewList(value: unknown): boolean {
  if (!isSizedArray(value, 1, 12) || !value.every(isInterview)) {
    return false;
  }
  const slugs = value.map((item) => (item as Interview).slug);
  return new Set(slugs).size === slugs.length;
}

function isScenario(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'id',
      'mode',
      'name',
      'title',
      'time',
      'copy',
      'moment',
    ]) ||
    typeof value['id'] !== 'string' ||
    !isScenarioId(value['id'])
  ) {
    return false;
  }
  return (
    value['mode'] === modeOfScenarioId(value['id']) &&
    isText(value['name']) &&
    isText(value['title']) &&
    isText(value['copy']) &&
    isText(value['moment']) &&
    typeof value['time'] === 'string' &&
    TIME_PATTERN.test(value['time'])
  );
}

function isScenarioList(value: unknown): boolean {
  if (
    !isSizedArray(value, SCENARIO_ORDER.length, SCENARIO_ORDER.length) ||
    !value.every(isScenario)
  ) {
    return false;
  }
  const ids = new Set(value.map((item) => (item as Scenario).id as ScenarioId));
  return (
    ids.size === SCENARIO_ORDER.length &&
    SCENARIO_ORDER.every((id) => ids.has(id))
  );
}

/** Reads a grading body, or returns null when it breaks the published shape. */
export function readGradingBody(value: unknown): GradingBody | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['product', 'interviews', 'scenarios']) ||
    !isProduct(value['product']) ||
    !isInterviewList(value['interviews']) ||
    !isScenarioList(value['scenarios'])
  ) {
    return null;
  }
  return value as unknown as GradingBody;
}
