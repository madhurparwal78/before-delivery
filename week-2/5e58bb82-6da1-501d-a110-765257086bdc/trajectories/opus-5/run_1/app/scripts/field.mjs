/** Field-operations and outage walk-through. Not part of the app. */
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:4173';
const DOWN = process.env.DOWN_BASE ?? 'http://127.0.0.1:4199';
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
  constructor(base = BASE) {
    this.base = base;
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
    const response = await fetch(`${this.base}${path}`, {
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
  signIn(email) {
    return this.call('/api/session', {
      method: 'POST',
      body: { email, password: 'chartroom-2026' },
    });
  }
}

function ingest(key, path, body, base = BASE) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-key': key },
    body: JSON.stringify(body),
  }).then(async (response) => ({
    status: response.status,
    data: await response.text().then((t) => (t ? JSON.parse(t) : undefined)),
  }));
}

const INGEST = {
  'v-kittiwake': 'ik-kittiwake-4c19',
  'v-petrel': 'ik-petrel-8a03',
  'v-shearwater': 'ik-shearwater-2e77',
  'v-gannet': 'ik-gannet-61b5',
};

const ira = new Session();
const wren = new Session();
const tamsin = new Session();
await ira.signIn('ira@fathomwright.test');
await wren.signIn('wren@fathomwright.test');
await tamsin.signIn('tamsin@fathomwright.test');

let r;

console.log('--- a surveying mission for the field tests ---');
const AREA = [
  { easting: 7000, northing: 1000 },
  { easting: 7080, northing: 1000 },
  { easting: 7080, northing: 1100 },
  { easting: 7000, northing: 1100 },
];
const FENCE = [
  { easting: 6960, northing: 960 },
  { easting: 7120, northing: 960 },
  { easting: 7120, northing: 1140 },
  { easting: 6960, northing: 1140 },
];
r = await ira.call('/api/missions', {
  method: 'POST',
  body: {
    name: 'Fieldwork Reach',
    client_org_id: 'org-calderhaven',
    survey_date: '2026-11-09',
    survey_area: AREA,
    geofence: FENCE,
    planned_depth_m: 5,
    swath_ratio: 4,
    overlap_pct: 0,
    line_azimuth_deg: 0,
    planned_speed_mps: 2,
    survey_order: '1a',
  },
});
eq('field mission created', r.status, 201);
const field = r.data;
let fieldLines = (await ira.call(`/api/missions/${field.id}/lines`)).data;

// Shearwater is free after its service in the smoke run; Kittiwake may be busy.
const freeVessel = await (async () => {
  for (const id of ['v-shearwater', 'v-gannet', 'v-kittiwake', 'v-petrel']) {
    const vessel = (await ira.call(`/api/vessels/${id}`)).data;
    if (vessel && vessel.mission_id === null && !vessel.service_overdue) return vessel;
  }
  return null;
})();
check('a free vessel is available', freeVessel !== null);
const vesselId = freeVessel.id;
const vesselName = freeVessel.name;

r = await ira.call(`/api/missions/${field.id}/assignments`, {
  method: 'POST',
  body: { assignments: fieldLines.map((l) => ({ line_id: l.id, vessel_id: vesselId })) },
});
eq('field assignments saved', r.status, 200);
await tamsin.call(`/api/vessels/${vesselId}/afloat`, { method: 'POST', body: {} });
r = await ira.call(`/api/missions/${field.id}/transitions`, { method: 'POST', body: { to: 'Launched' } });
eq('field mission launched', r.data?.status, 'Launched');

const fieldBase = Date.parse('2026-11-09T07:00:00Z');
let clock = 0;
const at = (seconds) => new Date(fieldBase + seconds * 1000).toISOString();

