const BASE = 'http://localhost:4173';
const NOSTORE = 'http://localhost:4175';
const NOMAIL = 'http://localhost:4176';
const KEY = process.env.GRADING_KEY;
const MAILPIT = 'http://mailpit:8025';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ label, ok });
  if (!ok) console.log(`FAIL ${label} ${extra}`);
};

async function call(method, path, { body, session, headers = {}, base = BASE } = {}) {
  const init = { method, headers: { ...headers } };
  if (session) init.headers.cookie = `hs_session=${session}`;
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text.length ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers, text };
}

const grading = (path, base = BASE) =>
  call('POST', `/api/grading/${path}`, { headers: { 'X-Grading-Key': KEY }, base });

await grading('reset');
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);
const seed = (await grading('seed')).body;
const ines = seed.people['ines@lumenyard.test'].session;
const hero = seed.projects['Lumen hero'];
const bay = seed.projects['Model bay'];

// Publish Lumen hero on the healthy copy so the embed has a live version.
await call('POST', `/api/projects/${hero.id}/versions`, {
  session: ines,
  headers: { 'Idempotency-Key': 'outage-pub-1' },
  body: {},
});

// --- Storage outage copy ---
const storageHealth = await call('GET', '/api/health', { base: NOSTORE });
check(
  'health reports unavailable storage',
  storageHealth.status === 200 && storageHealth.body.status === 'unavailable',
  JSON.stringify(storageHealth.body),
);

const uploadForm = new FormData();
uploadForm.set('kind', 'svg');
uploadForm.set(
  'file',
  new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L100 0 L100 100 Z"/></svg>'], {
    type: 'image/svg+xml',
  }),
  'tri.svg',
);
const upload = await fetch(`${NOSTORE}/api/projects/${hero.id}/assets`, {
  method: 'POST',
  headers: { cookie: `hs_session=${ines}` },
  body: uploadForm,
});
const uploadBody = await upload.json();
check(
  'upload refused with outage copy',
  upload.status === 503 &&
    uploadBody.message === 'Storage is unavailable, so uploads are paused. Published scenes still play.',
  `${upload.status} ${JSON.stringify(uploadBody)}`,
);

const publishOutage = await call('POST', `/api/projects/${bay.id}/versions`, {
  session: ines,
  headers: { 'Idempotency-Key': 'outage-pub-2' },
  body: {},
  base: NOSTORE,
});
check(
  'publish refused with outage copy',
  publishOutage.status === 503 &&
    publishOutage.body.message ===
      'Storage is unavailable, so publishing is paused. Published scenes still play.',
  `${publishOutage.status} ${JSON.stringify(publishOutage.body)}`,
);
const bayVersions = await call('GET', `/api/projects/${bay.id}/versions`, { session: ines });
check('no version row after rollback', bayVersions.body.versions.length === 1, JSON.stringify(bayVersions.body.versions));

const embedRow = await call('GET', `/api/embed/${hero.id}/scene`, { base: NOSTORE });
check(
  'embed serves from the version row',
  embedRow.status === 200 &&
    embedRow.headers.get('x-scene-source') === 'row' &&
    embedRow.headers.get('x-halation-version') === '1',
  `${embedRow.status} ${embedRow.headers.get('x-scene-source')}`,
);

const inspectOutage = await call(
  'GET',
  `/api/projects/${hero.id}/inspect?scene=${hero.scenes.Main}&layer=${hero.layers['Halo cube']}`,
  { session: ines, base: NOSTORE },
);
check(
  'inspector keeps working from PostgreSQL',
  inspectOutage.status === 200 && inspectOutage.body.readouts['screen-point'] === '806.85, 231.29 px',
  JSON.stringify(inspectOutage.body.readouts?.['screen-point']),
);

const importForm = new FormData();
importForm.set('workspaceId', seed.workspaces['Lumen Yard']);
importForm.set(
  'file',
  new Blob([JSON.stringify({ schemaVersion: 3, name: 'X', scenes: [{ id: 's', name: 'Main', layers: [] }] })], {
    type: 'application/json',
  }),
  'x.json',
);
const importOutage = await fetch(`${NOSTORE}/api/imports`, {
  method: 'POST',
  headers: { cookie: `hs_session=${ines}` },
  body: importForm,
});
check('import refused during storage outage', importOutage.status === 503, String(importOutage.status));

const seedOutage = await grading('seed', NOSTORE);
check('grading seed refused during storage outage', seedOutage.status === 503, String(seedOutage.status));

// --- Mail outage copy ---
const inviteOutage = await call('POST', `/api/projects/${hero.id}/invites`, {
  session: ines,
  body: { email: 'advisor@lumenyard.test', role: 'Viewer' },
  base: NOMAIL,
});
check(
  'invite succeeds with mail unreachable',
  inviteOutage.status === 201 && ['queued', 'sent'].includes(inviteOutage.body.invite.status),
  `${inviteOutage.status} ${JSON.stringify(inviteOutage.body)}`,
);
const membersDuringOutage = await call('GET', `/api/projects/${hero.id}/members`, {
  session: ines,
  base: NOMAIL,
});
// A healthy copy sharing the database may already have claimed and sent the queued row.
check(
  'invite row recorded',
  membersDuringOutage.body.invites.some(
    (invite) =>
      invite.email === 'advisor@lumenyard.test' && ['queued', 'sent'].includes(invite.status),
  ),
  JSON.stringify(membersDuringOutage.body.invites),
);

const publishNoMail = await call('POST', `/api/projects/${hero.id}/versions`, {
  session: ines,
  headers: { 'Idempotency-Key': 'outage-pub-3' },
  body: {},
  base: NOMAIL,
});
check('publish succeeds with mail unreachable', publishNoMail.status === 201, JSON.stringify(publishNoMail.body));
const versionsNoMail = await call('GET', `/api/projects/${hero.id}/versions`, {
  session: ines,
  base: NOMAIL,
});
check(
  'notice recorded for the new version',
  ['queued', 'sent'].includes(versionsNoMail.body.versions[0].notice),
  JSON.stringify(versionsNoMail.body.versions[0]),
);

// The healthy copy retries the queued rows.
await new Promise((resolve) => setTimeout(resolve, 12000));
const mail = await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json();
const invites = mail.messages.filter((message) => message.To?.[0]?.Address === 'advisor@lumenyard.test');
check('queued invite sent once on recovery', invites.length === 1, String(invites.length));
const notices = mail.messages.filter((message) => message.Subject === 'Lumen hero version 2 is live');
check('queued notices sent once each', notices.length === 2, JSON.stringify(notices.map((m) => m.To?.[0]?.Address)));
const afterRecovery = await call('GET', `/api/projects/${hero.id}/versions`, { session: ines });
check(
  'notice reads sent after recovery',
  afterRecovery.body.versions[0].notice === 'sent',
  JSON.stringify(afterRecovery.body.versions[0]),
);

const failed = results.filter((entry) => !entry.ok).length;
console.log(`${results.length - failed}/${results.length} outage checks passed`);
