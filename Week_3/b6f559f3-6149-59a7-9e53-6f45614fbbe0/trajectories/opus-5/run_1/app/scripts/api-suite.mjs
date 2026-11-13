const BASE = process.env.BASE ?? 'http://localhost:4173';
const ALT = process.env.ALT ?? 'http://localhost:4174';
const KEY = process.env.GRADING_KEY;
const MAILPIT = process.env.MAILPIT_URL ?? 'http://mailpit:8025';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ label, ok });
  if (!ok) console.log(`FAIL ${label} ${extra}`);
};

async function call(method, path, { body, session, headers = {}, base = BASE, raw = false } = {}) {
  const init = { method, headers: { ...headers } };
  if (session) init.headers.cookie = `hs_session=${session}`;
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${base}${path}`, init);
  if (raw) return { status: response.status, response };
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text.length ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

async function grading(path, body, base = BASE) {
  return call('POST', `/api/grading/${path}`, { body, headers: { 'X-Grading-Key': KEY }, base });
}

await grading('reset');
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined);
const seed = (await grading('seed')).body;
const ines = seed.people['ines@lumenyard.test'].session;
const mara = seed.people['mara@lumenyard.test'].session;
const tomas = seed.people['tomas@lumenyard.test'].session;
const pavel = seed.people['pavel@quarryhall.test'].session;
const P = (name) => seed.projects[name];

// DP-02 grading routes hidden without the key
check('reset without key is 404', (await call('POST', '/api/grading/reset')).status === 404);
check('seed without key is 404', (await call('POST', '/api/grading/seed')).status === 404);
check(
  'clock moves',
  (await grading('clock', { advanceMs: 1000 })).status === 200,
);

// DP-01 health
const health = await call('GET', '/api/health');
check('health ok', health.status === 200 && health.body.status === 'ok', JSON.stringify(health.body));

// DP-03 session
const signIn = await call('POST', '/api/session', {
  body: { email: 'ines@lumenyard.test', password: 'halation-ines-01' },
});
check('sign in', signIn.status === 200 && signIn.body.user.email === 'ines@lumenyard.test');
const badSignIn = await call('POST', '/api/session', {
  body: { email: 'ines@lumenyard.test', password: 'nope' },
});
check(
  'bad credentials',
  badSignIn.status === 401 && badSignIn.body.message === 'Email or password is incorrect.',
  JSON.stringify(badSignIn.body),
);

// DP-04 visibility
check('unknown project 404', (await call('GET', '/api/projects/nope', { session: ines })).status === 404);
check(
  'other workspace 404',
  (await call('GET', `/api/projects/${P('Quarry teaser').id}`, { session: ines })).status === 404,
);
check(
  'non-member 404',
  (await call('GET', `/api/projects/${P('Orbit study').id}`, { session: mara })).status === 404,
);
check(
  'anonymous 401',
  (await call('GET', `/api/projects/${P('Lumen hero').id}`)).status === 401,
);
check(
  'unpublished embed 404',
  (await call('GET', `/api/embed/${P('Lumen hero').id}/scene`)).status === 404,
);

// DP-05 error order and shapes
const viewerEdit = await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: tomas,
  body: { opId: 'viewer-1', sceneId: P('Lumen hero').scenes.Main, changes: [] },
});
check(
  'viewer cannot edit',
  viewerEdit.status === 403 && viewerEdit.body.message === "Viewers can't edit this project.",
  JSON.stringify(viewerEdit.body),
);
const editorPublish = await call('POST', `/api/projects/${P('Lumen hero').id}/versions`, {
  session: mara,
  headers: { 'Idempotency-Key': 'nope' },
  body: {},
});
check(
  'editor cannot publish',
  editorPublish.status === 403 && editorPublish.body.message === 'Only the owner can publish.',
);
const editorInvite = await call('POST', `/api/projects/${P('Lumen hero').id}/invites`, {
  session: mara,
  body: { email: 'x@y.test', role: 'Viewer' },
});
check(
  'editor cannot invite',
  editorInvite.status === 403 && editorInvite.body.message === 'Only the owner can manage members.',
);
const badRange = await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: ines,
  body: {
    opId: 'range-1',
    sceneId: P('Lumen hero').scenes.Main,
    changes: [
      { type: 'updateLayer', layerId: P('Lumen hero').layers['Halo cube'], set: { 'position.x': 500 } },
    ],
  },
});
check(
  'range validation',
  badRange.status === 422 &&
    badRange.body.errors['set.position.x'] === 'Must be between -100 and 100.' &&
    badRange.body.message === 'Must be between -100 and 100.',
  JSON.stringify(badRange.body),
);
const notOverridable = await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: ines,
  body: {
    opId: 'override-1',
    sceneId: P('Lumen hero').scenes.Main,
    changes: [
      {
        type: 'updateLayer',
        layerId: P('Lumen hero').layers['Halo cube'],
        set: { primitive: 'Sphere' },
        breakpoint: 'tablet',
      },
    ],
  },
});
check(
  'not overridable',
  notOverridable.status === 422 &&
    notOverridable.body.message === "Primitive can't differ between breakpoints.",
  JSON.stringify(notOverridable.body),
);
const wrongType = await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: ines,
  headers: { 'content-type': 'text/plain' },
});
check('unsupported media type', wrongType.status === 415, JSON.stringify(wrongType.body));

// Ops, undo, redo (DP-30)
const heroScene = P('Lumen hero').scenes.Main;
const halo = P('Lumen hero').layers['Halo cube'];
const op1 = await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: ines,
  body: {
    opId: 'edit-1',
    sceneId: heroScene,
    changes: [{ type: 'updateLayer', layerId: halo, set: { 'position.x': 3 } }],
  },
});
check('op applied', op1.status === 200 && op1.body.undoDepth === 1, JSON.stringify(op1.body));
const replay = await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: ines,
  body: {
    opId: 'edit-1',
    sceneId: heroScene,
    changes: [{ type: 'updateLayer', layerId: halo, set: { 'position.x': 3 } }],
  },
});
check('replay returns stored response', replay.status === 200 && replay.body.undoDepth === 1);
const conflict = await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: ines,
  body: {
    opId: 'edit-1',
    sceneId: heroScene,
    changes: [{ type: 'updateLayer', layerId: halo, set: { 'position.x': 4 } }],
  },
});
check(
  'same opId different body conflicts',
  conflict.status === 409 && conflict.body.error === 'idempotency_conflict',
  JSON.stringify(conflict.body),
);
const inspectAfter = await call(
  'GET',
  `/api/projects/${P('Lumen hero').id}/inspect?scene=${heroScene}&layer=${halo}`,
  { session: ines },
);
check('value after op', inspectAfter.body.values['position.x'] === 3, JSON.stringify(inspectAfter.body.values['position.x']));
const undo = await call('POST', `/api/projects/${P('Lumen hero').id}/undo`, {
  session: ines,
  body: { opId: 'undo-1' },
});
check('undo', undo.status === 200 && undo.body.undoDepth === 0 && undo.body.redoDepth === 1);
const afterUndo = await call(
  'GET',
  `/api/projects/${P('Lumen hero').id}/inspect?scene=${heroScene}&layer=${halo}`,
  { session: ines },
);
check('undo restored value', afterUndo.body.values['position.x'] === 1, String(afterUndo.body.values['position.x']));
const undoReplay = await call('POST', `/api/projects/${P('Lumen hero').id}/undo`, {
  session: ines,
  body: { opId: 'undo-1' },
});
check('undo replay is idempotent', undoReplay.status === 200 && undoReplay.body.undoDepth === 0);
const redo = await call('POST', `/api/projects/${P('Lumen hero').id}/redo`, {
  session: ines,
  body: { opId: 'redo-1' },
});
check('redo', redo.status === 200 && redo.body.undoDepth === 1);
const afterRedo = await call(
  'GET',
  `/api/projects/${P('Lumen hero').id}/inspect?scene=${heroScene}&layer=${halo}`,
  { session: ines },
);
check('redo reapplies the value', afterRedo.body.values['position.x'] === 3, String(afterRedo.body.values['position.x']));
const nothing = await call('POST', `/api/projects/${P('Lumen hero').id}/redo`, {
  session: ines,
  body: { opId: 'redo-2' },
});
check(
  'nothing to redo',
  nothing.status === 409 && nothing.body.error === 'nothing_to_redo',
  JSON.stringify(nothing.body),
);

// Layer delete and undo keeps keyframes (DP-44)
const easing = P('Easing lab');
const turner = easing.layers.Turner;
await call('POST', `/api/projects/${easing.id}/ops`, {
  session: ines,
  body: {
    opId: 'del-1',
    sceneId: easing.scenes.Main,
    changes: [{ type: 'deleteLayer', layerId: turner }],
  },
});
const afterDelete = await call('GET', `/api/projects/${easing.id}`, { session: ines });
check(
  'layer deleted',
  afterDelete.body.document.scenes[0].layers.every((layer) => layer.id !== turner),
);
await call('POST', `/api/projects/${easing.id}/undo`, { session: ines, body: { opId: 'undo-del' } });
const restoredLayer = await call('GET', `/api/projects/${easing.id}`, { session: ines });
const back = restoredLayer.body.document.scenes[0].layers.find((layer) => layer.id === turner);
check(
  'undo restores layer with keyframes',
  back && back.keyframes.length === 2 && back.keyframes[0].easing === 'ease-out',
  JSON.stringify(back?.keyframes),
);

// Locks (DP-38)
await call('DELETE', `/api/projects/${P('Lumen hero').id}/layers/${halo}/lock`, { session: ines });
const lockTake = await call('PUT', `/api/projects/${P('Lumen hero').id}/layers/${halo}/lock`, {
  session: mara,
});
check('lock taken', lockTake.status === 200 && lockTake.body.lock.heldBy.name === 'Mara Lindqvist');
const heldEdit = await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: ines,
  body: {
    opId: 'held-1',
    sceneId: heroScene,
    changes: [{ type: 'updateLayer', layerId: halo, set: { 'position.y': 1 } }],
  },
});
check(
  'held layer refuses',
  heldEdit.status === 409 &&
    heldEdit.body.error === 'layer_held' &&
    heldEdit.body.message === 'Mara Lindqvist is editing this layer.',
  JSON.stringify(heldEdit.body),
);
await call('DELETE', `/api/projects/${P('Lumen hero').id}/layers/${halo}/lock`, { session: mara });
const afterRelease = await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: ines,
  body: {
    opId: 'held-2',
    sceneId: heroScene,
    changes: [{ type: 'updateLayer', layerId: halo, set: { 'position.y': 1 } }],
  },
});
check('edit after release', afterRelease.status === 200, JSON.stringify(afterRelease.body));

// locked layer
await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: ines,
  body: {
    opId: 'lock-on',
    sceneId: heroScene,
    changes: [{ type: 'updateLayer', layerId: halo, set: { locked: true } }],
  },
});
await call('DELETE', `/api/projects/${P('Lumen hero').id}/layers/${halo}/lock`, { session: ines });
const lockedEdit = await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: mara,
  body: {
    opId: 'locked-1',
    sceneId: heroScene,
    changes: [{ type: 'updateLayer', layerId: halo, set: { 'position.y': 2 } }],
  },
});
check(
  'locked layer refuses',
  lockedEdit.status === 409 &&
    lockedEdit.body.error === 'layer_locked' &&
    lockedEdit.body.message === 'Halo cube is locked.',
  JSON.stringify(lockedEdit.body),
);
await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: ines,
  body: {
    opId: 'lock-off',
    sceneId: heroScene,
    changes: [{ type: 'updateLayer', layerId: halo, set: { locked: false } }],
  },
});

// Publishing (DP-40, DP-42)
const publish1 = await call('POST', `/api/projects/${P('Lumen hero').id}/versions`, {
  session: ines,
  headers: { 'Idempotency-Key': 'pub-1' },
  body: {},
});
check('publish 1', publish1.status === 201 && publish1.body.version.number === 1, JSON.stringify(publish1.body));
const publishReplay = await call('POST', `/api/projects/${P('Lumen hero').id}/versions`, {
  session: ines,
  headers: { 'Idempotency-Key': 'pub-1' },
  body: {},
});
check('publish replay', publishReplay.status === 201 && publishReplay.body.version.number === 1);
const publishConflict = await call('POST', `/api/projects/${P('Lumen hero').id}/versions`, {
  session: ines,
  headers: { 'Idempotency-Key': 'pub-1' },
  body: { fromVersion: 1 },
});
check('publish key conflict', publishConflict.status === 409, JSON.stringify(publishConflict.body));
const publish2 = await call('POST', `/api/projects/${P('Lumen hero').id}/versions`, {
  session: ines,
  headers: { 'Idempotency-Key': 'pub-2' },
  body: {},
});
check('publish 2 gapless', publish2.body.version.number === 2);
const republish = await call('POST', `/api/projects/${P('Lumen hero').id}/versions`, {
  session: ines,
  headers: { 'Idempotency-Key': 'pub-3' },
  body: { fromVersion: 1 },
});
check('republish as 3', republish.body.version.number === 3);
const versions = await call('GET', `/api/projects/${P('Lumen hero').id}/versions`, { session: ines });
check(
  'versions listed',
  versions.body.versions.length === 3 &&
    versions.body.versions[0].status === 'live' &&
    versions.body.versions[1].status === 'superseded',
  JSON.stringify(versions.body.versions.map((v) => [v.number, v.status])),
);
const immutable = await call('PUT', `/api/projects/${P('Lumen hero').id}/versions/1`, { session: ines });
check(
  'versions immutable',
  immutable.status === 405 && immutable.body.message === "Published versions can't be changed.",
);
const exported1 = await call('GET', `/api/projects/${P('Lumen hero').id}/versions/1/export`, {
  session: ines,
});
const exported3 = await call('GET', `/api/projects/${P('Lumen hero').id}/versions/3/export`, {
  session: ines,
});
check(
  'republished bundle matches source',
  JSON.stringify(exported1.body) === JSON.stringify(exported3.body),
);

// Embed (DP-41)
const embedScene = await call('GET', `/api/embed/${P('Lumen hero').id}/scene`);
check(
  'embed serves live bundle',
  embedScene.status === 200 &&
    embedScene.headers.get('x-halation-version') === '3' &&
    embedScene.headers.get('x-scene-source') === 'bundle',
  `${embedScene.headers.get('x-halation-version')} ${embedScene.headers.get('x-scene-source')}`,
);
const embedVersion = await call('GET', `/api/embed/${P('Lumen hero').id}/version`);
check('embed version route', embedVersion.body.number === 3);

// Publish notices in Mailpit (DP-42)
await new Promise((resolve) => setTimeout(resolve, 1500));
const mail = await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json();
const noticeSubjects = mail.messages.filter((message) => message.Subject === 'Lumen hero version 1 is live');
check(
  'publish notices to owner and editor',
  noticeSubjects.length === 2,
  JSON.stringify(noticeSubjects.map((m) => m.To?.[0]?.Address)),
);

// Invites (DP-06)
const invite = await call('POST', `/api/projects/${P('Orbit study').id}/invites`, {
  session: ines,
  body: { email: 'mara@lumenyard.test', role: 'Editor' },
});
check('invite created', invite.status === 201 && invite.body.invite.status === 'sent', JSON.stringify(invite.body));
const duplicate = await call('POST', `/api/projects/${P('Orbit study').id}/invites`, {
  session: ines,
  body: { email: 'mara@lumenyard.test', role: 'Editor' },
});
check(
  'pending invite refused',
  duplicate.status === 422 &&
    duplicate.body.message === 'An invite to mara@lumenyard.test is already pending.',
  JSON.stringify(duplicate.body),
);
const alreadyMember = await call('POST', `/api/projects/${P('Orbit study').id}/invites`, {
  session: ines,
  body: { email: 'tomas@lumenyard.test', role: 'Viewer' },
});
check(
  'member invite refused',
  alreadyMember.status === 422 &&
    alreadyMember.body.message === 'tomas@lumenyard.test is already a member.',
);
const badEmail = await call('POST', `/api/projects/${P('Orbit study').id}/invites`, {
  session: ines,
  body: { email: 'nope', role: 'Viewer' },
});
check('invalid email refused', badEmail.status === 422 && badEmail.body.message === 'Enter a valid email address.');

await new Promise((resolve) => setTimeout(resolve, 1200));
const mail2 = await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json();
const inviteMail = mail2.messages.find((message) => message.Subject === 'Join Orbit study in Halation Studio');
check('invite mail sent', inviteMail !== undefined);
let token = null;
if (inviteMail) {
  const full = await (await fetch(`${MAILPIT}/api/v1/message/${inviteMail.ID}`)).json();
  const match = /\/invite\/([a-f0-9]+)/.exec(full.Text ?? '');
  token = match?.[1] ?? null;
  check('invite link present', token !== null, full.Text?.slice(0, 200));
  check('expiry sentence', /This link works once and expires on \d+ \w+ \d{4} at \d{2}:\d{2}\./.test(full.Text ?? ''), full.Text);
}
if (token) {
  const preview = await call('GET', `/api/invites/${token}`);
  check('invite preview', preview.status === 200 && preview.body.projectName === 'Orbit study');
  const accept = await call('POST', `/api/invites/${token}/accept`, {
    session: mara,
    body: {},
  });
  check('invite accepted', accept.status === 200 && accept.body.role === 'Editor', JSON.stringify(accept.body));
  const reuse = await call('POST', `/api/invites/${token}/accept`, { session: mara, body: {} });
  check('single use token', reuse.status === 410, JSON.stringify(reuse.body));
  const nowMember = await call('GET', `/api/projects/${P('Orbit study').id}`, { session: mara });
  check('membership after accept', nowMember.status === 200);
}

// Trash and restore (DP-44)
const trashTarget = P('Phone kit');
const trashed = await call('DELETE', `/api/projects/${trashTarget.id}`, { session: ines });
check('trashed', trashed.status === 200 && trashed.body.project.status === 'trashed');
check(
  'edits refused while trashed',
  (
    await call('POST', `/api/projects/${trashTarget.id}/ops`, {
      session: ines,
      body: { opId: 'trash-1', sceneId: trashTarget.scenes.Main, changes: [] },
    })
  ).status === 409,
);
check(
  'already trashed',
  (await call('DELETE', `/api/projects/${trashTarget.id}`, { session: ines })).body.error ===
    'already_trashed',
);
const restored = await call('POST', `/api/projects/${trashTarget.id}/restore`, { session: ines });
check('restored', restored.status === 200 && restored.body.project.status === 'active');
check(
  'not trashed',
  (await call('POST', `/api/projects/${trashTarget.id}/restore`, { session: ines })).body.error ===
    'not_trashed',
);

// Export and import (DP-45)
const exportWorking = await call('GET', `/api/projects/${P('Backdrop').id}/export`, { session: ines });
check('export schema 3', exportWorking.body.schemaVersion === 3);
check(
  'export keeps scene order',
  exportWorking.body.scenes.map((scene) => scene.name).join(',') === 'Blend,Ramp,Grain',
  exportWorking.body.scenes.map((scene) => scene.name).join(','),
);

const form = new FormData();
form.set('workspaceId', seed.workspaces['Lumen Yard']);
const exportBytes = JSON.stringify(exportWorking.body);
form.set('file', new Blob([exportBytes], { type: 'application/json' }), 'backdrop.json');
const imported = await fetch(`${BASE}/api/imports`, {
  method: 'POST',
  headers: { cookie: `hs_session=${ines}` },
  body: form,
});
const importedBody = await imported.json();
check('import created', imported.status === 201, JSON.stringify(importedBody));
if (imported.status === 201) {
  const reExport = await call('GET', `/api/projects/${importedBody.project.id}/export`, { session: ines });
  const normalised = { ...reExport.body, name: exportWorking.body.name };
  const deepEqual = (a, b, path = '') => {
    if (typeof a === 'number' && typeof b === 'number') {
      if (Math.abs(a - b) > 1e-9) return path;
      return null;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return path;
      for (let i = 0; i < a.length; i += 1) {
        const problem = deepEqual(a[i], b[i], `${path}[${i}]`);
        if (problem) return problem;
      }
      return null;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const key of keys) {
        const problem = deepEqual(a[key], b[key], `${path}.${key}`);
        if (problem) return problem;
      }
      return null;
    }
    return a === b ? null : `${path} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
  };
  const difference = deepEqual(normalised, exportWorking.body);
  check('round trip identical', difference === null, String(difference));
  const original = await call('GET', `/api/projects/${importedBody.project.id}/import/original`, {
    session: ines,
    raw: true,
  });
  const originalText = await original.response.text();
  check('original bytes kept', originalText === exportBytes);
}