async function runLine(line, options = {}) {
  await ingest(INGEST[vesselId], `/api/ingest/lines/${line.id}/start`, {});
  const vertical = Math.abs(line.end.northing - line.start.northing) > Math.abs(line.end.easting - line.start.easting);
  const fixes = [];
  for (let step = 0; step <= 20; step += 1) {
    const ratio = step / 20;
    clock += 10;
    if (options.skipFrom !== undefined && ratio > options.skipFrom && ratio < options.skipTo) continue;
    fixes.push({
      t: at(clock),
      easting: line.start.easting + (line.end.easting - line.start.easting) * ratio,
      northing: line.start.northing + (line.end.northing - line.start.northing) * ratio,
      heading_deg: vertical ? 0 : 90,
      speed_mps: 1,
      battery_pct: 70,
      depth_m: 5,
    });
  }
  await ingest(INGEST[vesselId], '/api/ingest/fixes', { fixes });
  if (!options.leaveRunning) await ingest(INGEST[vesselId], `/api/ingest/lines/${line.id}/end`, {});
}

// Run the first line so the mission becomes Surveying, leaving a gap on L02.
await runLine(fieldLines[0]);
await runLine(fieldLines[1], { skipFrom: 0.3, skipTo: 0.7 });
r = await ira.call(`/api/missions/${field.id}`);
eq('field mission surveying', r.data?.status, 'Surveying');

console.log('--- queue infill while surveying ---');
r = await ira.call(`/api/missions/${field.id}/holidays`);
const holiday = r.data.find((h) => h.status === 'Open');
check('an open holiday exists', holiday !== undefined, r.data);
if (holiday) {
  eq('nearest eligible vessel named', holiday.nearest_vessel?.name, vesselName);
  const [first, second] = await Promise.all([
    ira.call(`/api/missions/${field.id}/holidays/${holiday.id}/infill`, { method: 'POST', body: {} }),
    ira.call(`/api/missions/${field.id}/holidays/${holiday.id}/infill`, { method: 'POST', body: {} }),
  ]);
  const statuses = [first.status, second.status].sort();
  eq('simultaneous queues: one 201 and one 200', statuses, [200, 201]);
  eq('both name the same line', first.data?.line?.id, second.data?.line?.id);
  const infill = first.status === 201 ? first.data : second.data;
  eq('infill label', infill.line.label, 'I01');
  eq('infill assigned to the nearest vessel', infill.line.vessel_id, vesselId);
  eq('counters returned', typeof infill.counters?.coverage_pct, 'number');

  r = await ira.call(`/api/missions/${field.id}/holidays`);
  eq('holiday becomes Queued', r.data.find((h) => h.id === holiday.id)?.status, 'Queued');

  console.log('--- infill queue order ---');
  r = await ira.call(`/api/missions/${field.id}/vessels/${vesselId}/infill-order`);
  eq('queue holds the infill line', r.data?.line_ids, [infill.line.id]);
  r = await ira.call(`/api/missions/${field.id}/vessels/${vesselId}/infill-order`, {
    method: 'PUT',
    body: { line_ids: [infill.line.id, infill.line.id] },
  });
  eq('duplicate ids refused', r.data?.errors?.line_ids, 'Send each infill line id once');
  r = await ira.call(`/api/missions/${field.id}/vessels/${vesselId}/infill-order`, {
    method: 'PUT',
    body: { line_ids: [] },
  });
  eq('stale order refused', r.data?.error, 'stale_order');
  r = await ira.call(`/api/missions/${field.id}/vessels/${vesselId}/infill-order`, {
    method: 'PUT',
    body: { line_ids: [infill.line.id] },
  });
  eq('exact queue stored', r.data?.line_ids, [infill.line.id]);

  console.log('--- running the infill closes the holiday ---');
  fieldLines = (await ira.call(`/api/missions/${field.id}/lines`)).data;
  const infillLine = fieldLines.find((l) => l.id === infill.line.id);
  await runLine(infillLine);
  r = await ira.call(`/api/missions/${field.id}/holidays`);
  const after = r.data.find((h) => h.id === holiday.id);
  check('the holiday closed or shrank', after.status === 'Closed' || after.cell_count < holiday.cell_count, after);
}

