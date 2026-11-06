/** End-to-end API walk-through used during development. Not part of the app. */
import { createHash } from 'node:crypto';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4173';
let failures = 0;
let checks = 0;

function check(label, condition, detail) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.log(`FAIL ${label}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
}

function eq(label, actual, expected) {
  check(label, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

class Session {
  constructor() {
    this.cookie = null;
  }
  async call(path, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    let body;
    if (options.raw !== undefined) body = options.raw;
    else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    let data;
    try {
      data = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers, text };
  }
  async signIn(email, next) {
    return this.call('/api/session', {
      method: 'POST',
      body: { email, password: 'chartroom-2026', ...(next ? { next } : {}) },
    });
  }
}

async function ingest(key, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-key': key },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: text.length > 0 ? JSON.parse(text) : undefined };
}

const INGEST = {
  'v-kittiwake': 'ik-kittiwake-4c19',
  'v-petrel': 'ik-petrel-8a03',
  'v-shearwater': 'ik-shearwater-2e77',
  'v-gannet': 'ik-gannet-61b5',
};

const ira = new Session();
const tamsin = new Session();
const odile = new Session();
const bram = new Session();

console.log('--- sign-in and landing ---');
let r = await ira.signIn('ira@fathomwright.test');
eq('surveyor lands on /fleet', r.data?.home, '/fleet');
eq('surveyor role', r.data?.user?.role, 'principal_surveyor');
r = await tamsin.signIn('tamsin@fathomwright.test');
eq('technician lands on /launch', r.data?.home, '/launch');
r = await odile.signIn('odile@calderhaven-port.test');
eq('reviewer lands on /surveys', r.data?.home, '/surveys');
await bram.signIn('bram@saltmere-dredging.test');

console.log('--- safe return ---');
for (const [next, expected] of [
  ['/missions/new', '/missions/new'],
  ['//evil.test/x', '/fleet'],
  ['/\\evil.test', '/fleet'],
  ['https://evil.test/fleet', '/fleet'],
  ['/%2F%2Fevil.test', '/fleet'],
  ['/api/me', '/fleet'],
  ['/surveys', '/fleet'],
]) {
  const probe = new Session();
  const result = await probe.signIn('ira@fathomwright.test', next);
  eq(`next ${next}`, result.data?.home, expected);
}
const clientNext = new Session();
r = await clientNext.signIn('odile@calderhaven-port.test', '/surveys/m-saltmere-approach');
eq('reviewer cannot deep-link another org survey', r.data?.home, '/surveys');
r = await clientNext.signIn('odile@calderhaven-port.test', '/surveys/m-calderhaven-north');
eq('reviewer deep-links own survey', r.data?.home, '/surveys/m-calderhaven-north');

console.log('--- sign-in attempt limit ---');
const attempts = await Promise.all(
  Array.from({ length: 10 }, () =>
    fetch(`${BASE}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@fathomwright.test', password: 'wrong' }),
    }).then((response) => response.status),
  ),
);
eq('five 401s', attempts.filter((s) => s === 401).length, 5);
eq('five 429s', attempts.filter((s) => s === 429).length, 5);
const locked = await fetch(`${BASE}/api/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'nobody@fathomwright.test', password: 'chartroom-2026' }),
});
eq('locked even with the right password', locked.status, 429);
check('retry_at present', typeof (await locked.clone().json()).retry_at === 'string');
check('Retry-After present', Number(locked.headers.get('retry-after')) >= 1);

console.log('--- permissions ---');
eq('reviewer cannot read vessels', (await odile.call('/api/vessels')).status, 403);
eq('unknown org id before role', (await tamsin.call('/api/missions', { method: 'POST', body: {} })).status, 404);
eq(
  'technician cannot create a mission',
  (await tamsin.call('/api/missions', { method: 'POST', body: { client_org_id: 'org-calderhaven' } })).status,
  403,
);
eq('technician cannot preview a plan', (await tamsin.call('/api/plan-preview', { method: 'POST', body: {} })).status, 403);
eq('reviewer 404 on another org mission', (await odile.call('/api/missions/m-saltmere-approach')).status, 404);
eq('reviewer 404 on unknown id', (await odile.call('/api/missions/nope')).status, 404);
eq('unknown api path', (await ira.call('/api/nope')).status, 404);
eq('wrong method on alerts', (await ira.call('/api/alerts', { method: 'DELETE' })).status, 404);

console.log('--- plan preview and derivation ---');
r = await ira.call('/api/plan-preview', {
  method: 'POST',
  body: {
    survey_area: [
      { easting: 5000, northing: 8000 },
      { easting: 5400, northing: 8000 },
      { easting: 5400, northing: 8300 },
      { easting: 5000, northing: 8300 },
    ],
    planned_depth_m: 10,
    swath_ratio: 4,
    overlap_pct: 20,
    line_azimuth_deg: 0,
    planned_speed_mps: 2,
    survey_order: 'special',
  },
});
eq('preview matches the published example', r.data, {
  swath_width_m: 40,
  line_spacing_m: 32,
  line_count: 13,
  crossline_count: 1,
  estimated_duration_s: 2930,
});

r = await ira.call('/api/plan-preview', { method: 'POST', body: { survey_area: [], planned_depth_m: 999 } });
eq('preview validation', r.status, 422);
eq('area message', r.data?.errors?.survey_area, 'Enter 3 to 40 survey-area vertices as easting, northing');
eq('depth message', r.data?.errors?.planned_depth_m, 'Planned depth must be between 1 and 200 m');

console.log('--- seeded mission ---');
r = await ira.call('/api/missions/m-calderhaven-north');
eq('seed lines_remaining', r.data?.counters?.lines_remaining, 14);
eq('seed line count', r.data?.line_count, 13);
eq('seed crossline count', r.data?.crossline_count, 1);
eq('seed agreement', r.data?.crossline_agreement, { compared: 0, within: 0, pct: null, meets_order: null });
eq('owner', r.data?.owner_name, 'Ira Penhallow');
const mission = r.data;

r = await ira.call('/api/missions/m-calderhaven-north/lines');
const lines = r.data;
eq('line order', lines.slice(0, 3).map((l) => l.label), ['L01', 'L02', 'L03']);
eq('crossline last', lines[lines.length - 1].label, 'X01');

console.log('--- overdue block ---');
r = await ira.call('/api/missions/m-calderhaven-north/assignments', {
  method: 'POST',
  body: { assignments: [{ line_id: lines[0].id, vessel_id: 'v-shearwater' }] },
});
eq('overdue refusal code', r.data?.error, 'service_overdue');
eq(
  'overdue message',
  r.data?.message,
  'Shearwater is overdue for thruster service (263.5 h since service, limit 250 h). Log a service before assigning or launching.',
);

console.log('--- idempotent service logging ---');
const key = `svc-${Date.now()}`;
const [a, b] = await Promise.all([
  tamsin.call('/api/vessels/v-shearwater/services', {
    method: 'POST',
    body: { note: 'Thruster service' },
    headers: { 'idempotency-key': key },
  }),
  tamsin.call('/api/vessels/v-shearwater/services', {
    method: 'POST',
    body: { note: 'Thruster service' },
    headers: { 'idempotency-key': key },
  }),
]);
eq('one service id', a.data?.id, b.data?.id);
eq('hours at service recorded', a.data?.hours_at_service, 263.5);
r = await tamsin.call('/api/vessels/v-shearwater/services');
eq('exactly one entry', r.data.length, 1);
r = await tamsin.call('/api/vessels/v-shearwater/services', {
  method: 'POST',
  body: { note: 'different' },
  headers: { 'idempotency-key': key },
});
eq('conflicting body', r.data?.error, 'idempotency_conflict');
r = await ira.call('/api/vessels/v-shearwater');
eq('hours reset', r.data?.hours_since_service, 0);
eq('not overdue', r.data?.service_overdue, false);
eq('version bumped', r.data?.version, 2);

console.log('--- service interval versioning ---');
r = await ira.call('/api/vessels/v-gannet', { method: 'PATCH', body: { service_interval_h: 350, version: 1 } });
eq('interval saved', r.data?.service_interval_h, 350);
r = await ira.call('/api/vessels/v-gannet', { method: 'PATCH', body: { service_interval_h: 400, version: 1 } });
eq('stale version', r.data?.error, 'stale_version');
eq('stale copy', r.data?.message, 'Gannet was changed by someone else. Review the latest values and save again.');
eq('current vessel returned', r.data?.current?.service_interval_h, 350);
r = await ira.call('/api/vessels/v-gannet', { method: 'PATCH', body: { service_interval_h: 10, version: 2 } });
eq('interval range', r.data?.errors?.service_interval_h, 'Service interval must be between 50 and 1000 h');
r = await ira.call('/api/vessels/v-gannet', { method: 'PATCH', body: { service_interval_h: 350 } });
eq('missing version', r.data?.errors?.version, 'Send the vessel version you last read');

console.log('--- assignments and one open mission per vessel ---');
const kitti = lines.filter((l) => l.kind === 'planned').slice(0, 7);
const petrel = lines.filter((l) => l.kind === 'planned').slice(7);
const crossline = lines.find((l) => l.kind === 'crossline');
r = await ira.call('/api/missions/m-calderhaven-north/assignments', {
  method: 'POST',
  body: {
    assignments: [
      ...kitti.map((l) => ({ line_id: l.id, vessel_id: 'v-kittiwake' })),
      ...petrel.map((l) => ({ line_id: l.id, vessel_id: 'v-petrel' })),
      { line_id: crossline.id, vessel_id: 'v-kittiwake' },
    ],
  },
});
eq('assignments saved', r.status, 200);
eq('assigned status', r.data.every((l) => l.status === 'Assigned'), true);

const saltLines = (await ira.call('/api/missions/m-saltmere-approach/lines')).data;
r = await ira.call('/api/missions/m-saltmere-approach/assignments', {
  method: 'POST',
  body: { assignments: [{ line_id: saltLines[0].id, vessel_id: 'v-kittiwake' }] },
});
eq('vessel committed', r.data?.error, 'vessel_committed');
eq('vessel committed message', r.data?.message, 'Kittiwake is already on Calderhaven North Basin');

console.log('--- launch preconditions ---');
r = await ira.call('/api/missions/m-calderhaven-north/transitions', { method: 'POST', body: { to: 'Launched' } });
eq('not afloat', r.data?.error, 'vessels_not_afloat');
eq('not afloat copy', r.data?.message, 'Not afloat yet: Kittiwake, Petrel');
eq('afloat forbidden for surveyor', (await ira.call('/api/vessels/v-kittiwake/afloat', { method: 'POST', body: {} })).status, 403);
await tamsin.call('/api/vessels/v-kittiwake/afloat', { method: 'POST', body: {} });
await tamsin.call('/api/vessels/v-petrel/afloat', { method: 'POST', body: {} });
r = await tamsin.call('/api/vessels/v-kittiwake/afloat', { method: 'POST', body: {} });
eq('repeat afloat is 200', r.status, 200);
eq('version unchanged on repeat', r.data?.version, 2);

r = await ira.call('/api/missions/m-calderhaven-north/transitions', { method: 'POST', body: { to: 'Launched' } });
eq('launched', r.data?.status, 'Launched');
r = await ira.call('/api/missions/m-calderhaven-north/transitions', { method: 'POST', body: { to: 'Launched' } });
eq('illegal repeat', r.data?.error, 'illegal_transition');
eq('illegal copy', r.data?.message, 'This mission cannot move from Launched to Launched');
eq('from/to', [r.data?.from, r.data?.to], ['Launched', 'Launched']);
r = await ira.call('/api/missions/m-calderhaven-north/transitions', { method: 'POST', body: { to: 'Surveying' } });
eq('Surveying never requestable', r.data?.error, 'illegal_transition');

console.log('--- fix ingest ---');
const refreshed = (await ira.call('/api/missions/m-calderhaven-north/lines')).data;
const l01 = refreshed.find((l) => l.label === 'L01');
r = await ingest(INGEST['v-kittiwake'], `/api/ingest/lines/${l01.id}/start`, {});
eq('line running', r.data?.line?.status, 'Running');
r = await ira.call('/api/missions/m-calderhaven-north');
eq('mission surveying on its own', r.data?.status, 'Surveying');

const base = Date.parse('2026-11-02T09:00:00Z');
const iso = (seconds) => new Date(base + seconds * 1000).toISOString();

r = await ingest(INGEST['v-kittiwake'], '/api/ingest/fixes', {
  t: iso(0),
  easting: 5020,
  northing: 8000,
  heading_deg: 0,
  speed_mps: 2,
  battery_pct: 90,
  depth_m: 10,
});
eq('first fix 201', r.status, 201);
eq('link live', r.data?.link_state, 'Live');
r = await ingest(INGEST['v-kittiwake'], '/api/ingest/fixes', {
  t: iso(0),
  easting: 5020,
  northing: 8000,
  heading_deg: 0,
  speed_mps: 2,
  battery_pct: 90,
  depth_m: 10,
});
eq('replay 200', r.status, 200);
eq('duplicate flag', r.data?.duplicate, true);

r = await ingest(INGEST['v-kittiwake'], '/api/ingest/fixes', {
  t: iso(-10),
  easting: 5020,
  northing: 8000,
  heading_deg: 0,
  speed_mps: 2,
  battery_pct: 90,
  depth_m: 10,
});
eq('out of order', r.data?.error, 'out_of_order');

r = await ingest(INGEST['v-kittiwake'], '/api/ingest/fixes', {
  t: iso(10),
  easting: 5020,
  northing: 8010,
  heading_deg: 400,
  speed_mps: 2,
  battery_pct: 90,
  depth_m: 0,
});
eq('fix validation', r.status, 422);
eq('heading message', r.data?.errors?.heading_deg, 'Heading must be at least 0 and below 360');
eq('depth message', r.data?.errors?.depth_m, 'Depth must be above 0 and at most 500 m');

// A batch running L01 north from 8000 to 8300 at 10 m/s of ground per 5 s.
const batch = [];
for (let step = 1; step <= 60; step += 1) {
  batch.push({
    t: iso(step * 5),
    easting: 5020,
    northing: 8000 + step * 5,
    heading_deg: 0,
    speed_mps: 1,
    battery_pct: 89,
    depth_m: 10,
  });
}
r = await ingest(INGEST['v-kittiwake'], '/api/ingest/fixes', { fixes: batch.slice().reverse() });
eq('batch accepted', r.data?.accepted, 60);
eq('batch replayed', r.data?.replayed, 0);
eq('batch last_t', r.data?.last_t, iso(300));

r = await ingest(INGEST['v-kittiwake'], '/api/ingest/fixes', {
  fixes: [batch[0], { ...batch[0], easting: 5021 }],
});
eq('duplicate time in batch', r.data?.errors?.['fixes.1.t'], 'Each fix in a batch needs its own time');

r = await ingest(INGEST['v-kittiwake'], '/api/ingest/fixes', {
  fixes: [{ ...batch[0], t: iso(-50) }],
});
eq('stale fix', r.data?.error, 'stale_fix');
eq('stale index', r.data?.index, 0);

r = await ira.call('/api/vessels/v-kittiwake');
check('thruster hours grew', r.data?.thruster_hours_total > 1840.2, r.data?.thruster_hours_total);

console.log('--- coverage ---');
r = await ira.call('/api/missions/m-calderhaven-north/coverage');
eq('cell size', r.data?.cell_size_m, 5);
eq('origin', r.data?.origin, { easting: 5000, northing: 8000 });
eq('grid size', [r.data?.cols, r.data?.rows], [80, 60]);
check('coverage above zero', r.data?.counters?.coverage_pct > 0, r.data?.counters);
const coverageFromGrid = r.data;

r = await ira.call('/api/missions/m-calderhaven-north');
eq('counters agree with grid', r.data?.counters, coverageFromGrid.counters);

r = await ira.call('/api/missions/m-calderhaven-north/coverage.csv');
eq('csv content type', r.headers.get('content-type'), 'text/csv; charset=utf-8');
eq(
  'csv file name',
  r.headers.get('content-disposition'),
  'attachment; filename="calderhaven-north-basin-coverage.csv"',
);
const csvRows = r.text.split('\r\n');
eq('csv header', csvRows[0], 'mission,line,kind,vessel,status,length_m,covered_m,coverage_pct');
check('csv ends with CRLF', r.text.endsWith('\r\n'));
eq('csv row count', csvRows.length - 2, 14);
check('csv L01 row', csvRows[1].startsWith('Calderhaven North Basin,L01,planned,Kittiwake,Running,300.0,'), csvRows[1]);

console.log('--- geofence breach ---');
r = await ingest(INGEST['v-kittiwake'], '/api/ingest/fixes', {
  t: iso(400),
  easting: 5500,
  northing: 8000,
  heading_deg: 0,
  speed_mps: 1,
  battery_pct: 88,
  depth_m: 10,
});
eq('breach fix accepted', r.status, 201);
await Promise.all([
  ingest(INGEST['v-kittiwake'], '/api/ingest/fixes', {
    t: iso(405),
    easting: 5500,
    northing: 8005,
    heading_deg: 0,
    speed_mps: 1,
    battery_pct: 88,
    depth_m: 10,
  }),
  ingest(INGEST['v-kittiwake'], '/api/ingest/fixes', {
    t: iso(405),
    easting: 5500,
    northing: 8005,
    heading_deg: 0,
    speed_mps: 1,
    battery_pct: 88,
    depth_m: 10,
  }),
]);
r = await ira.call('/api/alerts?status=open');
const breaches = r.data.filter((alert) => alert.kind === 'geofence_breach');
eq('one breach alert', breaches.length, 1);
eq('breach heading', breaches[0].heading, 'Geofence breach — Kittiwake');
eq('breach state', breaches[0].state, 'Active');
eq('breach history', breaches[0].history.map((h) => [h.state, h.by]), [['Active', 'Swathdeck']]);
const breachId = breaches[0].id;

const acks = await Promise.all([
  ira.call(`/api/alerts/${breachId}/ack`, { method: 'POST', body: {} }),
  tamsin.call(`/api/alerts/${breachId}/ack`, { method: 'POST', body: {} }),
]);
eq('both acks answer 200', acks.map((x) => x.status), [200, 200]);
r = await ira.call('/api/alerts?status=open');
const acked = r.data.find((alert) => alert.id === breachId);
eq('one acknowledgement recorded', acked.history.filter((h) => h.state === 'Acknowledged').length, 1);
eq('acknowledged state', acked.state, 'Acknowledged');
check('attributed', ['Ira Penhallow', 'Tamsin Rook'].includes(acked.acknowledged_by), acked.acknowledged_by);

r = await ingest(INGEST['v-kittiwake'], '/api/ingest/fixes', {
  t: iso(410),
  easting: 5020,
  northing: 8300,
  heading_deg: 0,
  speed_mps: 1,
  battery_pct: 88,
  depth_m: 10,
});
eq('return inside accepted', r.status, 201);
r = await ira.call('/api/alerts?status=all');
const closed = r.data.find((alert) => alert.id === breachId);
eq('acknowledged breach closes when cleared', closed.state, 'Closed');
check('alert cannot be edited', (await ira.call(`/api/alerts/${breachId}`, { method: 'PATCH', body: {} })).status === 404);

console.log('--- surveyed lines, holidays and infill ---');
r = await ingest(INGEST['v-kittiwake'], `/api/ingest/lines/${l01.id}/end`, {});
eq('line surveyed', r.data?.line?.status, 'Surveyed');
eq('file awaiting upload', r.data?.line?.file?.state, 'Awaiting upload');

r = await ira.call('/api/missions/m-calderhaven-north/holidays');
check('holidays derived', Array.isArray(r.data), r.data);
const openHolidays = r.data.filter((h) => h.status === 'Open');
console.log(`    holidays: ${r.data.length}, open: ${openHolidays.length}`);
if (openHolidays.length > 0) {
  const holiday = openHolidays[0];
  check('holiday has three-cell run', holiday.cell_count >= 3, holiday);
  eq('holiday area', holiday.area_m2, holiday.cell_count * 25);
  const first = await ira.call(
    `/api/missions/m-calderhaven-north/holidays/${holiday.id}/infill`,
    { method: 'POST', body: {} },
  );
  check('infill queued or refused with a published code',
    first.status === 201 || ['no_eligible_vessel', 'mission_not_surveying'].includes(first.data?.error),
    first.data);
  if (first.status === 201) {
    eq('infill label', first.data?.line?.label, 'I01');
    eq('infill assigned', first.data?.line?.status, 'Assigned');
    const again = await ira.call(
      `/api/missions/m-calderhaven-north/holidays/${holiday.id}/infill`,
      { method: 'POST', body: {} },
    );
    eq('repeat queue returns the existing line', [again.status, again.data?.line?.id], [200, first.data.line.id]);
  }
}

console.log('--- line file upload ---');
const payload = Buffer.from('raw sonar bytes for L01');
const sha = createHash('sha256').update(payload).digest('hex');
r = await tamsin.call(`/api/lines/${l01.id}/file`, {
  method: 'PUT',
  raw: payload,
  headers: {
    'content-type': 'application/octet-stream',
    'x-line-file-name': 'L01.raw',
    'x-content-sha256': sha,
  },
});
eq('delivered', [r.status, r.data?.status, r.data?.file?.state], [201, 'Delivered', 'Stored']);
eq('stored checksum', r.data?.file?.sha256, sha);
r = await tamsin.call(`/api/lines/${l01.id}/file`, {
  method: 'PUT',
  raw: payload,
  headers: {
    'content-type': 'application/octet-stream',
    'x-line-file-name': 'L01.raw',
    'x-content-sha256': sha,
  },
});
eq('identical re-upload replays', r.status, 200);
r = await tamsin.call(`/api/lines/${l01.id}/file`, {
  method: 'PUT',
  raw: Buffer.from('different'),
  headers: {
    'content-type': 'application/octet-stream',
    'x-line-file-name': 'L01.raw',
    'x-content-sha256': createHash('sha256').update('different').digest('hex'),
  },
});
eq('different bytes refused', r.data?.error, 'already_delivered');

const l02 = refreshed.find((l) => l.label === 'L02');
r = await tamsin.call(`/api/lines/${l02.id}/file`, {
  method: 'PUT',
  raw: payload,
  headers: {
    'content-type': 'application/octet-stream',
    'x-line-file-name': 'L02.raw',
    'x-content-sha256': sha,
  },
});
eq('not surveyed', r.data?.error, 'line_not_surveyed');

r = await ingest(INGEST['v-petrel'], `/api/ingest/lines/${l02.id}/start`, {});
eq('wrong vessel 404', r.status, 404);

r = await tamsin.call(`/api/lines/${l01.id}/file`);
eq('download bytes', r.text, payload.toString());
eq('download checksum header', r.headers.get('x-content-sha256'), sha);
eq('download disposition', r.headers.get('content-disposition'), 'attachment; filename="L01.raw"');

console.log('--- checksum mismatch stores nothing ---');
const l03 = refreshed.find((l) => l.label === 'L03');
await ira.call('/api/missions/m-calderhaven-north/assignments', {
  method: 'POST',
  body: { assignments: [{ line_id: l03.id, vessel_id: 'v-kittiwake' }] },
});
await ingest(INGEST['v-kittiwake'], `/api/ingest/lines/${l03.id}/start`, {});
await ingest(INGEST['v-kittiwake'], `/api/ingest/lines/${l03.id}/end`, {});
r = await tamsin.call(`/api/lines/${l03.id}/file`, {
  method: 'PUT',
  raw: payload,
  headers: {
    'content-type': 'application/octet-stream',
    'x-line-file-name': 'L03.raw',
    'x-content-sha256': 'a'.repeat(64),
  },
});
eq('checksum mismatch', r.data?.errors?.sha256, 'Checksum does not match this file. Nothing was stored.');
r = await ira.call('/api/missions/m-calderhaven-north/lines');
eq(
  'line stays awaiting upload',
  r.data.find((l) => l.label === 'L03').file?.state,
  'Awaiting upload',
);

console.log('--- client scope and projection ---');
r = await odile.call('/api/missions/m-calderhaven-north');
eq('reviewer reads own survey', r.status, 200);
const holidaysForClient = await odile.call('/api/missions/m-calderhaven-north/holidays');
eq(
  'nearest vessel projected away',
  holidaysForClient.data.every((h) => h.nearest_vessel === null),
  true,
);
check(
  'no thruster, service, ingest or acknowledgement key',
  !/thruster|service|ingest|acknowledged/.test(JSON.stringify(r.data)),
  Object.keys(r.data),
);
eq(
  'reviewer sees only own missions',
  (await odile.call('/api/missions')).data.map((m) => m.id),
  ['m-calderhaven-north'],
);
eq('other org reviewer blocked', (await bram.call('/api/missions/m-calderhaven-north')).status, 404);
eq('other org file blocked', (await bram.call(`/api/lines/${l01.id}/file`)).status, 404);
eq('reviewer cannot flag an undelivered line', (await odile.call(`/api/missions/m-calderhaven-north/lines/${l03.id}/flags`, { method: 'POST', body: { comment: 'x' } })).data?.error, 'line_not_delivered');

console.log('--- client flag and reply ---');
r = await odile.call(`/api/missions/m-calderhaven-north/lines/${l01.id}/flags`, {
  method: 'POST',
  body: { comment: 'Depths look shallow near the quay.' },
});
eq('flag created', [r.status, r.data?.state], [201, 'Open']);
const flagId = r.data.id;
r = await ira.call('/api/flags?state=open');
eq('staff read the flag', r.data.find((f) => f.id === flagId)?.client_name, 'Port of Calderhaven Authority');
r = await ira.call(`/api/flags/${flagId}/reply`, { method: 'POST', body: { text: 'Re-running that line.' } });
eq('reply answered', r.data?.state, 'Answered');
r = await ira.call(`/api/flags/${flagId}/reply`, { method: 'POST', body: { text: 'again' } });
eq('second reply refused', r.data?.error, 'flag_answered');

console.log('--- units, last screen, status ---');
r = await ira.call('/api/me', { method: 'PATCH', body: { units: 'imperial' } });
eq('units changed', r.data?.units, 'imperial');
await ira.call('/api/me', { method: 'PATCH', body: { units: 'metric' } });
r = await ira.call('/api/me', { method: 'PATCH', body: { units: 'furlongs' } });
eq('units validation', r.data?.errors?.units, 'Choose metric or imperial');
eq('last screen accepted', (await ira.call('/api/me/last-screen', { method: 'PUT', body: { path: '/fleet/v-kittiwake' } })).status, 204);
r = await ira.call('/api/me/last-screen', { method: 'PUT', body: { path: '//evil.test' } });
eq('last screen refused', r.data?.errors?.path, 'Send a screen address this role may open');
r = await ira.call('/api/status');
eq('status keys', Object.keys(r.data).sort(), ['mail', 'storage']);

console.log('--- boundary ---');
r = await fetch(`${BASE}/api/health`);
check('no x-powered-by', r.headers.get('x-powered-by') === null);
check('no cors header', r.headers.get('access-control-allow-origin') === null);
eq('package.json hidden', (await fetch(`${BASE}/package.json`)).status, 404);
eq('run.json hidden', (await fetch(`${BASE}/run.json`)).status, 404);
eq('source hidden', (await fetch(`${BASE}/src/server/index.ts`)).status, 404);
r = await ira.call('/api/missions', { method: 'POST', raw: 'x'.repeat(64_001), headers: { 'content-type': 'application/json' } });
eq('oversize body', r.data?.error, 'payload_too_large');
r = await ira.call('/api/missions', { method: 'POST', raw: 'hello', headers: { 'content-type': 'text/plain' } });
eq('wrong content type', r.data?.error, 'unsupported_media_type');

console.log('--- session revocation ---');
const shared = new Session();
await shared.signIn('tamsin@fathomwright.test');
eq('session works', (await shared.call('/api/me')).status, 200);
await shared.call('/api/session', { method: 'DELETE' });
const revoked = new Session();
revoked.cookie = shared.cookie;
eq('revoked session', (await revoked.call('/api/me')).status, 401);


// ---------------------------------------------------------------------------
// A second mission carried right through to its coverage report, so holidays,
// infill, completion, the report bytes and the report email are all exercised.
// ---------------------------------------------------------------------------

console.log('\n--- full mission: plan to report ---');

const gap = new Session();
await gap.signIn('ira@fathomwright.test');
const tech = new Session();
await tech.signIn('tamsin@fathomwright.test');

const AREA = [
  { easting: 2000, northing: 3000 },
  { easting: 2080, northing: 3000 },
  { easting: 2080, northing: 3100 },
  { easting: 2000, northing: 3100 },
];
const FENCE = [
  { easting: 1950, northing: 2950 },
  { easting: 2130, northing: 2950 },
  { easting: 2130, northing: 3150 },
  { easting: 1950, northing: 3150 },
];

const createKey = `mission-${Date.now()}`;
const createBody = {
  name: 'Gapworth Trial Cut',
  client_org_id: 'org-saltmere',
  survey_date: '2026-11-05',
  survey_area: AREA,
  geofence: FENCE,
  planned_depth_m: 5,
  swath_ratio: 4,
  overlap_pct: 0,
  line_azimuth_deg: 0,
  planned_speed_mps: 2,
  survey_order: '1a',
};
r = await gap.call('/api/missions', { method: 'POST', body: createBody, headers: { 'idempotency-key': createKey } });
eq('mission created', r.status, 201);
const gapMission = r.data;
const replay = await gap.call('/api/missions', { method: 'POST', body: createBody, headers: { 'idempotency-key': createKey } });
eq('replayed creation returns the original', replay.data?.id, gapMission.id);
const conflict = await gap.call('/api/missions', {
  method: 'POST',
  body: { ...createBody, name: 'Other' },
  headers: { 'idempotency-key': createKey },
});
eq('same key different body', conflict.data?.error, 'idempotency_conflict');

// W = 20, S = 20, spread 80 → n = 1 + ceil(60/20) = 4 lines of 100 m.
eq('gap line count', gapMission.line_count, 4);
const gapLines = (await gap.call(`/api/missions/${gapMission.id}/lines`)).data;
eq('gap labels', gapLines.map((l) => l.label), ['L01', 'L02', 'L03', 'L04', 'X01']);

r = await gap.call(`/api/missions/${gapMission.id}/assignments`, {
  method: 'POST',
  body: { assignments: gapLines.map((l) => ({ line_id: l.id, vessel_id: 'v-gannet' })) },
});
eq('gap assignments', r.status, 200);
await tech.call('/api/vessels/v-gannet/afloat', { method: 'POST', body: {} });
r = await gap.call(`/api/missions/${gapMission.id}/transitions`, { method: 'POST', body: { to: 'Launched' } });
eq('gap launched', r.data?.status, 'Launched');

const gapBase = Date.parse('2026-11-05T08:00:00Z');
const gapIso = (seconds) => new Date(gapBase + seconds * 1000).toISOString();
let clock = 0;

/** Runs a line from its start to its end, optionally skipping a middle stretch. */
async function runLine(line, options = {}) {
  await ingest(INGEST['v-gannet'], `/api/ingest/lines/${line.id}/start`, {});
  const vertical = Math.abs(line.end.northing - line.start.northing) > Math.abs(line.end.easting - line.start.easting);
  const steps = 20;
  const fixes = [];
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    // The clock advances for skipped fixes too, so the pair spanning the gap is
    // more than 60 seconds apart and sweeps nothing.
    clock += 10;
    if (options.skipFrom !== undefined && ratio > options.skipFrom && ratio < options.skipTo) continue;
    fixes.push({
      t: gapIso(clock),
      easting: line.start.easting + (line.end.easting - line.start.easting) * ratio,
      northing: line.start.northing + (line.end.northing - line.start.northing) * ratio,
      heading_deg: vertical ? 0 : 90,
      speed_mps: 1,
      battery_pct: 80,
      depth_m: 5,
    });
  }
  const sent = await ingest(INGEST['v-gannet'], '/api/ingest/fixes', { fixes });
  check(`fixes accepted for ${line.label}`, sent.data?.accepted === fixes.length, sent.data);
  await ingest(INGEST['v-gannet'], `/api/ingest/lines/${line.id}/end`, {});
}

// L02 leaves a gap in the middle of its strip, which must become a holiday.
for (const line of gapLines) {
  if (line.label === 'L02') await runLine(line, { skipFrom: 0.3, skipTo: 0.7 });
  else await runLine(line);
}

r = await gap.call(`/api/missions/${gapMission.id}`);
eq('gap mission recovering', r.data?.status, 'Recovering');
check('coverage below 100', r.data?.counters?.coverage_pct < 100, r.data?.counters);
check('crossline agreement computed', r.data?.crossline_agreement?.compared > 0, r.data?.crossline_agreement);
const agreement = r.data.crossline_agreement;
eq('agreement pct consistent', agreement.pct, Math.round((agreement.within / agreement.compared) * 1000) / 10);
eq('meets order', agreement.meets_order, agreement.pct >= 95);

r = await gap.call(`/api/missions/${gapMission.id}/holidays`);
const gapHolidays = r.data.filter((h) => h.status !== 'Closed');
check('a holiday was found', gapHolidays.length >= 1, r.data);
if (gapHolidays.length > 0) {
  const holiday = gapHolidays[0];
  eq('holiday label', holiday.label, 'H1');
  check('three-cell run', holiday.cell_count >= 3, holiday);
  eq('area is cells times 25', holiday.area_m2, holiday.cell_count * 25);
  check('nearest vessel named for staff', holiday.nearest_vessel !== undefined, holiday);

  // The mission is Recovering, so infill is refused with the published code.
  r = await gap.call(`/api/missions/${gapMission.id}/holidays/${holiday.id}/infill`, {
    method: 'POST',
    body: {},
  });
  eq('infill refused off survey', r.data?.error, 'mission_not_surveying');
  eq('infill refusal copy', r.data?.message, 'Infill can be queued only while the mission is surveying');
}

console.log('--- complete and report ---');
r = await tech.call(`/api/missions/${gapMission.id}/transitions`, { method: 'POST', body: { to: 'Complete' } });
eq('lines awaiting upload', r.data?.error, 'lines_awaiting_upload');
eq('awaiting upload copy', r.data?.message, 'Upload every line file before completing');

const stored = new Map();
for (const line of (await gap.call(`/api/missions/${gapMission.id}/lines`)).data) {
  const bytes = Buffer.from(`sonar ${line.label} ${'x'.repeat(64)}`);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const put = await tech.call(`/api/lines/${line.id}/file`, {
    method: 'PUT',
    raw: bytes,
    headers: {
      'content-type': 'application/octet-stream',
      'x-line-file-name': `${line.label}.raw`,
      'x-content-sha256': digest,
    },
  });
  check(`stored ${line.label}`, put.status === 201, put.data);
  stored.set(line.label, digest);
}

r = await tech.call(`/api/missions/${gapMission.id}/transitions`, { method: 'POST', body: { to: 'Complete' } });
eq('vessels afloat', r.data?.error, 'vessels_afloat');
eq('recover copy', r.data?.message, 'Recover every vessel before completing: Gannet');
await tech.call('/api/vessels/v-gannet/recovered', { method: 'POST', body: {} });

const completions = await Promise.all([
  tech.call(`/api/missions/${gapMission.id}/transitions`, { method: 'POST', body: { to: 'Complete' } }),
  tech.call(`/api/missions/${gapMission.id}/transitions`, { method: 'POST', body: { to: 'Complete' } }),
]);
eq(
  'exactly one completion succeeds',
  completions.filter((x) => x.status === 200).length,
  1,
);
eq(
  'the other is refused with 409',
  completions.filter((x) => x.data?.error === 'illegal_transition').length,
  1,
);

let report = null;
for (let attempt = 0; attempt < 30; attempt += 1) {
  r = await gap.call(`/api/missions/${gapMission.id}`);
  if (r.data?.report?.state === 'Ready') {
    report = await gap.call(`/api/missions/${gapMission.id}/report`);
    break;
  }
  await new Promise((done) => setTimeout(done, 500));
}
check('report became Ready', report !== null);
if (report) {
  const sha = createHash('sha256').update(Buffer.from(report.text, 'utf8')).digest('hex');
  eq('report checksum header', report.headers.get('x-content-sha256'), sha);
  const doc = JSON.parse(report.text);
  eq('report key order', Object.keys(doc), [
    'mission_id',
    'mission_name',
    'client_name',
    'completed_at',
    'generated_at',
    'generated_at_local',
    'coverage_pct',
    'open_holidays',
    'crossline_count',
    'crossline_agreement',
    'delivered_lines',
    'vessel_totals',
    'holidays',
  ]);
  eq('report mission', doc.mission_name, 'Gapworth Trial Cut');
  eq('report client', doc.client_name, 'Saltmere Dredging Ltd');
  check('generated_at whole seconds', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(doc.generated_at), doc.generated_at);
  check(
    'generated_at_local carries an offset',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(doc.generated_at_local),
    doc.generated_at_local,
  );
  eq('agreement key order', Object.keys(doc.crossline_agreement), ['compared', 'within', 'pct', 'meets_order']);
  eq('delivered line count', doc.delivered_lines.length, 5);
  eq('delivered entry keys', Object.keys(doc.delivered_lines[0]), [
    'label',
    'kind',
    'file_name',
    'size_bytes',
    'sha256',
    'key',
  ]);
  eq('delivered checksum matches the stored one', doc.delivered_lines[0].sha256, stored.get('L01'));
  eq('object key', doc.delivered_lines[0].key, `lines/${gapMission.id}/${(await gap.call(`/api/missions/${gapMission.id}/lines`)).data[0].id}/L01.raw`);
  eq('vessel totals', doc.vessel_totals.length, 1);
  eq('vessel totals keys', Object.keys(doc.vessel_totals[0]), ['vessel', 'lines', 'length_m', 'covered_m']);
  eq('vessel total name', doc.vessel_totals[0].vessel, 'Gannet');
  eq('vessel total lines', doc.vessel_totals[0].lines, 5);
  check('no insignificant whitespace', !/\n|  /.test(report.text));
  check('no trailing .0', !/\.0[,}\]]/.test(report.text), report.text.slice(0, 200));

  const second = await gap.call(`/api/missions/${gapMission.id}/report`);
  eq('report bytes never change', second.text, report.text);
}

console.log('--- report email ---');
let mail = null;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const inbox = await fetch('http://mailpit:8025/api/v1/messages?limit=200').then((x) => x.json()).catch(() => null);
  if (inbox) {
    const found = (inbox.messages ?? []).filter(
      (m) => m.Subject === 'Coverage report ready — Gapworth Trial Cut',
    );
    if (found.length > 0) {
      mail = found;
      break;
    }
  }
  await new Promise((done) => setTimeout(done, 500));
}
check('report-ready email sent', mail !== null);
if (mail) {
  eq('exactly one report email', mail.length, 1);
  eq('addressed to the reviewer alone', mail[0].To.map((t) => t.Address), ['bram@saltmere-dredging.test']);
  const full = await fetch(`http://mailpit:8025/api/v1/message/${mail[0].ID}`).then((x) => x.json());
  const bodyLines = full.Text.split(/\r?\n/).filter((l) => l.length > 0);
  eq('six published lines', bodyLines.length, 6);
  check('line 1', bodyLines[0] === 'Coverage report ready for Gapworth Trial Cut.', bodyLines[0]);
  check('line 4 carries the report checksum', /^Report SHA-256 [0-9a-f]{64}$/.test(bodyLines[3]), bodyLines[3]);
  check('line 5 shape', /^Coverage [\d.]+% · Open holidays \d+ · Crossline agreement /.test(bodyLines[4]), bodyLines[4]);
  check('line 6 links the survey', bodyLines[5] === `Open the survey: ${process.env.APP_PUBLIC_URL ?? 'http://127.0.0.1:4173'}/surveys/${gapMission.id}`, bodyLines[5]);
  check('no staff address in the body', !full.Text.includes('fathomwright.test'), full.Text);
}

