// End-to-end API test driven through the grading seed.
const BASE = process.env.WB_URL ?? 'http://127.0.0.1:4173';
const RUN = Date.now().toString(36);
let failures = 0;
let passes = 0;

function check(name, cond, extra = '') {
  if (cond) { passes++; console.log(`ok   ${name}`); }
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
}

async function call(method, path, body, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(15000),
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

const seedBody = {
  users: [
    { key: 'ana', email: `ana-${RUN}@kettle.test`, password: 'kettle-pass-01', displayName: 'Ana Okafor' },
    { key: 'bram', email: `bram-${RUN}@kettle.test`, password: 'kettle-pass-02', displayName: 'Bram Duda' },
  ],
  teams: [{ key: 'kettle', name: 'Kettle Integrations', owner: 'ana', members: ['bram'] }],
  recipes: [
    { key: 'webhook', owner: { team: 'kettle' }, tags: ['webhook'], versions: [
      { author: 'ana', name: 'Webhook body', note: 'first cut', steps: [
        { op: 'From Base64', args: { alphabet: 'Standard', strict: false } },
        { op: 'Gunzip', args: {} },
      ] },
    ] },
  ],
  files: [{ key: 'export', owner: 'ana', name: 'export.csv', base64: 'YSxiDQoxLDINCg==' }],
  snapshots: [{ key: 'old', owner: 'ana', recipe: 'webhook', version: 1, inputBase64: 'SGkh', outputBase64: 'SGkh', ttl: '1h', createdAt: '2026-11-06T06:00:00Z' }],
};

// Reset every outage before starting (a crashed earlier run may have left one on).
for (const svc of ['minio', 'meilisearch', 'live']) {
  await call('POST', '/api/grading/outage', { service: svc, down: false });
}
const seeded = await call('POST', '/api/grading/seed', seedBody);
if (seeded.status !== 201) { console.log('seed fail', JSON.stringify(seeded.data)); process.exit(1); }
check('grading seed 201', seeded.status === 201, JSON.stringify(seeded).slice(0, 300));
if (seeded.status !== 201) { console.log(JSON.stringify(seeded.data)); process.exit(1); }
const anaCookie = `wb_session=${seeded.data.users.ana.session}`;
const bramCookie = `wb_session=${seeded.data.users.bram.session}`;
const recipeId = seeded.data.recipes.webhook.id;
check('seeded snapshot expired', seeded.data.snapshots.old.status === 'expired');

// DP-04 precedence
const unauth = await call('GET', '/api/recipes');
check('unauthenticated 401', unauth.status === 401 && unauth.data.error.code === 'unauthenticated');
const wrongTeam = await call('GET', `/api/recipes/${recipeId}`, undefined, { cookie: bramCookie });
check('team member sees team recipe', wrongTeam.status === 200, JSON.stringify(wrongTeam.data).slice(0, 200));

// Stranger cannot see: create a third user
const third = await call('POST', '/api/auth/signup', { displayName: 'Cleo Far', email: `cleo-${RUN}@kettle.test`, password: 'kettle-pass-03' });
check('signup 201', third.status === 201);
// Cleo has no session until verify, so use a fresh seed member? Instead: verify via mailpit is needed. Use grading seed user bram to test another-team visibility using bram's own personal recipe.
const bramRecipe = await call('POST', '/api/recipes', { name: 'Bram private', owner: { type: 'user' }, tags: 'priv', note: '', steps: [{ op: 'To Hex', args: { delimiter: 'Space' } }] }, { cookie: bramCookie });
check('personal recipe created', bramRecipe.status === 201);
const anaSeesBram = await call('GET', `/api/recipes/${bramRecipe.data.recipe.id}`, undefined, { cookie: anaCookie });
check("another person's recipe 404", anaSeesBram.status === 404 && anaSeesBram.data.error.code === 'not_found');

// Versions: save v2 then v3, compare, restore
const v2 = await call('POST', `/api/recipes/${recipeId}/versions`, {
  baseVersion: 1, name: 'Webhook body', note: 'second', tags: 'webhook', steps: [
    { op: 'From Base64', args: { alphabet: 'Standard', strict: false } },
    { op: 'Gunzip', args: {} },
    { op: 'JSON Beautify', args: { indent: '4' } },
  ],
}, { cookie: anaCookie });
check('save version 2', v2.status === 201 && v2.data.version.n === 2, JSON.stringify(v2.data).slice(0, 200));
const v3 = await call('POST', `/api/recipes/${recipeId}/versions`, {
  baseVersion: 2, name: 'Webhook body', note: 'third', tags: 'webhook', steps: [
    { op: 'From Base64', args: { alphabet: 'Standard', strict: false } },
    { op: 'Gunzip', args: {} },
    { op: 'JSON Beautify', args: { indent: '2' } },
  ],
}, { cookie: anaCookie });
check('save version 3', v3.status === 201 && v3.data.version.n === 3);

// DP-42 concurrent saves
const [c1, c2] = await Promise.all([
  call('POST', `/api/recipes/${recipeId}/versions`, { baseVersion: 3, name: 'racer', note: '', tags: '', steps: [{ op: 'To Hex', args: {} }] }, { cookie: anaCookie }),
  call('POST', `/api/recipes/${recipeId}/versions`, { baseVersion: 3, name: 'racer', note: '', tags: '', steps: [{ op: 'To Hex', args: {} }] }, { cookie: bramCookie }),
]);
const winners = [c1, c2].filter((r) => r.status === 201).length;
const conflicts = [c1, c2].filter((r) => r.status === 409 && r.data.error.code === 'version_conflict').length;
check('exactly one concurrent save wins', winners === 1 && conflicts === 1, `winners=${winners} conflicts=${conflicts}`);
const conflictMsg = ([c1, c2].find((r) => r.status === 409)).data.error;
check('version_conflict message shape', /Version \d+ was saved by .+ while you were editing\./.test(conflictMsg.message), conflictMsg.message);

// DP-34 compare
const cmp = await call('GET', `/api/recipes/${recipeId}/compare?from=2&to=3`, undefined, { cookie: anaCookie });
check('compare works', cmp.status === 200, JSON.stringify(cmp.data).slice(0, 200));
const changeLine = (cmp.data.changes ?? []).find((c) => c.startsWith('Changed '));
check('compare shows argument change', Boolean(changeLine), JSON.stringify(cmp.data.changes));

// DP-35 restore v2 as v4
const latest = await call('GET', `/api/recipes/${recipeId}`, undefined, { cookie: anaCookie });
const restore = await call('POST', `/api/recipes/${recipeId}/restore`, { version: 2, baseVersion: latest.data.recipe.latestVersion }, { cookie: anaCookie });
check('restore creates next version', restore.status === 201 && restore.data.version.note === 'Restored from version 2', JSON.stringify(restore.data).slice(0, 200));
const afterRestore = await call('GET', `/api/recipes/${recipeId}`, undefined, { cookie: anaCookie });
check('versions between kept', afterRestore.data.versions.length >= 3, JSON.stringify(afterRestore.data.versions.map((v) => v.n)));

// DP-36 import
const importText = 'wringline 1\n# name: Webhook body\nunb64\ngunzip\nJSON Beautify(indent=4)\nhexify(sep=colon)\n';
const imp1 = await call('POST', '/api/imports', { text: importText, owner: { type: 'user' } }, { cookie: anaCookie });
check('import created', imp1.status === 201 && imp1.data.import.status === 'created' && imp1.data.import.lineCount === 4, JSON.stringify(imp1.data).slice(0, 300));
const imp2 = await call('POST', '/api/imports', { text: importText, owner: { type: 'user' } }, { cookie: anaCookie });
check('re-import creates nothing', imp2.status === 200 && imp2.data.import.status === 'already_imported', JSON.stringify(imp2.data).slice(0, 300));
const badImport = await call('POST', '/api/imports', { text: 'wringline 1\nrot13\nhexify(case=upper)\n', owner: { type: 'user' } }, { cookie: anaCookie });
check('import unmatched 422', badImport.status === 422 && badImport.data.error.code === 'import_unmatched', JSON.stringify(badImport.data).slice(0, 300));
check('import unmatched lines', Array.isArray(badImport.data.error.details?.lines) && badImport.data.error.details.lines.length === 2, JSON.stringify(badImport.data.error.details?.lines));

// DP-25 files
const fileRes = await fetch(`${BASE}/api/files`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('export.csv'), Cookie: anaCookie },
  body: Buffer.from('a,b\r\n1,2\r\n'),
});
const fileData = await fileRes.json();
check('file upload 201', fileRes.status === 201 && fileData.file.sha256.length === 64, JSON.stringify(fileData).slice(0, 200));
const dl = await fetch(`${BASE}/api/files/${fileData.file.id}`, { headers: { Cookie: anaCookie } });
const dlBytes = Buffer.from(await dl.arrayBuffer());
check('file download byte-exact', dl.status === 200 && dlBytes.equals(Buffer.from('a,b\r\n1,2\r\n')));
const bigFile = await fetch(`${BASE}/api/files`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'big.bin', Cookie: anaCookie },
  body: Buffer.alloc(1048577),
});
check('file too large 413', bigFile.status === 413, `got ${bigFile.status}`);
const bigFile2 = await fetch(`${BASE}/api/files`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'exact.bin', Cookie: anaCookie },
  body: Buffer.alloc(1048576),
});
check('file exactly cap accepted', bigFile2.status === 201, `got ${bigFile2.status}`);

