import { valuesEqual } from './compare';
import { invalidValidator, validationFailed } from './errors';
import { displayCompact } from './json';
import { displayNumber } from './numbers';
import { pathPresentWithoutArrays, valueWithoutArrays } from './paths';
import { DocDate, DocObject, DocValue, isPlainObject, valueType } from './values';

const BSON_TYPES = new Set(['string', 'number', 'int', 'boolean', 'null', 'object', 'array', 'date']);
export type ValidationRule = 'required' | 'bsonType' | 'minimum' | 'maximum' | 'enum';

export interface PropertyRules {
  bsonType?: string;
  minimum?: number;
  maximum?: number;
  enum?: DocValue[];
}

export interface Validator {
  required: string[];
  properties: Array<{ path: string; rules: PropertyRules }>;
}

/** Checks a validator's shape, throwing `invalid_validator`. */
export function parseValidator(raw: DocValue): Validator | null {
  if (raw === null) return null;
  if (!isPlainObject(raw)) throw invalidValidator();
  const required: string[] = [];
  const properties: Array<{ path: string; rules: PropertyRules }> = [];
  for (const key of Object.keys(raw)) {
    if (key === 'required') {
      const value = raw[key];
      if (!Array.isArray(value)) throw invalidValidator();
      for (const item of value) {
        if (typeof item !== 'string' || item.length === 0) throw invalidValidator();
        required.push(item);
      }
    } else if (key === 'properties') {
      const value = raw[key];
      if (!isPlainObject(value)) throw invalidValidator();
      for (const path of Object.keys(value)) {
        const spec = value[path];
        if (!isPlainObject(spec)) throw invalidValidator();
        const rules: PropertyRules = {};
        for (const ruleName of Object.keys(spec)) {
          const ruleValue = spec[ruleName];
          if (ruleName === 'bsonType') {
            if (typeof ruleValue !== 'string' || !BSON_TYPES.has(ruleValue)) throw invalidValidator();
            rules.bsonType = ruleValue;
          } else if (ruleName === 'minimum' || ruleName === 'maximum') {
            if (typeof ruleValue !== 'number') throw invalidValidator();
            rules[ruleName] = ruleValue;
          } else if (ruleName === 'enum') {
            if (!Array.isArray(ruleValue)) throw invalidValidator();
            rules.enum = ruleValue;
          } else {
            throw invalidValidator();
          }
        }
        properties.push({ path, rules });
      }
      properties.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    } else {
      throw invalidValidator();
    }
  }
  return { required, properties };
}

function matchesBsonType(value: DocValue, bsonType: string): boolean {
  if (bsonType === 'int') return typeof value === 'number' && Number.isInteger(value);
  if (bsonType === 'date') return value instanceof DocDate;
  return valueType(value) === bsonType;
}

/** Checks a document against a validator in the published check order. */
export function checkValidator(doc: DocObject, validator: Validator | null): void {
  if (!validator) return;
  for (const path of validator.required) {
    if (!pathPresentWithoutArrays(doc, path)) throw validationFailed(path, 'required');
  }
  for (const property of validator.properties) {
    const value = valueWithoutArrays(doc, property.path);
    if (value === undefined) continue;
    const rules = property.rules;
    if (rules.bsonType !== undefined && !matchesBsonType(value, rules.bsonType)) {
      throw validationFailed(property.path, 'bsonType');
    }
    if (rules.minimum !== undefined && typeof value === 'number' && value < rules.minimum) {
      throw validationFailed(property.path, 'minimum');
    }
    if (rules.maximum !== undefined && typeof value === 'number' && value > rules.maximum) {
      throw validationFailed(property.path, 'maximum');
    }
    if (rules.enum !== undefined && !rules.enum.some((member) => valuesEqual(member, value))) {
      throw validationFailed(property.path, 'enum');
    }
  }
}

/** The shared validation text, used in Save status and load reports. */
export function validationMessage(path: string, rule: ValidationRule, validator: Validator | null): string {
  const property = validator?.properties.find((entry) => entry.path === path);
  const rules = property?.rules;
  let detail: string;
  switch (rule) {
    case 'required':
      detail = 'required field is missing';
      break;
    case 'bsonType':
      detail = `expected ${rules?.bsonType ?? ''}`;
      break;
    case 'minimum':
      detail = `must be at least ${rules?.minimum === undefined ? '' : displayNumber(rules.minimum)}`;
      break;
    case 'maximum':
      detail = `must be at most ${rules?.maximum === undefined ? '' : displayNumber(rules.maximum)}`;
      break;
    default:
      detail = `must be one of ${displayCompact(rules?.enum ?? [])}`;
  }
  return `Document failed validation at ${path}: ${detail}`;
}
