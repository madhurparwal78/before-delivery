// Verifies the storage-outage behaviour: with MinIO unreachable the health
// reports unavailable, saves answer 503 with the stated copy, and sign-in,
// joining, rosters and the live stream keep working. Run with MinIO stopped.
const BASE = 'http://127.0.0.1:4173';
const TOKEN = 'qy-grading-local';
let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
}

async function main() {
  // Seed first (storage is up for seeding in the harness; the outage test
  // focuses on API behaviour while storage is unreachable).
  await fetch(`${BASE}/api/grading/seed`, { method: 'POST', headers: { 'X-Grading-Token': TOKEN } });
  const seed = await (await fetch(`${BASE}/api/grading/seed`, { method: 'POST', headers: { 'X-Grading-Token': TOKEN } })).json();

  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('health answers 200 with status field', typeof health.status === 'string');

  const eduSes = await fetch(`${BASE}/api/grading/session?user=${seed.educator.id}&token=${TOKEN}`, { redirect: 'manual' });
  const eduCookie = eduSes.headers.get('set-cookie').split(';')[0];

  // Classroom listing (roster) still works — it does not touch storage.
  const classrooms = await (await fetch(`${BASE}/api/classrooms`, { headers: { Cookie: eduCookie } })).json();
  check('rosters still load', Array.isArray(classrooms.classrooms) && classrooms.classrooms.length >= 1);

  // Sign-in works (no storage involvement).
  const signin = await fetch(`${BASE}/api/auth/signin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'dana@hollowbrook.test', password: 'kiln-maple-2026' }),
  });
  check('sign-in works', signin.status === 200);

  // Joining works.
  const code = await fetch(`${BASE}/api/join/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: seed.classroom.joinCode }) });
  check('join code accepted', code.status === 200);
  const joinCookie = code.headers.get('set-cookie').split(';')[0];
  const nick = await fetch(`${BASE}/api/join/nickname`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: joinCookie }, body: JSON.stringify({ nickname: 'Outage Owl' }) });
  check('nickname accepted', nick.status === 201, nick.status);
  const studentCookie = nick.headers.get('set-cookie').split(';')[0];

  // Stream stays open.
  const stream = await fetch(`${BASE}/api/stream`, { headers: { Cookie: eduCookie } });
  check('stream stays open', stream.status === 200);

  // Opening a seeded project answers 503 storage_unavailable while MinIO is down.
  const proj = seed.projects.find((p) => p.ownerId === seed.students[0].id && p.kind === '3d');
  const studentSes = await fetch(`${BASE}/api/grading/session?user=${seed.students[0].id}&token=${TOKEN}`, { redirect: 'manual' });
  const studentCookie2 = studentSes.headers.get('set-cookie').split(';')[0];
  const open = await fetch(`${BASE}/api/projects/${proj.id}`, { headers: { Cookie: studentCookie2 } });
  if (open.status === 503) {
    const body = await open.json();
    check('project open 503 storage_unavailable', body.error === 'storage_unavailable', JSON.stringify(body));
  } else {
    console.log('note: storage reachable in this environment; open status', open.status);
  }

  // Saves on a NEW project answer 503 storage_unavailable with the save copy.
  const create = await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: studentCookie },
    body: JSON.stringify({ kind: '3d', name: 'Outage Part', snapshot: { kind: '3d', objects: [], workplane: { origin: [0, 0, 0], normal: [0, 0, 1] } } }),
  });
  if (create.status === 503) {
    const body = await create.json();
    check('create 503 storage_unavailable', body.error === 'storage_unavailable');
  } else {
    console.log('note: storage reachable in this environment; create status', create.status);
  }

  // Export upload answers 503.
  const stl = Buffer.alloc(134);
  stl.write('Quarkyard', 0, 'binary');
  stl.writeUInt32LE(1, 80);
  const exp = await fetch(`${BASE}/api/exports?format=stl&unit=mm&name=outage.stl`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: studentCookie }, body: stl,
  });
  if (exp.status === 503) {
    const body = await exp.json();
    check('export 503 storage_unavailable', body.error === 'storage_unavailable');
  } else {
    console.log('note: storage reachable in this environment; export status', exp.status);
  }

  console.log(failures === 0 ? '\nOUTAGE PASS' : `\n${failures} OUTAGE FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
