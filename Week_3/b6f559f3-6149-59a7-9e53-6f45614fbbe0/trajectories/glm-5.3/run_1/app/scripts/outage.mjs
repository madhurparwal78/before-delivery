// Outage behaviours: storage and mail, against copies pointed at unreachable
// services. Run with: node scripts/outage.mjs (main server on 4173, outage
// copies on 4599 (storage) and 4601 (mail)).
const KEY = process.env.GRADING_KEY ?? 'hs-grading-key-5e1c9a7d';
const MAIN = 'http://127.0.0.1:4173';
const STORAGE_OUT = 'http://127.0.0.1:4599';
const MAIL_OUT = 'http://127.0.0.1:4601';

let failures = 0;
let checks = 0;
function ok(name, cond, extra = '') {
  checks += 1;
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

async function j(path, init = {}) {
  const res = await fetch(path, init);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data, headers: res.headers };
}

async function main() {
  // Clear any mail left by earlier runs.
  await fetch('http://mailpit:8025/api/v1/messages', { method: 'DELETE' }).catch(() => undefined);

  // Reset and seed through the main copy.
  await j(`${MAIN}/api/grading/reset`, { method: 'POST', headers: { 'x-grading-key': KEY } });
  const seed = (await j(`${MAIN}/api/grading/seed`, { method: 'POST', headers: { 'x-grading-key': KEY } })).data;
  const lumenProject = seed.projects['Lumen hero'];
  const lumen = lumenProject.id;
  const modelBay = seed.projects['Model bay'].id;
  const inesCookie = `hs_session=${seed.people['ines@lumenyard.test'].session}`;

  console.log('\n-- storage outage (DP-21)');
  const health = await j(`${STORAGE_OUT}/api/health`);
  ok('health reports unavailable, never 503', health.status === 200 && health.data.status === 'unavailable');
  const embedScene = await fetch(`${STORAGE_OUT}/api/embed/${modelBay}/scene`);
  ok('the embed still serves the live version', embedScene.status === 200);
  ok('the source header names the row', embedScene.headers.get('x-scene-source') === 'row');
  const bundle = await embedScene.text();
  ok('the row bytes parse as the bundle', Boolean(JSON.parse(bundle).scenes));

  const png = Buffer.from(
    '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
      '01f15c4890000000a49444154789c6360000002000154a24f5d0000000049454e44ae426082',
    'hex',
  );
  const upload = new FormData();
  upload.append('kind', 'image');
  upload.append('file', new Blob([png], { type: 'image/png' }), 'x.png');
  const uploadRes = await fetch(`${STORAGE_OUT}/api/projects/${lumen}/assets`, {
    method: 'POST',
    headers: { cookie: inesCookie },
    body: upload,
  });
  const uploadData = await uploadRes.json();
  ok('uploads refuse with the outage text', uploadRes.status === 503 && uploadData.error === 'storage_unavailable' && uploadData.message === 'Storage is unavailable, so uploads are paused. Published scenes still play.', JSON.stringify(uploadData));

  const pubRes = await fetch(`${STORAGE_OUT}/api/projects/${lumen}/versions`, {
    method: 'POST',
    headers: { cookie: inesCookie, 'idempotency-key': 'outage-pub-1', 'content-type': 'application/json' },
    body: '{}',
  });
  const pubData = await pubRes.json();
  ok('publishing refuses with the outage text', pubRes.status === 503 && pubData.message === 'Storage is unavailable, so publishing is paused. Published scenes still play.', JSON.stringify(pubData));

  const importForm = new FormData();
  importForm.append('workspaceId', seed.workspaces['Lumen Yard']);
  importForm.append('file', new Blob([JSON.stringify({ schemaVersion: 3, name: 'X', scenes: [] })], { type: 'application/json' }), 'x.json');
  const importRes = await fetch(`${STORAGE_OUT}/api/imports`, {
    method: 'POST',
    headers: { cookie: inesCookie },
    body: importForm,
  });
  const importData = await importRes.json();
  ok('imports refuse with the outage text', importRes.status === 503 && importData.error === 'storage_unavailable', JSON.stringify(importData));

  // The editor and inspector keep working from PostgreSQL.
  const insp = await j(`${STORAGE_OUT}/api/projects/${lumen}/inspect?scene=${lumenProject.scenes['Main']}&layer=${lumenProject.layers['Halo cube']}`, { headers: { cookie: inesCookie } });
  ok('the inspector keeps working', insp.status === 200 && Boolean(insp.data.readouts['screen-point']));

  console.log('\n-- mail outage (DP-07)');
  const inviteRes = await fetch(`${MAIL_OUT}/api/projects/${seed.projects['Orbit study'].id}/invites`, {
    method: 'POST',
    headers: { cookie: inesCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'queued@example.test', role: 'Editor' }),
  });
  const inviteData = await inviteRes.json();
  ok('the invite still succeeds', inviteRes.status === 201, JSON.stringify(inviteData));
  ok('the invite row shows queued', inviteData.invite.status === 'queued', JSON.stringify(inviteData));
  const members = (await j(`${MAIL_OUT}/api/projects/${seed.projects['Orbit study'].id}/members`, { headers: { cookie: inesCookie } })).data;
  const row = members.invites.find((i) => i.email === 'queued@example.test');
  ok('the members list shows the queued copy', row && row.status === 'queued', JSON.stringify(members.invites));

  // Publishing during the mail outage succeeds and queues the notices.
  const pub2 = await fetch(`${MAIL_OUT}/api/projects/${lumen}/versions`, {
    method: 'POST',
    headers: { cookie: inesCookie, 'idempotency-key': 'mailout-pub-1', 'content-type': 'application/json' },
    body: '{}',
  });
  const pub2data = await pub2.json();
  ok('publishing succeeds during the mail outage', pub2.status === 201, JSON.stringify(pub2data));
  const versions = (await j(`${MAIL_OUT}/api/projects/${lumen}/versions`, { headers: { cookie: inesCookie } })).data;
  const live = versions.versions.find((v) => v.number === pub2data.version.number);
  ok('the notice shows queued', live && live.notice === 'queued', JSON.stringify(versions.versions));

  // When mail works again, each queued mail is sent exactly once.
  await new Promise((r) => setTimeout(r, 11000));
  const mail = await fetch('http://mailpit:8025/api/v1/messages?limit=100');
  const mailData = await mail.json();
  const subjects = mailData.messages.map((m) => m.Subject);
  const joinCount = subjects.filter((s) => s === 'Join Orbit study in Halation Studio').length;
  const noticeCount = subjects.filter((s) => s === `Lumen hero version ${pub2data.version.number} is live`).length;
  ok('the queued invite was sent after recovery', joinCount >= 1, subjects.join(' | '));
  ok(
    'each queued publish notice was sent once per person',
    noticeCount === 2,
    `${noticeCount} notices: ${subjects.join(' | ')}`,
  );

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