const badForm = new FormData();
badForm.set('workspaceId', seed.workspaces['Lumen Yard']);
badForm.set('file', new Blob(['{not json'], { type: 'application/json' }), 'broken.json');
const badImport = await fetch(`${BASE}/api/imports`, {
  method: 'POST',
  headers: { cookie: `hs_session=${ines}` },
  body: badForm,
});
const badImportBody = await badImport.json();
check(
  'broken json refused',
  badImport.status === 422 && badImportBody.message === 'This file is not valid JSON.',
  JSON.stringify(badImportBody),
);

const missingForm = new FormData();
missingForm.set('workspaceId', seed.workspaces['Lumen Yard']);
missingForm.set(
  'file',
  new Blob([JSON.stringify({ schemaVersion: 3, name: 'X', scenes: [{ id: 's', name: 'Main' }] })], {
    type: 'application/json',
  }),
  'missing.json',
);
const missingImport = await fetch(`${BASE}/api/imports`, {
  method: 'POST',
  headers: { cookie: `hs_session=${ines}` },
  body: missingForm,
});
const missingBody = await missingImport.json();
check(
  'missing field refused',
  missingImport.status === 422 && missingBody.message === 'Missing field: scenes[0].layers',
  JSON.stringify(missingBody),
);

const rangeForm = new FormData();
rangeForm.set('workspaceId', seed.workspaces['Lumen Yard']);
rangeForm.set(
  'file',
  new Blob([
    JSON.stringify({
      schemaVersion: 3,
      name: 'X',
      scenes: [
        {
          id: 's',
          name: 'Main',
          layers: [{ id: 'l', name: 'Cube', kind: 'Primitive', props: { position: { x: 900 } } }],
        },
      ],
    }),
  ], { type: 'application/json' }),
  'range.json',
);
const rangeImport = await fetch(`${BASE}/api/imports`, {
  method: 'POST',
  headers: { cookie: `hs_session=${ines}` },
  body: rangeForm,
});
const rangeBody = await rangeImport.json();
check(
  'out of range refused',
  rangeImport.status === 422 &&
    rangeBody.message === 'Value out of range: scenes[0].layers[0].props.position.x is 900 (allowed -100 to 100).',
  JSON.stringify(rangeBody),
);