console.log('--- weather hold ---');
r = await ira.call(`/api/missions/${field.id}/hold`, { method: 'POST', body: { reason: 'no' } });
eq('short reason refused', r.data?.errors?.reason, 'Give a reason of 3 to 120 characters');
r = await ira.call(`/api/missions/${field.id}/hold`, { method: 'POST', body: { reason: 'Gale warning' } });
eq('mission held', r.data?.hold?.reason, 'Gale warning');
eq('hold records who', r.data?.hold?.by, 'Ira Penhallow');
r = await ira.call(`/api/missions/${field.id}/hold`, { method: 'POST', body: { reason: 'Gale warning' } });
eq('already held', r.data?.error, 'mission_on_hold');
fieldLines = (await ira.call(`/api/missions/${field.id}/lines`)).data;
const pendingLine = fieldLines.find((l) => l.status === 'Assigned');
if (pendingLine) {
  r = await ingest(INGEST[vesselId], `/api/ingest/lines/${pendingLine.id}/start`, {});
  eq('line start refused while held', r.data?.error, 'mission_on_hold');
}
r = await ira.call(`/api/missions/${field.id}/resume`, { method: 'POST', body: {} });
eq('resumed', r.data?.hold, null);
r = await ira.call(`/api/missions/${field.id}/resume`, { method: 'POST', body: {} });
eq('resume without a hold', r.data?.error, 'mission_not_on_hold');

console.log('--- geofence change mid-survey ---');
const geofenceVersion = (await ira.call(`/api/missions/${field.id}`)).data.version;
r = await ira.call(`/api/missions/${field.id}/geofence`, {
  method: 'PUT',
  body: {
    geofence: [{ easting: 0, northing: 0 }, { easting: 1, northing: 0 }],
    version: geofenceVersion,
  },
});
eq('too few corners', r.data?.errors?.geofence, 'Enter 3 to 40 geofence corners as easting, northing');
r = await ira.call(`/api/missions/${field.id}/geofence`, {
  method: 'PUT',
  body: {
    geofence: [
      { easting: 7020, northing: 1020 },
      { easting: 7040, northing: 1020 },
      { easting: 7040, northing: 1040 },
      { easting: 7020, northing: 1040 },
    ],
    version: (await ira.call(`/api/missions/${field.id}`)).data.version,
  },
});
eq('a fence that does not enclose the area', r.data?.errors?.geofence, 'The geofence must enclose the survey area');
const currentVersion = (await ira.call(`/api/missions/${field.id}`)).data.version;
r = await ira.call(`/api/missions/${field.id}/geofence`, {
  method: 'PUT',
  body: { geofence: FENCE, version: currentVersion - 1 },
});
eq('stale mission version', r.data?.error, 'stale_version');
check('stale answer carries the current mission', r.data?.current?.id === field.id, r.data?.current?.id);
const widened = [
  { easting: 6900, northing: 900 },
  { easting: 7200, northing: 900 },
  { easting: 7200, northing: 1200 },
  { easting: 6900, northing: 1200 },
];
r = await ira.call(`/api/missions/${field.id}/geofence`, {
  method: 'PUT',
  body: { geofence: widened, version: currentVersion },
});
eq('geofence replaced', r.data?.geofence?.length, 4);
eq('version rose', r.data?.version, currentVersion + 1);

console.log('--- owner-only actions and handover ---');
r = await wren.call(`/api/missions/${field.id}/transitions`, { method: 'POST', body: { to: 'Aborted' } });
eq('not the owner', r.data?.error, 'not_mission_owner');
eq('owner-only copy', r.data?.message, 'Only Ira Penhallow can do this for Fieldwork Reach.');
r = await wren.call(`/api/missions/${field.id}/hold`, { method: 'POST', body: { reason: 'Trying it on' } });
eq('hold is owner only', r.data?.error, 'not_mission_owner');

