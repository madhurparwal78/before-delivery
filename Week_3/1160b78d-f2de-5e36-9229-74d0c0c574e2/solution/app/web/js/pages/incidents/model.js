// Pure helpers for the incident list: the filters in the address, which incidents a filter covers, and list order.

export const STATUS_OPTIONS = [
  ['open', 'Open'], ['triggered', 'Triggered'], ['acknowledged', 'Acknowledged'],
  ['snoozed', 'Snoozed'], ['resolved', 'Resolved'], ['all', 'All'],
];

const COVERS = {
  open: ['triggered', 'acknowledged', 'snoozed'],
  triggered: ['triggered'],
  acknowledged: ['acknowledged'],
  snoozed: ['snoozed'],
  resolved: ['resolved'],
  all: ['triggered', 'acknowledged', 'snoozed', 'resolved'],
};

export const PAGE_SIZE = 25;

// readFilter takes the filters from an address; an unknown status falls back to Open.
export function readFilter(search) {
  const params = new URLSearchParams(search);
  const status = params.get('status');
  return { status: COVERS[status] ? status : 'open', service: params.get('service') || '' };
}

export function filterAddress(filter) {
  const params = new URLSearchParams({ status: filter.status });
  if (filter.service) params.set('service', filter.service);
  return `/incidents?${params}`;
}

export function listQuery(filter, extra = {}) {
  const params = new URLSearchParams({ status: filter.status });
  if (filter.service) params.set('service_id', filter.service);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return `/api/incidents?${params}`;
}

export function serviceOf(item) {
  const service = item.service;
  if (service && typeof service === 'object') return { id: service.id ?? item.service_id ?? '', name: service.name ?? '' };
  return { id: item.service_id ?? '', name: service ?? '' };
}

export function covers(filter, item) {
  if (!COVERS[filter.status].includes(item.status)) return false;
  return !filter.service || serviceOf(item).id === filter.service;
}

// newer is true when a sits above b in the list: later opening instant first, then the higher number.
export function newer(a, b) {
  const x = Date.parse(a.opened_at);
  const y = Date.parse(b.opened_at);
  return x !== y ? x > y : a.number > b.number;
}

export function holderNames(item) {
  const names = (item.holders ?? []).map((h) => h.name);
  return names.length ? names.join(', ') : 'Nobody';
}

export const PAST = { acknowledge: 'acknowledged', resolve: 'resolved' };
