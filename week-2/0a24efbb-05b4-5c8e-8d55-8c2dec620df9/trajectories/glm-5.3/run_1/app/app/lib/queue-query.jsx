// The queue's canonical query: only parameters that differ from their
// defaults, in the published order. page=1 is never written.

export const STATE_OPTIONS = ['all', 'pending', 'approved', 'rejected', 'cancelled'];
export const TYPE_CODES = ['missed_in', 'missed_out', 'offsite', 'whole_day', 'night_shift'];
export const TYPE_LABELS = {
  missed_in: 'Sign in was not recorded',
  missed_out: 'Sign out was not recorded',
  offsite: 'Worked away from the workplace',
  whole_day: 'Whole day worked but not recorded',
  night_shift: 'Night shift recorded against the wrong day',
};

export function parseQueueQuery(searchParams) {
  const q = {
    state: 'all', type: undefined, person: undefined, month: undefined,
    q: undefined, sort: undefined, page: 1,
  };
  const first = (name) => {
    if (!searchParams.has(name)) return undefined;
    const v = searchParams.get(name);
    return v === '' ? undefined : v;
  };
  const state = first('state');
  if (state && STATE_OPTIONS.includes(state)) q.state = state;
  q.type = first('type');
  q.person = first('person');
  q.month = first('month');
  q.q = first('q');
  q.sort = first('sort');
  const page = first('page');
  if (page && /^[1-9][0-9]*$/.test(page)) q.page = Number(page);
  return q;
}

export function canonicalQueueQuery(q) {
  const parts = [];
  if (q.state && q.state !== 'all') parts.push(`state=${encodeURIComponent(q.state)}`);
  if (q.type) parts.push(`type=${encodeURIComponent(q.type)}`);
  if (q.person) parts.push(`person=${encodeURIComponent(q.person)}`);
  if (q.month) parts.push(`month=${encodeURIComponent(q.month)}`);
  if (q.q) parts.push(`q=${encodeURIComponent(q.q)}`);
  if (q.sort) parts.push(`sort=${encodeURIComponent(q.sort)}`);
  if (q.page && q.page > 1) parts.push(`page=${q.page}`);
  return parts.join('&');
}

export function queueHref(q, extraPath = '') {
  const qs = canonicalQueueQuery(q);
  return extraPath + (qs ? `?${qs}` : '');
}
