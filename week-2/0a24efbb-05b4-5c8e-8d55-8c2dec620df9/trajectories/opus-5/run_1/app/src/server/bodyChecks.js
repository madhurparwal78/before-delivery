import { MAX_JSON_DEPTH } from '../shared/constants.js';
import { refusals } from '../shared/copy.js';
import { hasNul } from '../shared/text.js';
import { refuse, refuseField } from './errors.js';

function depthOf(value, level) {
  if (level > MAX_JSON_DEPTH) return level;
  if (Array.isArray(value)) {
    let deepest = level;
    for (const entry of value) deepest = Math.max(deepest, depthOf(entry, level + 1));
    return deepest;
  }
  if (value !== null && typeof value === 'object') {
    let deepest = level;
    for (const entry of Object.values(value)) deepest = Math.max(deepest, depthOf(entry, level + 1));
    return deepest;
  }
  return level;
}

/** The body checks from Server boundary, in their published order. */
export function parseJsonBody(raw, contentType) {
  if (raw === undefined || raw === null || raw.length === 0) return {};
  const mediaType = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json') refuse(400, refusals.bodyContentType);

  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    refuse(400, refusals.bodyNotObject);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) refuse(400, refusals.bodyNotObject);
  if (depthOf(parsed, 1) > MAX_JSON_DEPTH) refuse(400, refusals.bodyNotObject);
  return parsed;
}

/** The first key the endpoint does not publish, in the body's own order, answers. */
export function checkUnpublishedKeys(body, published) {
  for (const key of Object.keys(body)) {
    if (!published.includes(key)) refuseField(400, refusals.unpublishedKey(key), key);
  }
}

export function checkNoNul(value, field) {
  if (hasNul(value)) refuseField(400, refusals.nulCharacter(field), field);
}

export function isMissing(body, field) {
  return !Object.prototype.hasOwnProperty.call(body, field) || body[field] === null;
}