console.log('--- client reads the finished survey ---');
r = await bram.call(`/api/missions/${gapMission.id}`);
eq('reviewer reads the survey', r.status, 200);
eq('report ready for the reviewer', r.data?.report?.state, 'Ready');
eq(
  'link state null once the mission is no longer active',
  r.data?.vessels.every((v) => v.link_state === null),
  true,
);
r = await bram.call(`/api/missions/${gapMission.id}/coverage.csv`);
eq('reviewer downloads the CSV', r.status, 200);
eq('csv name', r.headers.get('content-disposition'), 'attachment; filename="gapworth-trial-cut-coverage.csv"');
eq('other org reviewer blocked from the CSV', (await odile.call(`/api/missions/${gapMission.id}/coverage.csv`)).status, 404);
eq('other org reviewer blocked from the report', (await odile.call(`/api/missions/${gapMission.id}/report`)).status, 404);

console.log('--- mission history ---');
r = await gap.call(`/api/missions/${gapMission.id}/history`);
check('history recorded', r.data?.events?.length > 0, r.data);
check(
  'history newest first',
  r.data.events.every((event, index) => index === 0 || r.data.events[index - 1].at >= event.at),
);
check('creation summary present', JSON.stringify(r.data.events).includes('Mission created'));
r = await gap.call(`/api/missions/${gapMission.id}/history?kinds=status`);
eq('filtered kinds', r.data.events.every((e) => e.kind === 'status'), true);
r = await gap.call(`/api/missions/${gapMission.id}/history?kinds=nonsense`);
eq('bad kind', r.data?.errors?.kinds, 'Choose kinds from the published list');
eq('reviewer cannot read history', (await bram.call(`/api/missions/${gapMission.id}/history`)).status, 403);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
