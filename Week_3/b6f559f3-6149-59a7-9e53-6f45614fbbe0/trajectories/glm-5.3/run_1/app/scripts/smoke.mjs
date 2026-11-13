// End-to-end API test: exercises the published behaviours against a running
// server. Run with: node scripts/smoke.mjs
const BASE = 'http://127.0.0.1:4173';
const KEY = process.env.GRADING_KEY ?? 'hs-grading-key-5e1c9a7d';

let failures = 0;
let checks = 0;

function ok(name, cond, extra = '') {
  checks += 1;
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

async function req(path, init = {}) {
  const headers = {};
  if (init.body && typeof init.body === 'string') headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  if (init.grading) headers['x-grading-key'] = KEY;
  if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey;
  const res = await fetch(BASE + path, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
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

async function findInviteToken() {
  const mail = await fetch('http://mailpit:8025/api/v1/messages?limit=50');
  const data = await mail.json();
  for (const m of data.messages) {
    const msg = await (await fetch(`http://mailpit:8025/api/v1/message/${m.ID}`)).json();
    const text = msg.Text ?? msg.Body ?? '';
    const match = text.match(/\/invite\/([a-f0-9]+)/);
    if (match) return match[1];
  }
  throw new Error('no invite token found');
}

function countLayers(doc) {
  return doc.scenes.reduce(
    (n, s) => n + s.layers.filter((l) => l.kind !== 'Group' && l.kind !== 'Camera').length,
    0,
  );
}

async function main() {
  // Clear mail from earlier runs so mail counts describe this run only.
  await fetch('http://mailpit:8025/api/v1/messages', { method: 'DELETE' }).catch(() => undefined);

  await req('/api/grading/reset', { method: 'POST', grading: true });
  const seedRes = await req('/api/grading/seed', { method: 'POST', grading: true });
  const seed = seedRes.data;
  ok('seed answers 201', seedRes.status === 201);
  ok('seed has 4 people', Object.keys(seed.people).length === 4);
  ok('seed has 10 projects', Object.keys(seed.projects).length === 10, `got ${Object.keys(seed.projects).length}`);

  const ines = seed.people['ines@lumenyard.test'];
  const mara = seed.people['mara@lumenyard.test'];
  const tomas = seed.people['tomas@lumenyard.test'];
  const pavel = seed.people['pavel@quarryhall.test'];
  const lumen = seed.projects['Lumen hero'];
  const logo = seed.projects['Logo forge'];
  const modelBay = seed.projects['Model bay'];
  const banner = seed.projects['Banner test'];
  const quarry = seed.projects['Quarry teaser'];
  const orbit = seed.projects['Orbit study'];
  const inesCookie = `hs_session=${ines.session}`;
  const maraCookie = `hs_session=${mara.session}`;
  const tomasCookie = `hs_session=${tomas.session}`;
  const pavelCookie = `hs_session=${pavel.session}`;

  console.log('\n-- session');
  const bad = await req('/api/session', {
    method: 'POST',
    body: JSON.stringify({ email: 'ines@lumenyard.test', password: 'wrong' }),
  });
  ok('wrong password: 401 bad_credentials', bad.status === 401 && bad.data.error === 'bad_credentials');
  const good = await req('/api/session', {
    method: 'POST',
    body: JSON.stringify({ email: 'ines@lumenyard.test', password: 'halation-ines-01' }),
  });
  ok('seeded sign in works', good.status === 200 && String(good.headers.get('set-cookie')).includes('hs_session='));
  const me = await req('/api/me', { cookie: inesCookie });
  ok('me returns workspaces', me.status === 200 && Array.isArray(me.data.workspaces));

  console.log('\n-- visibility (DP-04)');
  const other = await req(`/api/projects/${quarry.id}`, { cookie: inesCookie });
  ok("another workspace's project answers 404", other.status === 404);
  const unknown = await req('/api/projects/prj_missing', { cookie: inesCookie });
  ok('unknown project answers 404', unknown.status === 404);
  const anon = await req(`/api/projects/${lumen.id}`);
  ok('unauthenticated project answers 401', anon.status === 401 && anon.data.error === 'unauthenticated');
  const gradingNoKey = await req('/api/grading/seed', { method: 'POST' });
  ok('grading without key answers 404', gradingNoKey.status === 404);

  console.log('\n-- inspection (DP-14)');
  const ins = await req(
    `/api/projects/${lumen.id}/inspect?scene=${lumen.scenes['Main']}&layer=${lumen.layers['Halo cube']}&frame=0`,
    { cookie: inesCookie },
  );
  const r = ins.data.readouts;
  ok('screen point matches the worked example', r['screen-point'] === '806.85, 231.29 px', `got ${r['screen-point']}`);
  ok('triangles of the cube', r.triangles === 'Triangles 12');

  const insVertex = await req(
    `/api/projects/${lumen.id}/inspect?scene=${lumen.scenes['Main']}&layer=${lumen.layers['Halo cube']}&frame=0&vertex=${encodeURIComponent('+x +y +z')}`,
    { cookie: inesCookie },
  );
  const rv = insVertex.data.readouts;
  ok('vertex world matches the worked example', rv['vertex-world'] === '2.061, 2.500, -0.354', `got ${rv['vertex-world']}`);
  ok('vertex screen matches the worked example', rv['vertex-point'] === '892.86, 195.28 px', `got ${rv['vertex-point']}`);

  const cloth = await req(
    `/api/projects/${banner.id}/inspect?scene=${banner.scenes['Main']}&layer=${banner.layers['Banner']}&frame=30&point=${encodeURIComponent('R4 C1')}`,
    { cookie: inesCookie },
  );
  ok(
    'cloth point at frame 30 matches the worked example',
    cloth.data.readouts['cloth-point'] === 'Cloth point R4 C1 at -0.051, -0.285, 0.001',
    `got ${cloth.data.readouts['cloth-point']}`,
  );

  const wordmark = await req(
    `/api/projects/${logo.id}/inspect?scene=${logo.scenes['Main']}&layer=${logo.layers['Wordmark']}&frame=0`,
    { cookie: inesCookie },
  );
  const rw = wordmark.data.readouts;
  ok('Wordmark bounds match the worked example', rw.bounds === 'Bounds 2.740 × 1.040 × 0.240', `got ${rw.bounds}`);
  ok('Wordmark triangles match the worked example', rw.triangles === 'Triangles 1120', `got ${rw.triangles}`);

  console.log('\n-- roles (DP-39)');
  const viewerEdit = await req(`/api/projects/${lumen.id}/ops`, {
    method: 'POST',
    cookie: tomasCookie,
    body: JSON.stringify({ opId: 'v1', sceneId: lumen.scenes['Main'], changes: [] }),
  });
  ok('viewer edit refuses with the published copy', viewerEdit.status === 403 && viewerEdit.data.message === "Viewers can't edit this project.");
  const editorPublish = await req(`/api/projects/${lumen.id}/versions`, {
    method: 'POST',
    cookie: maraCookie,
    idempotencyKey: 'mara-pub',
    body: '{}',
  });
  ok('editor cannot publish', editorPublish.status === 403 && editorPublish.data.message === 'Only the owner can publish.');
  const pavelLumen = await req(`/api/projects/${lumen.id}`, { cookie: pavelCookie });
  ok('pavel cannot open Lumen hero', pavelLumen.status === 404);

  console.log('\n-- ops, undo and idempotency (DP-30)');
  const sceneMain = lumen.scenes['Main'];
  const haloId = lumen.layers['Halo cube'];
  const op1 = await req(`/api/projects/${lumen.id}/ops`, {
    method: 'POST',
    cookie: inesCookie,
    body: JSON.stringify({
      opId: 'op-1',
      sceneId: sceneMain,
      changes: [{ type: 'updateLayer', layerId: haloId, set: 'rotation.y', value: 60 }],
    }),
  });
  ok('ops applies a change', op1.status === 200 && op1.data.undoDepth === 1);
  const op1again = await req(`/api/projects/${lumen.id}/ops`, {
    method: 'POST',
    cookie: inesCookie,
    body: JSON.stringify({
      opId: 'op-1',
      sceneId: sceneMain,
      changes: [{ type: 'updateLayer', layerId: haloId, set: 'rotation.y', value: 60 }],
    }),
  });
  ok('replaying an opId returns the stored response', op1again.status === 200 && op1again.data.undoDepth === 1);
  const op1conflict = await req(`/api/projects/${lumen.id}/ops`, {
    method: 'POST',
    cookie: inesCookie,
    body: JSON.stringify({
      opId: 'op-1',
      sceneId: sceneMain,
      changes: [{ type: 'updateLayer', layerId: haloId, set: 'rotation.y', value: 70 }],
    }),
  });
  ok('same opId different body answers idempotency_conflict', op1conflict.status === 409 && op1conflict.data.error === 'idempotency_conflict');
  const undo1 = await req(`/api/projects/${lumen.id}/undo`, { method: 'POST', cookie: inesCookie, body: JSON.stringify({ opId: 'u1' }) });
  ok('undo works', undo1.status === 200 && undo1.data.undoDepth === 0);
  const redo1 = await req(`/api/projects/${lumen.id}/redo`, { method: 'POST', cookie: inesCookie, body: JSON.stringify({ opId: 'r1' }) });
  ok('redo works', redo1.status === 200 && redo1.data.redoDepth === 0);
  const insAfter = await req(
    `/api/projects/${lumen.id}/inspect?scene=${sceneMain}&layer=${haloId}&frame=0`,
    { cookie: inesCookie },
  );
  ok('the redo restored rotation Y 60', insAfter.data.values['rotation.y'] === 60, `got ${insAfter.data.values['rotation.y']}`);

  console.log('\n-- publishing (DP-40)');
  const pub1 = await req(`/api/projects/${lumen.id}/versions`, { method: 'POST', cookie: inesCookie, idempotencyKey: 'pub-1', body: '{}' });
  ok('publish creates version 1', pub1.status === 201 && pub1.data.version.number === 1);
  const pub1again = await req(`/api/projects/${lumen.id}/versions`, { method: 'POST', cookie: inesCookie, idempotencyKey: 'pub-1', body: '{}' });
  ok('replaying the publish key creates no version', pub1again.status === 201 && pub1again.data.version.number === 1);
  const pub2 = await req(`/api/projects/${lumen.id}/versions`, { method: 'POST', cookie: inesCookie, idempotencyKey: 'pub-2', body: '{}' });
  ok('a new key creates version 2', pub2.data.version.number === 2);
  const repub = await req(`/api/projects/${lumen.id}/versions`, {
    method: 'POST',
    cookie: inesCookie,
    idempotencyKey: 'pub-3',
    body: JSON.stringify({ fromVersion: 1 }),
  });
  ok('republish version 1 ships version 3', repub.data.version.number === 3, `got ${repub.data.version.number}`);
  const versions = await req(`/api/projects/${lumen.id}/versions`, { cookie: inesCookie });
  const vlist = versions.data.versions;
  ok('numbers are gapless', vlist.map((v) => v.number).join(',') === '1,2,3', `got ${vlist.map((v) => v.number).join(',')}`);
  ok('only version 3 is live', vlist.filter((v) => v.status === 'live').length === 1 && vlist.find((v) => v.status === 'live').number === 3);
  const imm = await req(`/api/projects/${lumen.id}/versions/1`, { method: 'PUT', cookie: inesCookie, body: '{}' });
  ok('published versions are immutable', imm.status === 405 && imm.data.error === 'immutable');

  console.log('\n-- embed (DP-41)');
  const embedHtml = await fetch(`${BASE}/embed/${modelBay.id}`);
  ok('the embed page answers 200 for a live project', embedHtml.status === 200);
  const embedScene = await fetch(`${BASE}/api/embed/${modelBay.id}/scene`);
  ok('embed scene serves the bundle', embedScene.headers.get('x-halation-version') === '1');
  ok('embed scene names its source', embedScene.headers.get('x-scene-source') === 'bundle');
  const embedMissing = await fetch(`${BASE}/embed/${logo.id}`);
  ok('an unpublished embed answers 404', embedMissing.status === 404);
  const embedMissingBody = await embedMissing.text();
  ok('the unpublished embed page names the problem', embedMissingBody.includes('This scene is not published.'));

  console.log('\n-- invites and mail (DP-06, DP-42)');
  const invite = await req(`/api/projects/${orbit.id}/invites`, {
    method: 'POST',
    cookie: inesCookie,
    body: JSON.stringify({ email: 'zora@example.test', role: 'Editor' }),
  });
  ok('invite created', invite.status === 201);
  ok('invite sent', invite.data.invite.status === 'sent');
  const inviteDup = await req(`/api/projects/${orbit.id}/invites`, {
    method: 'POST',
    cookie: inesCookie,
    body: JSON.stringify({ email: 'zora@example.test', role: 'Editor' }),
  });
  ok('a pending invite is refused', inviteDup.status === 422 && inviteDup.data.errors.email === 'An invite to zora@example.test is already pending.');

  await new Promise((resolve) => setTimeout(resolve, 500));
  // The publish notices went out during the publishes above; check them now.
  const mail = await fetch('http://mailpit:8025/api/v1/messages?limit=50');
  const mailData = await mail.json();
  const subjects = mailData.messages.map((m) => m.Subject);
  ok('mailpit received the invite', subjects.includes('Join Orbit study in Halation Studio'), subjects.join(' | '));
  ok(
    'publish notices went to owner and editor',
    subjects.filter((s) => s === 'Lumen hero version 3 is live').length === 2,
    subjects.join(' | '),
  );

  console.log('\n-- accept invite (DP-06)');
  const token = await findInviteToken();
  const inviteInfo = await fetch(`${BASE}/api/invites/${token}`);
  ok('the invite page answers', inviteInfo.status === 200);
  const accept = await req(`/api/invites/${token}/accept`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Zora Vale', password: 'zora-password-01' }),
  });
  ok('accepting creates a member session', accept.status === 200, JSON.stringify(accept.data));
  const acceptAgain = await req(`/api/invites/${token}/accept`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Zora Vale', password: 'zora-password-01' }),
  });
  ok('a used token answers 410', acceptAgain.status === 410);

  console.log('\n-- import and export (DP-45)');
  const exportRes = await req(`/api/projects/${lumen.id}/export`, { cookie: inesCookie });
  const exported = exportRes.data;
  ok('the working export is schema version 3', exported.schemaVersion === 3);
  ok('the export names the project', exported.name === 'Lumen hero');
  const importForm = new FormData();
  importForm.append('workspaceId', seed.workspaces['Lumen Yard']);
  importForm.append('file', new Blob([JSON.stringify(exported)], { type: 'application/json' }), 'scene.json');
  const imported = await fetch(`${BASE}/api/imports`, { method: 'POST', headers: { cookie: inesCookie }, body: importForm });
  const importedData = await imported.json();
  ok('import creates the (imported) project', imported.status === 201 && importedData.project.name === 'Lumen hero (imported)');
  ok('the imported project keeps its layer count', importedData.project.layerCount === countLayers(exported), `got ${importedData.project.layerCount}`);

  const importedExport = await req(`/api/projects/${importedData.project.id}/export`, { cookie: inesCookie });
  ok(
    're-importing an export and exporting again is identical apart from name',
    JSON.stringify({ ...importedExport.data, name: '' }) === JSON.stringify({ ...exported, name: '' }),
  );

  console.log('\n-- trash and restore (DP-44)');
  const trash = await req(`/api/projects/${logo.id}`, { method: 'DELETE', cookie: inesCookie });
  ok('trashing answers with status trashed', trash.status === 200 && trash.data.project.status === 'trashed');
  const trashEmbed = await fetch(`${BASE}/embed/${logo.id}`);
  ok('a trashed project answers 404', trashEmbed.status === 404);
  const trashAgain = await req(`/api/projects/${logo.id}`, { method: 'DELETE', cookie: inesCookie });
  ok('trashing twice answers already_trashed', trashAgain.status === 409 && trashAgain.data.error === 'already_trashed');
  const restore = await req(`/api/projects/${logo.id}/restore`, { method: 'POST', cookie: inesCookie });
  ok('restore brings it back active', restore.status === 200 && restore.data.project.status === 'active');
  const restored = await req(`/api/projects/${logo.id}`, { cookie: inesCookie });
  ok('the restored project still has its layers', restored.data.document.scenes[0].layers.length === 4);

  console.log('\n-- validation (DP-05)');
  const rangeRes = await req(`/api/projects/${lumen.id}/ops`, {
    method: 'POST',
    cookie: inesCookie,
    body: JSON.stringify({
      opId: 'v-range',
      sceneId: sceneMain,
      changes: [{ type: 'updateLayer', layerId: haloId, set: 'position.x', value: 500 }],
    }),
  });
  ok('out of range refuses with the published copy', rangeRes.status === 422 && rangeRes.data.errors['position.x'] === 'Must be between -100 and 100.');
  const bpRes = await req(`/api/projects/${lumen.id}/ops`, {
    method: 'POST',
    cookie: inesCookie,
    body: JSON.stringify({
      opId: 'v-bp',
      sceneId: sceneMain,
      changes: [{ type: 'updateLayer', layerId: haloId, set: 'name', value: 'New name', breakpoint: 'tablet' }],
    }),
  });
  ok('a non-overridable field refuses with the published copy', bpRes.status === 422 && bpRes.data.errors.name === "Name can't differ between breakpoints.");

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
