// Scratch check of the storage outage and recovery behaviour.
const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const KEY = process.env.GRADING_KEY;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

async function api(path, { method = 'GET', body, session, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session ? { cookie: `fs_session=${session}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

const mode = process.argv[2];

if (mode === 'down') {
  check('health unavailable', (await api('/api/health')).body, { status: 'unavailable' });
  const seed = (await api('/api/grading/seed', { method: 'POST', headers: { 'X-Grading-Key': KEY } })).body;
  check('seed still answers', seed.clock, '2026-11-06T09:01:15.000Z');
  const felix = seed.people.felix.session;
  const w = (path) => `/api/w/${seed.workspaces.fernhill.id}${path}`;
  check('explorer works', (await api(w('/blocks'), { session: felix })).body.length, 5);
  check('square works', (await api(w('/blocks/2/shares'), { session: felix })).body.k, 4);
  check('roots work', (await api(w('/blocks/3'), { session: felix })).body.dataRoot, '917f4d16f69e876c76da0cdbc6f8935001e4628f279912d1cbdb1425885f23eb');
  check('proofs work', (await api(w('/blocks/2/proofs?namespace=00000000000000b200'), { session: felix })).body.rows[0].kind, 'inclusion');
  check('mempool works', (await api(w('/mempool'), { session: felix })).body.count, 2);
  check('fraud proof works', (await api(w('/blocks/5/fraud-proof'), { session: felix })).body.committedRoot.hash, 'e192ae6614412c74a5c3172143235d152cdbf258ddd317c74d6acc0ec835defe');
  const submit = await api(w('/blobs'), { method: 'POST', session: felix, body: { namespace: '00000000000000b200', dataBase64: Buffer.from('hello').toString('base64'), fee: '0.006552' } });
  check('submit refused', [submit.status, submit.body], [503, { error: "Storage is unavailable, so blobs can't be submitted right now. The explorer still works." }]);
  check('no blob created', (await api(w('/mempool'), { session: felix })).body.count, 2);
  check('no held fee', (await api(w('/staking/me'), { session: felix })).body.heldUfern, 0);
  const snapshot = await api(w('/blocks/2/snapshot'), { session: felix });
  check('snapshot refused', [snapshot.status, snapshot.body], [503, { error: "Storage is unavailable, so the snapshot can't be downloaded right now." }]);
  check('namespace registration works', (await api(w('/namespaces'), { method: 'POST', session: felix, body: { name: 'Beacon', hex: '00000000000000e500' } })).status, 201);
  check('staking works', (await api(w('/staking/delegate'), { method: 'POST', session: felix, body: { validator: seed.validators.fernhill.cedar.id, amount: '1' } })).status, 201);
  check('voting works', (await api(w('/proposals/3/votes'), { method: 'POST', session: felix, body: { option: 'yes' } })).status, 201);
  check('clock works', (await api('/api/grading/clock', { method: 'POST', headers: { 'X-Grading-Key': KEY }, body: { advanceMs: 15000 } })).body.heights[seed.workspaces.fernhill.id], 6);
  console.log(JSON.stringify({ workspace: seed.workspaces.fernhill.id, felix }));
}

if (mode === 'up') {
  const workspace = process.argv[3];
  const felix = process.argv[4];
  const w = (path) => `/api/w/${workspace}${path}`;
  check('health recovered', (await api('/api/health')).body, { status: 'ok' });
  const snapshot = await fetch(`${BASE}${w('/blocks/2/snapshot')}`, { headers: { cookie: `fs_session=${felix}` } });
  check('snapshot downloads again', [snapshot.status, (await snapshot.arrayBuffer()).byteLength], [200, 8 * 8 * 64]);
  const submit = await api(w('/blobs'), { method: 'POST', session: felix, body: { namespace: '00000000000000b200', dataBase64: Buffer.from('hello').toString('base64'), fee: '0.006552' } });
  check('submit works again', submit.status, 201);
}

console.log(failures === 0 ? '\nOUTAGE CHECKS PASSED' : `\n${failures} OUTAGE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