const handoverVersion = (await ira.call(`/api/missions/${field.id}`)).data.version;
r = await ira.call(`/api/missions/${field.id}/handover`, {
  method: 'POST',
  body: { to_user_id: 'u-tamsin', version: handoverVersion },
});
eq('a technician is not a handover target', r.data?.errors?.to_user_id, 'Choose another principal surveyor');
r = await ira.call(`/api/missions/${field.id}/handover`, {
  method: 'POST',
  body: { to_user_id: 'u-ira', version: handoverVersion },
});
eq('cannot hand to oneself', r.data?.errors?.to_user_id, 'Choose another principal surveyor');
const handovers = await Promise.all([
  ira.call(`/api/missions/${field.id}/handover`, { method: 'POST', body: { to_user_id: 'u-wren', version: handoverVersion } }),
  ira.call(`/api/missions/${field.id}/handover`, { method: 'POST', body: { to_user_id: 'u-wren', version: handoverVersion } }),
]);
eq('exactly one handover succeeds', handovers.filter((x) => x.status === 200).length, 1);
check(
  'the other is refused',
  handovers.filter((x) => ['stale_version', 'not_mission_owner'].includes(x.data?.error)).length === 1,
  handovers.map((x) => x.data?.error),
);
r = await ira.call(`/api/missions/${field.id}`);
eq('new owner', r.data?.owner_name, 'Wren Calloway');
r = await ira.call(`/api/missions/${field.id}/hold`, { method: 'POST', body: { reason: 'Former owner' } });
eq('former owner refused', r.data?.error, 'not_mission_owner');

let handoverMail = null;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const inbox = await fetch('http://mailpit:8025/api/v1/messages?limit=300').then((x) => x.json()).catch(() => null);
  const found = (inbox?.messages ?? []).filter((m) => m.Subject === 'Fieldwork Reach handed to you');
  if (found.length > 0) {
    handoverMail = found;
    break;
  }
  await new Promise((done) => setTimeout(done, 500));
}
check('handover email sent', handoverMail !== null);
if (handoverMail) {
  eq('exactly one handover email', handoverMail.length, 1);
  eq('addressed to the new owner', handoverMail[0].To.map((t) => t.Address), ['wren@fathomwright.test']);
  const full = await fetch(`http://mailpit:8025/api/v1/message/${handoverMail[0].ID}`).then((x) => x.json());
  check(
    'handover body copy',
    /^Ira Penhallow handed Fieldwork Reach to you at \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\.$/.test(full.Text.trim()),
    full.Text,
  );
}

console.log('--- re-run a line ---');
fieldLines = (await wren.call(`/api/missions/${field.id}/lines`)).data;
const surveyed = fieldLines.find((l) => l.status === 'Surveyed' && l.kind !== 'infill');
check('a surveyed line to re-run', surveyed !== undefined, fieldLines.map((l) => [l.label, l.status]));
if (surveyed) {
  r = await wren.call(`/api/missions/${field.id}/lines/${surveyed.id}/rerun`, { method: 'POST', body: { reason: 'ab' } });
  eq('short reason refused', r.data?.errors?.reason, 'Give a reason of 3 to 200 characters');
  r = await wren.call(`/api/missions/${field.id}/lines/${surveyed.id}/rerun`, {
    method: 'POST',
    body: { reason: 'Poor data in the turn' },
  });
  eq('re-run created', r.status, 201);
  const rerun = r.data.line;
  eq('re-run label', rerun.label, `${surveyed.label}R1`);
  eq('re-run starts Pending', rerun.status, 'Pending');
  eq('re-run links its original', rerun.rerun_of, surveyed.id);
  r = await wren.call(`/api/missions/${field.id}/lines/${surveyed.id}/rerun`, {
    method: 'POST',
    body: { reason: 'Again' },
  });
  eq('an open re-run blocks another', r.data?.error, 'rerun_open');

  const ordered = (await wren.call(`/api/missions/${field.id}/lines`)).data.map((l) => l.label);
  eq(
    're-run lists right after its original',
    ordered[ordered.indexOf(surveyed.label) + 1],
    `${surveyed.label}R1`,
  );

  // Running and delivering the re-run supersedes the original.
  await wren.call(`/api/missions/${field.id}/assignments`, {
    method: 'POST',
    body: { assignments: [{ line_id: rerun.id, vessel_id: vesselId }] },
  });
  const rerunLine = (await wren.call(`/api/missions/${field.id}/lines`)).data.find((l) => l.id === rerun.id);
  await runLine(rerunLine);
  const bytes = Buffer.from('re-run sonar bytes');
  const digest = createHash('sha256').update(bytes).digest('hex');
  r = await tamsin.call(`/api/lines/${rerun.id}/file`, {
    method: 'PUT',
    raw: bytes,
    headers: {
      'content-type': 'application/octet-stream',
      'x-line-file-name': 'rerun.raw',
      'x-content-sha256': digest,
    },
  });
  eq('re-run delivered', r.data?.status, 'Delivered');
  r = await wren.call(`/api/missions/${field.id}/lines`);
  eq('original superseded', r.data.find((l) => l.id === surveyed.id)?.status, 'Superseded');
  r = await tamsin.call(`/api/lines/${surveyed.id}/file`, {
    method: 'PUT',
    raw: bytes,
    headers: {
      'content-type': 'application/octet-stream',
      'x-line-file-name': 'late.raw',
      'x-content-sha256': digest,
    },
  });
  eq('a superseded line takes no upload', r.data?.error, 'line_not_surveyed');
  r = await wren.call(`/api/missions/${field.id}/coverage.csv`);
  check('superseded keeps its CSV row', r.text.includes(`,${surveyed.label},`), r.text.slice(0, 200));
  check('superseded row reads Superseded', /,Superseded,/.test(r.text), r.text.slice(0, 400));
}