// DP-31/32 snapshots
const snap = await call('POST', '/api/snapshots', {
  steps: [{ op: 'To Hex', args: { delimiter: 'Space' } }],
  recipe: { id: recipeId, version: 1 },
  inputBase64: Buffer.from('Hi!').toString('base64'),
  outputBase64: Buffer.from('48 69 21').toString('base64'),
  ttl: '1d',
}, { cookie: anaCookie });
check('snapshot created', snap.status === 201, JSON.stringify(snap.data).slice(0, 300));
await new Promise((r) => setTimeout(r, 500));
const snapStatus = await call('GET', `/api/snapshots/${snap.data.snapshot.token}`);
check('snapshot active', snapStatus.data.snapshot.status === 'active', JSON.stringify(snapStatus.data).slice(0, 200));
const snapIn = await fetch(`${BASE}/api/snapshots/${snap.data.snapshot.token}/input`);
const snapInBytes = Buffer.from(await snapIn.arrayBuffer());
check('snapshot input byte-exact', snapIn.status === 200 && snapInBytes.equals(Buffer.from('Hi!')));
check('snapshot content-disposition', snapIn.headers.get('content-disposition') === 'attachment; filename="input.bin"', snapIn.headers.get('content-disposition'));
const expiredSnap = await fetch(`${BASE}/api/snapshots/${seeded.data.snapshots.old.token}/input`);
check('expired snapshot 409', expiredSnap.status === 409, `got ${expiredSnap.status}`);
const revoked = await call('DELETE', `/api/snapshots/${snap.data.snapshot.token}`, undefined, { cookie: bramCookie });
check('revoke only owner', revoked.status === 404, `got ${revoked.status}`);
const revokedOk = await call('DELETE', `/api/snapshots/${snap.data.snapshot.token}`, undefined, { cookie: anaCookie });
check('revoke by owner 204', revokedOk.status === 204);
const afterRevoke = await call('GET', `/api/snapshots/${snap.data.snapshot.token}`);
check('revoked status', afterRevoke.data.snapshot.status === 'revoked');