// Uploads (DP-18, DP-19, DP-16)
async function upload(projectId, kind, name, bytes, type, session = ines) {
  const data = new FormData();
  data.set('kind', kind);
  data.set('file', new Blob([bytes], { type }), name);
  const response = await fetch(`${BASE}/api/projects/${projectId}/assets`, {
    method: 'POST',
    headers: { cookie: `hs_session=${session}` },
    body: data,
  });
  return { status: response.status, body: await response.json() };
}

const svgOk = await upload(
  P('Logo forge').id,
  'svg',
  'square.svg',
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L200 0 L200 100 L0 100 Z"/></svg>',
  'image/svg+xml',
);
check('svg upload', svgOk.status === 201 && svgOk.body.asset.status === 'confirmed', JSON.stringify(svgOk.body));
const svgThree = await upload(
  P('Logo forge').id,
  'svg',
  'three.svg',
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 0 Z"/><path d="M0 0 L1 0 Z"/><path d="M0 0 L1 0 Z"/></svg>',
  'image/svg+xml',
);
check(
  'three paths refused',
  svgThree.status === 422 &&
    svgThree.body.errors.file === 'This SVG has 3 paths. Extrusion needs exactly one path.',
  JSON.stringify(svgThree.body),
);
const notSvg = await upload(P('Logo forge').id, 'svg', 'plain.txt', 'hello', 'text/plain');
check(
  'not an svg refused',
  notSvg.status === 422 && notSvg.body.errors.file === 'This file is not an SVG.',
);
const curves = await upload(
  P('Logo forge').id,
  'svg',
  'curve.svg',
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 C10 10 20 20 30 30"/></svg>',
  'image/svg+xml',
);
check(
  'curves refused',
  curves.status === 422 &&
    curves.body.errors.file === 'Only straight-line path commands (M, L, H, V, Z) are supported.',
  JSON.stringify(curves.body),
);