console.log('--- link-lost alert and infill reassignment ---');
r = await ira.call('/api/vessels');
const watched = r.data.find((v) => v.id === vesselId);
check('vessel is afloat on an active mission', watched.afloat === true, watched);
eq('a vessel that has just reported is Live', watched.link_state, 'Live');
// Link state is decided from the age of the last received fix, by the server's clock.
let observed = null;
for (let attempt = 0; attempt < 90; attempt += 1) {
  observed = (await ira.call(`/api/vessels/${vesselId}`)).data.link_state;
  if (observed === 'Lost') break;
  await new Promise((done) => setTimeout(done, 1000));
}
eq('the vessel turns Lost once its fixes age out', observed, 'Lost');
let lostAlert = null;
for (let attempt = 0; attempt < 16; attempt += 1) {
  const alerts = (await ira.call('/api/alerts?status=open')).data;
  lostAlert = alerts.find((a) => a.kind === 'link_lost' && a.vessel_id === vesselId);
  if (lostAlert) break;
  await new Promise((done) => setTimeout(done, 500));
}
check('link-lost alert raised', lostAlert !== null && lostAlert !== undefined, lostAlert);
if (lostAlert) {
  eq('link-lost heading', lostAlert.heading, `Link lost — ${vesselName}`);
  eq('history starts Active', lostAlert.history[0].state, 'Active');
  r = await ira.call(`/api/alerts/${lostAlert.id}/ack`, { method: 'POST', body: {} });
  eq('acknowledged', r.data?.state, 'Acknowledged');
  const repeat = await ira.call(`/api/alerts/${lostAlert.id}/ack`, { method: 'POST', body: {} });
  eq('a repeat returns the alert unchanged', repeat.data?.history.length, r.data.history.length);
  // A new accepted fix ends the lost spell and closes the acknowledged alert.
  clock += 10;
  await ingest(INGEST[vesselId], '/api/ingest/fixes', {
    t: at(clock),
    easting: 7020,
    northing: 1050,
    heading_deg: 0,
    speed_mps: 1,
    battery_pct: 60,
    depth_m: 5,
  });
  const all = (await ira.call('/api/alerts?status=all')).data;
  eq('cleared alert closes', all.find((a) => a.id === lostAlert.id)?.state, 'Closed');
}