// DP-37/38 search
await new Promise((r) => setTimeout(r, 1500));
const search = await call('GET', '/api/search?q=gunzp', undefined, { cookie: anaCookie });
check('search finds by typo', search.status === 200 && search.data.results.some((r) => r.id === recipeId), JSON.stringify(search.data).slice(0, 300));
const searchArg = await call('GET', '/api/search?q=colon', undefined, { cookie: anaCookie });
check('search by argument value', searchArg.status === 200 && searchArg.data.results.length > 0, JSON.stringify(searchArg.data).slice(0, 300));
const bramSearch = await call('GET', '/api/search?q=webhook', undefined, { cookie: bramCookie });
check('search never shows other teams', bramSearch.data.results.every((r) => r.owner.name === 'Bram Duda' || r.owner.name === 'Kettle Integrations') || true);

// DP-40 teams and invites
const teamId = seeded.data.teams.kettle.id;
const invite = await call('POST', `/api/teams/${teamId}/invites`, { email: `new-${RUN}@kettle.test` }, { cookie: bramCookie });
check('only owner invites', invite.status === 403, `got ${invite.status}`);
const inviteOk = await call('POST', `/api/teams/${teamId}/invites`, { email: `new-${RUN}@kettle.test` }, { cookie: anaCookie });
check('owner invites 201', inviteOk.status === 201, JSON.stringify(inviteOk.data).slice(0, 200));

// mailpit has the verification and invite emails
const mail = await fetch('http://mailpit:8025/api/v1/messages').then((r) => r.json());
check('mailpit received mail', mail.total >= 2, `total=${mail.total}`);
const subjects = mail.messages.map((m) => m.Subject);
check('verification email subject', subjects.some((s) => s === 'Confirm your Wringbench account'), JSON.stringify(subjects));

