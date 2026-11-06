import { isBusinessMonth } from './businessTime.js';
import { CORRECTION_TYPES, MAX_SEARCH_LENGTH, QUEUE_SORTS, REQUEST_STATES } from './constants.js';
import { refusals } from './copy.js';
import { hasNul } from './text.js';

export const QUEUE_PARAMS = ['state', 'type', 'person', 'month', 'q', 'sort', 'page'];

const PAGE_PATTERN = /^[1-9][0-9]*$/;

function firstValue(searchParams, name) {
  const raw = searchParams.getAll(name);
  for (const value of raw) {
    if (value !== '') return value;
  }
  return '';
}

/**
 * Reads the queue's filters, search, sort and page from a URL.
 * Returns either `{ query }` or `{ failure: { error, field } }`, the checks running
 * in the published order with the NUL refusal first on every value.
 */
export function parseQueueQuery(searchParams) {
  const raw = {};
  for (const name of QUEUE_PARAMS) raw[name] = firstValue(searchParams, name);

  for (const name of QUEUE_PARAMS) {
    const value = raw[name];
    if (hasNul(value)) return { failure: { error: refusals.nulCharacter(name), field: name } };
    if (value === '') continue;

    if (name === 'state' && !REQUEST_STATES.includes(value)) {
      return { failure: { error: refusals.unknownQueryValue('state', value), field: 'state' } };
    }
    if (name === 'type' && !CORRECTION_TYPES.includes(value)) {
      return { failure: { error: refusals.unknownQueryValue('type', value), field: 'type' } };
    }
    if (name === 'month' && !isBusinessMonth(value)) {
      return { failure: { error: refusals.unknownQueryValue('month', value), field: 'month' } };
    }
    if (name === 'q' && value.trim().length > MAX_SEARCH_LENGTH) {
      return { failure: { error: refusals.searchTooLong, field: 'q' } };
    }
    if (name === 'sort' && !QUEUE_SORTS.includes(value)) {
      return { failure: { error: refusals.unknownQueryValue('sort', value), field: 'sort' } };
    }
    if (name === 'page' && !PAGE_PATTERN.test(value)) {
      return { failure: { error: refusals.unknownQueryValue('page', value), field: 'page' } };
    }
  }

  return {
    query: {
      state: raw.state,
      type: raw.type,
      person: raw.person,
      month: raw.month,
      q: raw.q,
      sort: raw.sort,
      page: raw.page === '' ? 1 : Number(raw.page),
    },
  };
}

/** The canonical query string, writing only what differs from the defaults, page 1 never. */
export function canonicalQueueQuery(query) {
  const params = new URLSearchParams();
  for (const name of QUEUE_PARAMS) {
    if (name === 'page') {
      if (Number(query.page) > 1) params.set('page', String(query.page));
      continue;
    }
    const value = query[name];
    if (value) params.set(name, value);
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

export function queueHref(path, query) {
  return `${path}${canonicalQueueQuery(query)}`;
}

export function withQueueChange(query, changes) {
  const next = { ...query, ...changes };
  const touchesSelection = ['state', 'type', 'person', 'month', 'q', 'sort'].some((name) =>
    Object.prototype.hasOwnProperty.call(changes, name),
  );
  if (touchesSelection && !Object.prototype.hasOwnProperty.call(changes, 'page')) next.page = 1;
  return next;
}