console.log('--- alert emails ---');
const inbox = await fetch('http://mailpit:8025/api/v1/messages?limit=400').then((x) => x.json()).catch(() => null);
if (inbox) {
  const breachMails = (inbox.messages ?? []).filter((m) => m.Subject.startsWith('Geofence breach —'));
  if (breachMails.length > 0) {
    const recipients = new Set(breachMails.flatMap((m) => m.To.map((t) => t.Address)));
    check(
      'breach email goes only to principal surveyors',
      [...recipients].every((address) => ['ira@fathomwright.test', 'wren@fathomwright.test'].includes(address)),
      [...recipients],
    );
    for (const mail of breachMails) eq('one recipient per message', mail.To.length, 1);
  }
  const overdueMails = (inbox.messages ?? []).filter((m) => m.Subject.startsWith('Service overdue —'));
  if (overdueMails.length > 0) {
    const recipients = new Set(overdueMails.flatMap((m) => m.To.map((t) => t.Address)));
    check(
      'service-overdue email reaches the technician too',
      recipients.has('tamsin@fathomwright.test'),
      [...recipients],
    );
  }
  const clientLeak = (inbox.messages ?? []).filter(
    (m) =>
      (m.Subject.startsWith('Geofence breach') || m.Subject.startsWith('Link lost')) &&
      m.To.some((t) => /calderhaven-port|saltmere-dredging/.test(t.Address)),
  );
  eq('alert email never reaches a client reviewer', clientLeak.length, 0);
}

console.log('--- abandoned upload leaves nothing behind ---');
const abandonLine = (await wren.call(`/api/missions/${field.id}/lines`)).data.find(
  (l) => l.status === 'Surveyed',
);
if (abandonLine) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const controller = new AbortController();
    const body = new ReadableStream({
      start(sink) {
        sink.enqueue(new Uint8Array(1024));
        // The body is never finished, and the client goes away.
        setTimeout(() => controller.abort(), 15);
      },
    });
    await fetch(`${BASE}/api/lines/${abandonLine.id}/file`, {
      method: 'PUT',
      headers: {
        cookie: tamsin.cookie,
        'content-type': 'application/octet-stream',
        'content-length': '5000000',
        'x-line-file-name': 'abandoned.raw',
        'x-content-sha256': 'b'.repeat(64),
      },
      body,
      duplex: 'half',
      signal: controller.signal,
    }).catch(() => undefined);
  }
  const started = Date.now();
  const health = await fetch(`${BASE}/api/health`);
  eq('health still answers', health.status, 200);
  check('health answers within a second', Date.Now === undefined && Date.now() - started < 1000, Date.now() - started);
  r = await wren.call(`/api/missions/${field.id}/lines`);
  eq(
    'the line is untouched',
    r.data.find((l) => l.id === abandonLine.id)?.file?.state,
    'Awaiting upload',
  );
  const good = Buffer.from('a complete upload after the abandoned ones');
  const goodSha = createHash('sha256').update(good).digest('hex');
  const t0 = Date.now();
  r = await tamsin.call(`/api/lines/${abandonLine.id}/file`, {
    method: 'PUT',
    raw: good,
    headers: {
      'content-type': 'application/octet-stream',
      'x-line-file-name': 'after.raw',
      'x-content-sha256': goodSha,
    },
  });
  eq('a complete upload succeeds at once', r.status, 201);
  check('and within ten seconds', Date.now() - t0 < 10_000, Date.now() - t0);
}

