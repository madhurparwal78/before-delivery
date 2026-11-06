import { InputSchema, SchemaProperty } from '../schema';
import { JsonObject } from '../types';
import { fieldMessages } from '../errors';

export interface MediaReference {
  field: string;
  raw: string;
}

export interface ValidationOutcome {
  values: Record<string, string | number>;
  media: MediaReference[];
  errors: Record<string, string>;
}

export function isMediaProperty(property: SchemaProperty): boolean {
  return property.type === 'string' && (property.contentMediaType ?? '').startsWith('image/');
}

function describeLimit(property: SchemaProperty): string {
  if (property.enum) return `Choose one of ${property.enum.join(', ')}.`;
  if (property.type === 'integer') {
    return `Enter a whole number from ${property.minimum ?? 0} to ${property.maximum ?? 0}.`;
  }
  const min = property.minLength ?? 0;
  const max = property.maxLength;
  if (max !== undefined) return `Enter from ${min} to ${max} characters.`;
  return 'Enter text.';
}

/** Checks one submission against a model's published input schema. */
export function validateInput(schema: InputSchema, input: JsonObject): ValidationOutcome {
  const values: Record<string, string | number> = {};
  const media: MediaReference[] = [];
  const errors: Record<string, string> = {};

  for (const [name, property] of Object.entries(schema.properties)) {
    const path = `input.${name}`;
    const required = schema.required.includes(name);
    const raw = input[name];
    const absent = raw === undefined || raw === null || raw === '';

    if (absent) {
      if (required) {
        errors[path] = fieldMessages.required;
        continue;
      }
      if (property.default !== undefined) values[name] = property.default;
      continue;
    }

    if (property.type === 'integer') {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        errors[path] = describeLimit(property);
        continue;
      }
      if (property.enum && !property.enum.includes(raw)) {
        errors[path] = describeLimit(property);
        continue;
      }
      if (property.minimum !== undefined && raw < property.minimum) {
        errors[path] = describeLimit(property);
        continue;
      }
      if (property.maximum !== undefined && raw > property.maximum) {
        errors[path] = describeLimit(property);
        continue;
      }
      values[name] = raw;
      continue;
    }

    if (typeof raw !== 'string') {
      errors[path] = describeLimit(property);
      continue;
    }
    if (property.enum && !property.enum.includes(raw)) {
      errors[path] = describeLimit(property);
      continue;
    }
    if (property.minLength !== undefined && raw.length < property.minLength) {
      errors[path] = describeLimit(property);
      continue;
    }
    if (property.maxLength !== undefined && raw.length > property.maxLength) {
      errors[path] = describeLimit(property);
      continue;
    }
    if (isMediaProperty(property)) {
      media.push({ field: path, raw });
      continue;
    }
    values[name] = raw;
  }

  for (const name of schema.required) {
    const path = `input.${name}`;
    if (!(name in schema.properties) || errors[path] !== undefined) continue;
    if (values[name] === undefined && !media.some((reference) => reference.field === path)) {
      errors[path] = fieldMessages.required;
    }
  }

  return { values, media, errors };
}
