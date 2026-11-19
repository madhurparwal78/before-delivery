const base = 'http://127.0.0.1:4173';
let failures = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${a}\n  expected ${e}`);
  }
};

const cookies = new Map();

async function call(method, path, body, who) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (who && cookies.has(who)) headers['cookie'] = `mullion_session=${cookies.get(who)}`;
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'manual',
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie && who) {
    const match = /mullion_session=([^;]*)/.exec(setCookie);
    if (match) cookies.set(who, match[1]);
  }
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

const suffix = Math.random().toString(36).slice(2, 7);
const ana = `ana-${suffix}`;
const bob = `bob-${suffix}`;

/* Accounts. */
eq('signup bad username', (await call('POST', '/api/signup', { username: 'A', password: 'drafting-01' })).body, {
  error: 'invalid',
  message: 'Usernames use 3 to 24 lowercase letters, digits and hyphens and start with a letter.',
});
eq('signup bad password', (await call('POST', '/api/signup', { username: ana, password: 'short' })).body, {
  error: 'invalid',
  message: 'Passwords are 8 to 128 characters.',
});
const signup = await call('POST', '/api/signup', { username: ana, password: 'drafting-01' }, 'ana');
eq('signup', [signup.status, signup.body], [201, { username: ana }]);
eq('signup taken', (await call('POST', '/api/signup', { username: ana, password: 'drafting-01' })).body, {
  error: 'taken',
  message: 'That username is taken.',
});
eq('signin wrong', (await call('POST', '/api/session', { username: ana, password: 'nope-nope' })).body, {
  error: 'wrong_credentials',
  message: 'Wrong username or password.',
});
eq('me', (await call('GET', '/api/me', undefined, 'ana')).body, { username: ana });
eq('me signed out', (await call('GET', '/api/me')).body, { error: 'sign_in_required' });
await call('POST', '/api/signup', { username: bob, password: 'drafting-01' }, 'bob');

/* Layouts. */
eq('layout name refusal', (await call('POST', '/api/layouts', { name: '  ', template: 'blank' }, 'ana')).body, {
  error: 'invalid',
  message: 'Layout names are 1 to 80 characters.',
});
eq('template refusal', (await call('POST', '/api/layouts', { name: 'X', template: 'nope' }, 'ana')).body, {
  error: 'invalid',
  message: 'Choose a starter template.',
});
const created = await call('POST', '/api/layouts', { name: 'Pricing page', template: 'holy-grail' }, 'ana');
eq('create status', created.status, 201);
const id = created.body.id;
eq('create revision', created.body.revision, 1);
eq('create role', created.body.role, 'owner');
eq('create columns', created.body.columns, ['1fr']);
eq('create live', created.body.live, true);
eq('create breakpoints', created.body.breakpoints.length, 1);

const library = await call('GET', '/api/layouts', undefined, 'ana');
eq('library first', library.body.layouts[0].name, 'Pricing page');
eq('library columns', library.body.layouts[0].columns, ['1fr']);

/* Changes. */
async function change(who, change, baseRevision) {
  const current = await call('GET', `/api/layouts/${id}`, undefined, who);
  return call(
    'POST',
    `/api/layouts/${id}/changes`,
    { base_revision: baseRevision ?? current.body.revision, change },
    who,
  );
}

eq(
  'unknown change',
  (await change('ana', { kind: 'nope' })).body,
  { error: 'invalid', message: 'Unknown change.' },
);
eq(
  'bad size',
  (await change('ana', { kind: 'set_track', scope: 'base', axis: 'column', index: 1, size: '10em' })).body,
  { error: 'invalid', message: 'Use a size like 1fr, 200px, 25%, auto or minmax(100px, 1fr).' },
);
eq(
  'missing track',
  (await change('ana', { kind: 'set_track', scope: 'base', axis: 'column', index: 9, size: '1fr' })).body,
  { error: 'invalid', message: 'There is no column 9.' },
);
eq(
  'missing scope',
  (await change('ana', { kind: 'set_track', scope: 900, axis: 'column', index: 1, size: '1fr' })).body,
  { error: 'invalid', message: 'There is no breakpoint at 900px.' },
);
eq(
  'unknown base revision',
  (await change('ana', { kind: 'set_track', scope: 'base', axis: 'column', index: 1, size: '2fr' }, 99)).body,
  { error: 'invalid', message: 'Unknown base revision.' },
);

const sized = await change('ana', {
  kind: 'set_track',
  scope: 768,
  axis: 'column',
  index: 1,
  size: 'minmax( 200px , 300px )',
});
eq('set track status', sized.status, 200);
eq('set track revision', sized.body.revision, 2);
eq('set track canonical', sized.body.layout.breakpoints[0].columns, ['minmax(200px, 300px)', '1fr', '200px']);

const unchanged = await change('ana', {
  kind: 'set_track',
  scope: 768,
  axis: 'column',
  index: 1,
  size: 'minmax(200px, 300px)',
});
eq('unchanged reply', unchanged.body, { revision: 2, unchanged: true });

/* Areas. */
eq(
  'reserved area name',
  (await change('ana', { kind: 'set_area', scope: 'base', name: 'layout', row_start: 1, column_start: 1, row_end: 2, column_end: 2 })).body,
  { error: 'invalid', message: 'The name layout is reserved.' },
);
eq(
  'overlap',
  (await change('ana', { kind: 'set_area', scope: 'base', name: 'promo', row_start: 1, column_start: 1, row_end: 3, column_end: 2 })).body,
  { error: 'invalid', message: 'Area promo would overlap area header.' },
);
eq(
  'rectangle',
  (await change('ana', { kind: 'set_area', scope: 768, name: 'header', row_start: 2, column_start: 2, row_end: 3, column_end: 3 })).body.message,
  'Area header would overlap area main.',
);

const renamed = await change('ana', {
  kind: 'set_area',
  scope: 'base',
  name: 'masthead',
  row_start: 1,
  column_start: 1,
  row_end: 2,
  column_end: 2,
});
eq('rename everywhere base', renamed.body.layout.areas[0].name, 'masthead');
eq('rename everywhere breakpoint', renamed.body.layout.breakpoints[0].areas[0].name, 'masthead');
await change('ana', { kind: 'rename_area', name: 'masthead', new_name: 'header' });

/* Undo and redo. */
const beforeUndo = await call('GET', `/api/layouts/${id}`, undefined, 'ana');
const undone = await change('ana', { kind: 'undo' });
eq('undo status', undone.status, 200);
eq('undo result', undone.body.layout.areas[0].name, 'masthead');
const redone = await change('ana', { kind: 'redo' });
eq('redo result', redone.body.layout.areas[0].name, 'header');
void beforeUndo;

/* Tracks. */
const addedColumn = await change('ana', { kind: 'add_track', scope: 768, axis: 'column', after: 1 });
eq('add track columns', addedColumn.body.layout.breakpoints[0].columns.length, 4);
eq(
  'add track header span',
  addedColumn.body.layout.breakpoints[0].areas.find((a) => a.name === 'header').column_end,
  5,
);
const removedColumn = await change('ana', { kind: 'remove_track', scope: 768, axis: 'column', index: 2 });
eq('remove track columns', removedColumn.body.layout.breakpoints[0].columns.length, 3);

/* Gaps and breakpoints. */
eq(
  'gap refusal',
  (await change('ana', { kind: 'set_gap', scope: 'base', row: 300, column: 16 })).body,
  { error: 'invalid', message: 'Gaps are whole pixels from 0 to 200.' },
);
eq(
  'duplicate breakpoint',
  (await change('ana', { kind: 'add_breakpoint', min_width: 768 })).body,
  { error: 'invalid', message: 'There is already a breakpoint at 768px.' },
);
eq(
  'breakpoint range',
  (await change('ana', { kind: 'add_breakpoint', min_width: 200 })).body,
  { error: 'invalid', message: 'Breakpoints start between 400px and 1440px.' },
);
const addedBreakpoint = await change('ana', { kind: 'add_breakpoint', min_width: 1024 });
eq('breakpoint copies grid', addedBreakpoint.body.layout.breakpoints[1].columns, [
  'minmax(200px, 300px)',
  '1fr',
  '200px',
]);
eq('breakpoint gap inherits', addedBreakpoint.body.layout.breakpoints[1].gap, null);
await change('ana', { kind: 'remove_breakpoint', min_width: 1024 });

/* Apply CSS. */
const current = await call('GET', `/api/layouts/${id}`, undefined, 'ana');
const same = await change('ana', { kind: 'apply_css', css: current.body.css });
eq('apply generated css', same.body.unchanged, true);
eq(
  'css line error',
  (await change('ana', { kind: 'apply_css', css: '.layout {\n  display: grid;\n  grid-template-columns: 10em;\n}\n' })).body
    .message,
  'Line 3: Use a size like 1fr, 200px, 25%, auto or minmax(100px, 1fr).',
);

/* Versions. */
eq(
  'version name refusal',
  (await call('POST', `/api/layouts/${id}/versions`, { name: '' }, 'ana')).body,
  { error: 'invalid', message: 'Version names are 1 to 60 characters.' },
);
const v1 = await call('POST', `/api/layouts/${id}/versions`, { name: 'First pass' }, 'ana');
eq('version 1', [v1.status, v1.body], [201, { number: 1, name: 'First pass' }]);
await change('ana', { kind: 'set_gap', scope: 'base', row: 24, column: 16 });
const v2 = await call('POST', `/api/layouts/${id}/versions`, { name: 'Second pass' }, 'ana');
eq('version 2', v2.body.number, 2);
eq(
  'versions list',
  (await call('GET', `/api/layouts/${id}/versions`, undefined, 'ana')).body,
  { versions: [{ number: 1, name: 'First pass' }, { number: 2, name: 'Second pass' }] },
);
eq(
  'compare',
  (await call('GET', `/api/layouts/${id}/compare?from=1&to=2`, undefined, 'ana')).body,
  { differences: ['Gap: 16px → 24px 16px'] },
);
eq(
  'compare same',
  (await call('GET', `/api/layouts/${id}/compare?from=1&to=1`, undefined, 'ana')).body,
  { differences: ['No differences.'] },
);
eq('compare unknown', (await call('GET', `/api/layouts/${id}/compare?from=1&to=9`, undefined, 'ana')).status, 404);
eq(
  'restore unknown version',
  (await change('ana', { kind: 'restore_version', number: 9 })).body,
  { error: 'invalid', message: 'There is no version 9.' },
);
const restored = await change('ana', { kind: 'restore_version', number: 1 });
eq('restore gap', restored.body.layout.gap, { row: 16, column: 16 });
eq(
  'restore saves version',
  (await call('GET', `/api/layouts/${id}/versions`, undefined, 'ana')).body.versions.at(-1),
  { number: 3, name: 'Restored from version 1' },
);

/* Sharing. */
const share = await call('GET', `/api/layouts/${id}/share`, undefined, 'ana');
eq('share view link absent', share.body.view_path, null);
eq('share join link', share.body.join_path.startsWith('/join/'), true);
eq('revoke with no link', (await call('DELETE', `/api/layouts/${id}/view-link`, undefined, 'ana')).body, {
  error: 'no_view_link',
});
const viewLink = await call('POST', `/api/layouts/${id}/view-link`, undefined, 'ana');
eq('view link created', viewLink.status, 201);
const viewToken = viewLink.body.view_path.slice('/view/'.length);
const viewed = await call('GET', `/api/view/${viewToken}`);
eq('view read', [viewed.status, viewed.body.role], [200, 'viewer']);
const replacedView = await call('POST', `/api/layouts/${id}/view-link`, undefined, 'ana');
eq('old view token gone', (await call('GET', `/api/view/${viewToken}`)).status, 404);
eq('new view token works', (await call('GET', `/api/view/${replacedView.body.view_path.slice(6)}`)).status, 200);
eq('revoke', (await call('DELETE', `/api/layouts/${id}/view-link`, undefined, 'ana')).status, 204);
eq('revoked token gone', (await call('GET', `/api/view/${replacedView.body.view_path.slice(6)}`)).status, 404);

const joinToken = share.body.join_path.slice('/join/'.length);
eq('join signed out', (await call('POST', `/api/join/${joinToken}`)).status, 401);
const joined = await call('POST', `/api/join/${joinToken}`, undefined, 'bob');
eq('join', [joined.status, joined.body.layout_id], [200, id]);
eq(
  'collaborator sees layout',
  (await call('GET', `/api/layouts/${id}`, undefined, 'bob')).body.role,
  'collaborator',
);
eq('collaborator cannot share', (await call('GET', `/api/layouts/${id}/share`, undefined, 'bob')).status, 404);
eq(
  'collaborators listed',
  (await call('GET', `/api/layouts/${id}/share`, undefined, 'ana')).body.collaborators,
  [bob],
);
eq('bob library has layout', (await call('GET', '/api/layouts', undefined, 'bob')).body.layouts.length, 1);

/* Conflicts. */
const revision = (await call('GET', `/api/layouts/${id}`, undefined, 'ana')).body.revision;
const anaWins = await call(
  'POST',
  `/api/layouts/${id}/changes`,
  { base_revision: revision, change: { kind: 'set_track', scope: 'base', axis: 'column', index: 1, size: '2fr' } },
  'ana',
);
eq('ana wins', anaWins.status, 200);
const bobLoses = await call(
  'POST',
  `/api/layouts/${id}/changes`,
  { base_revision: revision, change: { kind: 'set_track', scope: 'base', axis: 'column', index: 1, size: '3fr' } },
  'bob',
);
eq('bob conflict status', bobLoses.status, 409);
eq('bob conflict error', bobLoses.body.error, 'conflict');
eq('bob conflict message', bobLoses.body.message, `${ana} changed column 1 first. Your change was not applied.`);
eq('bob conflict layout', bobLoses.body.layout.columns, ['2fr']);

const nonConflict = await call(
  'POST',
  `/api/layouts/${id}/changes`,
  { base_revision: revision, change: { kind: 'set_gap', scope: 'base', row: 8, column: 8 } },
  'bob',
);
eq('stale but untouched target applies', nonConflict.status, 200);

eq('remove collaborator', (await call('DELETE', `/api/layouts/${id}/collaborators/${bob}`, undefined, 'ana')).status, 204);
eq('removed collaborator 404', (await call('GET', `/api/layouts/${id}`, undefined, 'bob')).status, 404);
eq(
  'remove again 404',
  (await call('DELETE', `/api/layouts/${id}/collaborators/${bob}`, undefined, 'ana')).status,
  404,
);

/* Errors and limits. */
eq('unknown route', (await call('GET', '/api/nope')).body, { error: 'not_found' });
eq('unknown layout', (await call('GET', '/api/layouts/not-a-uuid', undefined, 'ana')).status, 404);
eq('bad json', (await call('POST', '/api/signup', '{nope', 'ana')).body, {
  error: 'invalid',
  message: 'The request body is not valid.',
});
const big = 'x'.repeat(70000);
eq('too large', (await call('POST', '/api/signup', { username: ana, password: big })).body, { error: 'too_large' });
const exact = JSON.stringify({ username: 'x', password: 'y' });
const padded = `{"username":"${'a'.repeat(65536 - exact.length - 20)}","password":"drafting-01"}`;
eq('65536 allowed', (await call('POST', '/api/signup', padded)).status, 422);
eq('no cross origin header', (await call('GET', '/api/health')).headers.get('access-control-allow-origin'), null);

/* Pages. */
const home = await call('GET', '/');
eq('home redirects', [home.status, home.headers.get('location')], [302, '/signin?next=%2F']);
eq('view page unknown', (await call('GET', '/view/nope')).status, 200);
eq('source file hidden', (await call('GET', '/package.json')).status, 404);
eq('run manifest hidden', (await call('GET', '/run.json')).status, 404);
eq('assets served', (await call('GET', '/assets/styles.css')).status, 200);

/* Grading. */
eq('grading without key', (await call('POST', '/api/grading/setup', { users: [] })).body, { error: 'not_found' });
const gradingKey = process.env.GRADING_KEY;
const setup = await fetch(`${base}/api/grading/setup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-grading-key': gradingKey },
  body: JSON.stringify({
    users: [{ username: `cara-${suffix}`, password: 'drafting-01' }],
    layouts: [
      {
        ref: 'L1',
        owner: `cara-${suffix}`,
        name: 'Seeded',
        template: 'holy-grail',
        versions: [{ name: 'First pass', template: 'blank' }],
        view_link: true,
      },
    ],
  }),
});
const setupBody = await setup.json();
eq('grading status', setup.status, 201);
eq('grading sessions', Object.keys(setupBody.sessions), [`cara-${suffix}`]);
eq('grading layout revision', setupBody.layouts.L1.revision, 1);
eq('grading view link', setupBody.layouts.L1.view_path.startsWith('/view/'), true);
cookies.set('cara', setupBody.sessions[`cara-${suffix}`]);
eq(
  'grading session works',
  (await call('GET', '/api/me', undefined, 'cara')).body.username,
  `cara-${suffix}`,
);
eq(
  'grading versions',
  (await call('GET', `/api/layouts/${setupBody.layouts.L1.id}/versions`, undefined, 'cara')).body,
  { versions: [{ number: 1, name: 'First pass' }] },
);
eq(
  'grading invalid value',
  (
    await (
      await fetch(`${base}/api/grading/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-grading-key': gradingKey },
        body: JSON.stringify({ users: [{ username: 'BAD', password: 'drafting-01' }], layouts: [] }),
      })
    ).json()
  ),
  {
    error: 'invalid',
    message: 'Usernames use 3 to 24 lowercase letters, digits and hyphens and start with a letter.',
  },
);

console.log(failures === 0 ? 'ALL API CHECKS PASSED' : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