console.log('--- resumable upload in parts ---');
const partLine = (await wren.call(`/api/missions/${field.id}/lines`)).data.find(
  (l) => l.status === 'Surveyed',
);
if (partLine) {
  const big = Buffer.alloc(9_000_000, 7);
  const bigSha = createHash('sha256').update(big).digest('hex');
  r = await tamsin.call(`/api/lines/${partLine.id}/uploads`, {
    method: 'POST',
    body: { size_bytes: big.byteLength, sha256: bigSha },
  });
  eq('upload opened', r.status, 201);
  eq('part size', r.data?.part_bytes, 4_000_000);
  const uploadId = r.data.upload_id;
  const again = await tamsin.call(`/api/lines/${partLine.id}/uploads`, {
    method: 'POST',
    body: { size_bytes: big.byteLength, sha256: bigSha },
  });
  eq('an open upload is returned', [again.status, again.data?.upload_id], [200, uploadId]);
  r = await tamsin.call(`/api/lines/${partLine.id}/uploads`, {
    method: 'POST',
    body: { size_bytes: 0, sha256: bigSha },
  });
  eq('size validation', r.data?.errors?.size_bytes, 'The file must be 1 to 50,000,000 bytes');

  let sent = 0;
  let last = null;
  while (sent < big.byteLength) {
    const end = Math.min(big.byteLength, sent + 4_000_000);
    if (sent === 4_000_000) {
      const wrong = await tamsin.call(`/api/lines/${partLine.id}/uploads/${uploadId}`, {
        method: 'PUT',
        raw: big.subarray(0, 10),
        headers: {
          'content-type': 'application/octet-stream',
          'content-range': `bytes 0-9/${big.byteLength}`,
        },
      });
      eq('a part that does not continue', wrong.data?.error, 'range_mismatch');
      eq('range mismatch reports the received bytes', wrong.data?.received_bytes, sent);
    }
    last = await tamsin.call(`/api/lines/${partLine.id}/uploads/${uploadId}`, {
      method: 'PUT',
      raw: big.subarray(sent, end),
      headers: {
        'content-type': 'application/octet-stream',
        'content-range': `bytes ${sent}-${end - 1}/${big.byteLength}`,
        'x-line-file-name': 'big.raw',
      },
    });
    if (last.status === 201) break;
    sent = last.data.received_bytes;
  }
  eq('the final part delivers the line', [last.status, last.data?.status], [201, 'Delivered']);
  eq('stored checksum', last.data?.file?.sha256, bigSha);
  eq('stored size', last.data?.file?.size_bytes, big.byteLength);
  r = await tamsin.call(`/api/lines/${partLine.id}/file`);
  eq('the stored bytes come back whole', r.text.length, big.byteLength);
}

console.log('--- a dependency down at boot ---');
// The second instance runs on its own database and is pointed at dead storage
// and mail, so it exercises the outage paths from boot.
r = await fetch(`${DOWN}/api/health`).then((x) => x.json()).catch(() => null);
eq('health answers with storage and mail down', r, { status: 'ok' });

const downSurveyor = new Session(DOWN);
const downTech = new Session(DOWN);
await downSurveyor.signIn('ira@fathomwright.test');
await downTech.signIn('tamsin@fathomwright.test');

let downStatus = null;
for (let attempt = 0; attempt < 40; attempt += 1) {
  downStatus = (await downTech.call('/api/status')).data;
  if (downStatus?.storage === 'down' && downStatus?.mail === 'down') break;
  await new Promise((done) => setTimeout(done, 500));
}
eq('status reports both down within 15 s', downStatus, { storage: 'down', mail: 'down' });

// A surveyed line on that instance, so an upload can reach storage.
const downMission = 'm-saltmere-approach';
const downLines = (await downSurveyor.call(`/api/missions/${downMission}/lines`)).data;
await downSurveyor.call(`/api/missions/${downMission}/assignments`, {
  method: 'POST',
  body: { assignments: downLines.map((l) => ({ line_id: l.id, vessel_id: 'v-gannet' })) },
});
await downTech.call('/api/vessels/v-gannet/afloat', { method: 'POST', body: {} });
await downSurveyor.call(`/api/missions/${downMission}/transitions`, {
  method: 'POST',
  body: { to: 'Launched' },
});
await ingest(INGEST['v-gannet'], `/api/ingest/lines/${downLines[0].id}/start`, {}, DOWN);
await ingest(
  INGEST['v-gannet'],
  '/api/ingest/fixes',
  {
    t: new Date().toISOString(),
    easting: 1010,
    northing: 2010,
    heading_deg: 0,
    speed_mps: 1,
    battery_pct: 50,
    depth_m: 6,
  },
  DOWN,
);
await ingest(INGEST['v-gannet'], `/api/ingest/lines/${downLines[0].id}/end`, {}, DOWN);
r = await downSurveyor.call(`/api/missions/${downMission}/lines`);
eq(
  'a line is surveyed even with storage down',
  r.data.find((l) => l.id === downLines[0].id)?.status,
  'Surveyed',
);

