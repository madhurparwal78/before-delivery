// Typed reads of request fields; a wrong type is an `invalid` error naming the field.
import * as copy from '../shared/copy.ts';
import { fieldError } from '../shared/errors.ts';
import { readNumber } from '../shared/model/read.ts';
import { stringField, type Body } from './body.ts';

const NAME_MAX = 120;

/** A folder, drawing or sheet name as typed: trimmed, 1 to 120 characters. */
export function nameField(body: Body): string {
  const name = stringField(body, 'name').trim();
  if (name === '' || name.length > NAME_MAX) throw fieldError('name', copy.FOLDER_NAME);
  return name;
}

export function numberField(body: Body, name: string): number {
  return readNumber(body[name], name, copy.mustBeNumber(name));
}

export function numberParam(query: URLSearchParams, name: string, sentence = copy.mustBeNumber(name)): number {
  const raw = query.get(name);
  return readNumber(raw === null || raw.trim() === '' ? Number.NaN : Number(raw), name, sentence);
}