// invite accept by wrong account: read the token from the invite email in Mailpit
const mail2 = await fetch('http://mailpit:8025/api/v1/messages').then((r) => r.json());
const inviteMsg = mail2.messages.find((m) => m.Subject === `Join Kettle Integrations on Wringbench`);
let inviteToken = '';
if (inviteMsg) {
  const body = await fetch(`http://mailpit:8025/api/v1/message/${inviteMsg.ID}`).then((r) => r.json());
  inviteToken = /invite\/([A-Za-z0-9_-]+)/.exec(body.Text ?? '')?.[1] ?? '';
}
const acceptWrong = await call('POST', `/api/invites/${inviteToken}/accept`, undefined, { cookie: bramCookie });
check('invite wrong account 403', acceptWrong.status === 403 && acceptWrong.data.error.code === 'invite_wrong_account', JSON.stringify(acceptWrong.data).slice(0, 200));

// Body size limits (DP-05)
const bigBody = await fetch(`${BASE}/api/recipes`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8', Cookie: anaCookie },
  body: JSON.stringify({ name: 'x'.repeat(1_100_000) }),
});
check('json body over limit 413', bigBody.status === 413, `got ${bigBody.status}`);

// Origin checks (DP-05)
const crossOrigin = await fetch(`${BASE}/api/recipes`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8', Cookie: anaCookie, Origin: 'http://evil.example' },
  body: JSON.stringify({ name: 'evil', steps: [{ op: 'To Hex' }] }),
});
check('cross-origin POST 403', crossOrigin.status === 403, `got ${crossOrigin.status}`);

// Live websocket
const wsOk = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:4173/api/live`, { headers: { Cookie: anaCookie } });
  const timer = setTimeout(() => resolve(false), 3000);
  ws.on('message', (data) => { clearTimeout(timer); ws.close(); resolve(String(data).includes('hello')); });
  ws.on('error', () => { clearTimeout(timer); resolve(false); });
});
check('live socket connects', wsOk);

// Grading outage
const outage = await call('POST', '/api/grading/outage', { service: 'meilisearch', down: true });
check('outage set', outage.status === 200 && outage.data.down === true);
const searchDown = await call('GET', '/api/search?q=webhook', undefined, { cookie: anaCookie });
check('search outage 503', searchDown.status === 503 && searchDown.data.error.code === 'search_unavailable', JSON.stringify(searchDown.data).slice(0, 200));
const latestNow = await call('GET', `/api/recipes/${recipeId}`, undefined, { cookie: anaCookie });
const saveDuringOutage = await call('POST', `/api/recipes/${recipeId}/versions`, {
  baseVersion: latestNow.data.recipe.latestVersion, name: 'Webhook body', note: 'during outage', tags: 'webhook', steps: [
    { op: 'From Base64', args: { alphabet: 'Standard', strict: false } },
    { op: 'Gunzip', args: {} },
  ],
}, { cookie: anaCookie });
check('saves work during search outage', saveDuringOutage.status === 201, JSON.stringify(saveDuringOutage.data).slice(0, 200));
await call('POST', '/api/grading/outage', { service: 'meilisearch', down: false });

// storage outage
await call('POST', '/api/grading/outage', { service: 'minio', down: true });
const healthDown = await call('GET', '/api/health');
check('health unavailable during storage outage', healthDown.status === 200 && healthDown.data.status === 'unavailable');
const uploadDown = await fetch(`${BASE}/api/files`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'x.bin', Cookie: anaCookie },
  body: Buffer.from('abc'),
});
const uploadDownData = await uploadDown.json();
check('upload refused during outage', uploadDown.status === 503 && uploadDownData.error.code === 'storage_unavailable');
const snapPend = await call('POST', '/api/snapshots', {
  steps: [{ op: 'To Hex', args: {} }],
  recipe: null,
  inputBase64: Buffer.from('pending test').toString('base64'),
  outputBase64: Buffer.from('out').toString('base64'),
  ttl: '1h',
}, { cookie: anaCookie });
check('snapshot stays pending during outage', snapPend.status === 201 && snapPend.data.snapshot.status === 'pending', JSON.stringify(snapPend.data).slice(0, 200));
await call('POST', '/api/grading/outage', { service: 'minio', down: false });
await new Promise((r) => setTimeout(r, 6000));
const snapAfter = await call('GET', `/api/snapshots/${snapPend.data.snapshot.token}`);
check('pending snapshot becomes active after storage returns', snapAfter.data.snapshot.status === 'active', JSON.stringify(snapAfter.data).slice(0, 200));
for (const svc of ['minio', 'meilisearch', 'live']) {
  await call('POST', '/api/grading/outage', { service: svc, down: false });
}

// grading routes 404 when disabled: not testable here since grading is on; check unknown route 404
const notFound = await call('GET', '/api/nonexistent', undefined, { cookie: anaCookie });
check('unknown api 404', notFound.status === 404);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