const notModel = await upload(P('Model bay').id, 'model', 'bad.gltf', '{"nope":true}', 'model/gltf+json');
check(
  'invalid gltf refused',
  notModel.status === 422 && notModel.body.errors.file === 'This file is not a valid glTF or GLB file.',
  JSON.stringify(notModel.body),
);
const wrongVersion = await upload(
  P('Model bay').id,
  'model',
  'v1.gltf',
  JSON.stringify({ asset: { version: '1.0' } }),
  'model/gltf+json',
);
check(
  'glTF 1.0 refused',
  wrongVersion.status === 422 && wrongVersion.body.errors.file === 'Only glTF 2.0 files are supported.',
);
const compressed = await upload(
  P('Model bay').id,
  'model',
  'draco.gltf',
  JSON.stringify({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] }),
  'model/gltf+json',
);
check(
  'compressed refused',
  compressed.status === 422 &&
    compressed.body.errors.file === 'Compressed meshes (KHR_draco_mesh_compression) are not supported.',
);
const external = await upload(
  P('Model bay').id,
  'model',
  'external.gltf',
  JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'scene.bin', byteLength: 4 }] }),
  'model/gltf+json',
);
check(
  'external uri refused',
  external.status === 422 &&
    external.body.errors.file === 'External buffer URIs are not supported: embed buffers in the file.',
);
const matrix = await upload(
  P('Model bay').id,
  'model',
  'matrix.gltf',
  JSON.stringify({ asset: { version: '2.0' }, nodes: [{ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] }),
  'model/gltf+json',
);
check(
  'matrix refused',
  matrix.status === 422 &&
    matrix.body.errors.file === 'Node matrices are not supported; use translation, rotation and scale.',
);
const cubic = await upload(
  P('Model bay').id,
  'model',
  'cubic.gltf',
  JSON.stringify({
    asset: { version: '2.0' },
    animations: [{ samplers: [{ input: 0, output: 1, interpolation: 'CUBICSPLINE' }], channels: [] }],
  }),
  'model/gltf+json',
);
check(
  'cubicspline refused',
  cubic.status === 422 &&
    cubic.body.errors.file ===
      'Animation interpolation CUBICSPLINE is not supported; use LINEAR or STEP.',
);
const bigModel = await upload(
  P('Model bay').id,
  'model',
  'big.gltf',
  'x'.repeat(2097153),
  'model/gltf+json',
);
check(
  'oversized model refused',
  bigModel.status === 422 && bigModel.body.errors.file === 'This file is 2.0 MB; the limit is 2.0 MB.',
  JSON.stringify(bigModel.body),
);
const notImage = await upload(P('Model bay').id, 'image', 'x.txt', 'hello', 'text/plain');
check(
  'non image refused',
  notImage.status === 422 &&
    notImage.body.errors.file === 'Only PNG, JPEG and WebP images are supported.',
);

const originalAsset = P('Model bay').assets['grain-plate.png'];
const originalBytes = await call('GET', `/api/assets/${originalAsset}/original`, {
  session: ines,
  raw: true,
});
check('original asset served', originalBytes.status === 200);

// pending asset refusal
const pendingLayer = await call('POST', `/api/projects/${P('Model bay').id}/ops`, {
  session: ines,
  body: {
    opId: 'pending-1',
    sceneId: P('Model bay').scenes.Main,
    changes: [
      { type: 'addLayer', ref: 'a', layer: { kind: 'Model', props: { modelAssetId: 'missing-id' } } },
    ],
  },
});
check(
  'pending asset refused',
  pendingLayer.status === 422 &&
    pendingLayer.body.errors['layer.assetId'] === "This upload isn't ready yet.",
  JSON.stringify(pendingLayer.body),
);

// Member counts (DP-39)
const summary = await call('GET', `/api/projects`, { session: ines });
const heroSummary = summary.body.projects.find((project) => project.name === 'Lumen hero');
check(
  'counts match',
  heroSummary.editorCount === 1 && heroSummary.viewerCount === 1 && heroSummary.liveVersion === 3,
  JSON.stringify(heroSummary),
);

// Variables and presets (DP-33, DP-34)
const room = P('Variable room');
const bind = await call('POST', `/api/projects/${room.id}/ops`, {
  session: ines,
  body: {
    opId: 'bind-1',
    sceneId: room.scenes.Main,
    changes: [{ type: 'bind', layerId: room.layers.Spinner, property: 'rotation', variable: 'spin' }],
  },
});
check('bind vector', bind.status === 200, JSON.stringify(bind.body));
const boundInspect = await call(
  'GET',
  `/api/projects/${room.id}/inspect?scene=${room.scenes.Main}&layer=${room.layers.Spinner}`,
  { session: ines },
);
check('bound value applied', boundInspect.body.values['rotation.y'] === 45, String(boundInspect.body.values['rotation.y']));
await call('POST', `/api/projects/${room.id}/ops`, {
  session: ines,
  body: {
    opId: 'preset-1',
    sceneId: room.scenes.Main,
    changes: [{ type: 'applyPreset', name: 'Lively' }],
  },
});
const afterPreset = await call(
  'GET',
  `/api/projects/${room.id}/inspect?scene=${room.scenes.Main}&layer=${room.layers.Spinner}`,
  { session: ines },
);
check('preset applied', afterPreset.body.values['rotation.y'] === 90, String(afterPreset.body.values['rotation.y']));
const deleteVariable = await call('POST', `/api/projects/${room.id}/ops`, {
  session: ines,
  body: {
    opId: 'delvar-1',
    sceneId: room.scenes.Main,
    changes: [{ type: 'deleteVariable', name: 'spin' }],
  },
});
check(
  'variable delete counts one binding',
  deleteVariable.body.variableDeleteCounts.spin === 1,
  JSON.stringify(deleteVariable.body.variableDeleteCounts),
);
const afterDeleteVariable = await call(
  'GET',
  `/api/projects/${room.id}/inspect?scene=${room.scenes.Main}&layer=${room.layers.Spinner}`,
  { session: ines },
);
check(
  'last value kept',
  afterDeleteVariable.body.values['rotation.y'] === 90,
  String(afterDeleteVariable.body.values['rotation.y']),
);
const badVariableName = await call('POST', `/api/projects/${room.id}/ops`, {
  session: ines,
  body: {
    opId: 'var-bad',
    sceneId: room.scenes.Main,
    changes: [{ type: 'addVariable', variable: { name: 'Bad Name', type: 'Number', value: 1 } }],
  },
});
check(
  'variable name validation',
  badVariableName.status === 422 &&
    badVariableName.body.message ===
      'Use a lowercase letter first, then lowercase letters, digits or _ (at most 32 characters).',
);

// Extrusion refusal (DP-16)
const badCharacter = await call('POST', `/api/projects/${P('Logo forge').id}/ops`, {
  session: ines,
  body: {
    opId: 'char-1',
    sceneId: P('Logo forge').scenes.Main,
    changes: [
      { type: 'updateLayer', layerId: P('Logo forge').layers.Wordmark, set: { text: 'HAL%' } },
    ],
  },
});
check(
  'unsupported character refused',
  badCharacter.status === 422 &&
    badCharacter.body.errors['set.text'] === 'Character "%" is not in the built-in outline font.',
  JSON.stringify(badCharacter.body),
);

// Easing validation (DP-28)
const badEasing = await call('POST', `/api/projects/${easing.id}/ops`, {
  session: ines,
  body: {
    opId: 'easing-1',
    sceneId: easing.scenes.Main,
    changes: [
      {
        type: 'setKeyframe',
        layerId: easing.layers.Blank,
        property: 'rotation.y',
        frame: 0,
        value: 0,
        easing: 'wobble',
      },
    ],
  },
});
check(
  'easing validation',
  badEasing.status === 422 && badEasing.body.errors.easing === 'Choose one of the listed easings.',
  JSON.stringify(badEasing.body),
);
const spring = await call('POST', `/api/projects/${easing.id}/ops`, {
  session: ines,
  body: {
    opId: 'easing-2',
    sceneId: easing.scenes.Main,
    changes: [
      {
        type: 'setKeyframe',
        layerId: easing.layers.Blank,
        property: 'rotation.y',
        frame: 0,
        value: 0,
        easing: { type: 'spring', stiffness: 170, damping: 26, mass: 1 },
      },
      {
        type: 'setKeyframe',
        layerId: easing.layers.Blank,
        property: 'rotation.y',
        frame: 60,
        value: 100,
        easing: 'linear',
      },
    ],
  },
});
check('spring keyframe', spring.status === 200, JSON.stringify(spring.body));
const springValue = await call(
  'GET',
  `/api/projects/${easing.id}/inspect?scene=${easing.scenes.Main}&layer=${easing.layers.Blank}&frame=15`,
  { session: ines },
);
check(
  'spring at 15 frames',
  springValue.body.values['rotation.y'] === 84.475,
  String(springValue.body.values['rotation.y']),
);

// Body limits
const bigBody = await call('POST', `/api/projects/${P('Lumen hero').id}/ops`, {
  session: ines,
  body: { opId: 'big', sceneId: heroScene, changes: [], padding: 'x'.repeat(1048600) },
});
check('body limit', bigBody.status === 413 && bigBody.body.error === 'too_large', JSON.stringify(bigBody.body));

// Cross origin
const cross = await fetch(`${BASE}/api/session`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://evil.test' },
  body: JSON.stringify({ email: 'ines@lumenyard.test', password: 'halation-ines-01' }),
});
check('cross origin refused', cross.status === 403, String(cross.status));

// Inspect validation
const badFrame = await call(
  'GET',
  `/api/projects/${P('Lumen hero').id}/inspect?scene=${heroScene}&scroll=400`,
  { session: ines },
);
check('inspect range validation', badFrame.status === 422, JSON.stringify(badFrame.body));

const failed = results.filter((entry) => !entry.ok).length;
console.log(`${results.length - failed}/${results.length} API checks passed`);