const downPayload = Buffer.from('bytes while storage is down');
const downSha = createHash('sha256').update(downPayload).digest('hex');
const startedUpload = Date.now();
r = await downTech.call(`/api/lines/${downLines[0].id}/file`, {
  method: 'PUT',
  raw: downPayload,
  headers: {
    'content-type': 'application/octet-stream',
    'x-line-file-name': 'down.raw',
    'x-content-sha256': downSha,
  },
});
eq('upload answers the storage 503', r.status, 503);
eq('fixed storage body', r.data, {
  error: 'storage_unavailable',
  message: 'Storage is unavailable. Try again in a moment.',
});
eq('retry header', r.headers.get('retry-after'), '30');
check('within five seconds', Date.now() - startedUpload < 5000, Date.now() - startedUpload);
check(
  'the body reveals nothing of the host, port, bucket or SDK',
  !/minio|127\.0\.0\.1|:9\b|gf-dev|ECONNREFUSED|S3|bucket|aws/i.test(r.text),
  r.text,
);
r = await downSurveyor.call(`/api/missions/${downMission}/lines`);
eq(
  'the line stays awaiting upload',
  r.data.find((l) => l.id === downLines[0].id)?.file?.state,
  'Awaiting upload',
);

r = await downSurveyor.call(`/api/missions/${downMission}/report`);
eq('report read answers the storage 503 before any 409', r.status, 503);
eq('report retry header', r.headers.get('retry-after'), '30');

// A file recorded as Stored, so the download paths and controls can be checked.
await (async () => {
  const { default: pg } = await import('pg');
  const url = `${process.env.DATABASE_URL}?options=${encodeURIComponent('-c search_path=downtest')}`;
  const client = new pg.Pool({ connectionString: url });
  await client.query(
    `UPDATE lines SET status = 'Delivered', file_state = 'Stored', file_name = 'down.raw',
       file_size = $2, file_sha256 = $3, file_stored_at = now() WHERE id = $1`,
    [downLines[0].id, downPayload.byteLength, downSha],
  );
  await client.end();
})();

r = await downTech.call(`/api/lines/${downLines[0].id}/file`);
eq('line-file download answers the storage 503', r.status, 503);
eq('download retry header', r.headers.get('retry-after'), '30');

console.log('--- the launch list and survey through a storage outage ---');
{
  const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(`${DOWN}/sign-in`);
  await page.getByRole('textbox', { name: 'Email' }).fill('tamsin@fathomwright.test');
  await page.locator('#sign-in-password').fill('chartroom-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/launch/);
  await page.getByRole('region', { name: 'Fleet service' }).waitFor();
  eq(
    'the launch list still shows',
    await page.getByRole('heading', { name: 'Launch list' }).isVisible(),
    true,
  );
  await page.waitForFunction(
    () => (document.querySelector('[aria-label="Service status"]')?.textContent ?? '').length > 0,
    null,
    { timeout: 20000 },
  );
  eq(
    'storage outage banner',
    (await page.locator('[aria-label="Service status"]').innerText()).trim(),
    'Line-file storage is unreachable — uploads are paused and will resume on their own.',
  );

  const reviewer = await browser.newPage();
  await reviewer.goto(`${DOWN}/sign-in`);
  await reviewer.getByRole('textbox', { name: 'Email' }).fill('bram@saltmere-dredging.test');
  await reviewer.locator('#sign-in-password').fill('chartroom-2026');
  await reviewer.getByRole('button', { name: 'Sign in' }).click();
  await reviewer.waitForURL(/\/surveys/);
  await reviewer.goto(`${DOWN}/surveys/${downMission}`);
  await reviewer.getByRole('table', { name: 'Line files' }).waitFor();
  await reviewer.waitForFunction(
    () => document.querySelectorAll('button[aria-label^="Download "]').length > 0,
    null,
    { timeout: 20000 },
  );
  const disabled = reviewer.locator('button[aria-label^="Download "]');
  eq('download control is a disabled button', await disabled.first().isDisabled(), true);
  eq(
    'visible text',
    (await disabled.first().innerText()).trim(),
    'Storage unavailable',
  );
  eq('and not a link', await reviewer.getByRole('link', { name: /^Download L/ }).count(), 0);
  await browser.close();
}

console.log(`\n${checks - failures}/${checks} field checks passed`);
if (failures > 0) process.exitCode = 1;
