#!/usr/bin/env node
// API smoke test: accounts, layouts, changes, CSS, breakpoints, conflicts, links.
import { call, setCookie, freshCookie, BASE } from './lib.mjs';

const failures = [];
function check(name, condition, extra) {
  if (condition) console.log(`ok   ${name}`);
  else { console.log(`FAIL ${name}${extra ? ` — ${JSON.stringify(extra).slice(0, 400)}` : ''}`); failures.push(name); }
}

const uniq = String(Date.now()).slice(-6);

// accounts
let res = await call('POST', '/api/signup', { username: `ana-${uniq}`, password: 'drafting-01' });
check('signup 201', res.status === 201, res);
res = await call('POST', '/api/signup', { username: `ana-${uniq}`, password: 'drafting-01' });
check('signup taken 409', res.status === 409 && res.json.error === 'taken', res);
freshCookie();
res = await call('POST', '/api/session', { username: `ana-${uniq}`, password: 'drafting-01' });
check('signin 200', res.status === 200, res);
res = await call('GET', '/api/me');
check('me', res.status === 200 && res.json.username === `ana-${uniq}`, res);
res = await call('POST', '/api/signup', { username: 'x', password: 'drafting-01' });
check('username rule', res.status === 422 && res.json.message.startsWith('Usernames use'), res);
res = await call('POST', '/api/signup', { username: `bob-${uniq}`, password: 'short' });
check('password rule', res.status === 422 && res.json.message === 'Passwords are 8 to 128 characters.', res);

// layouts
res = await call('POST', '/api/layouts', { name: 'My pricing', template: 'holy-grail' });
check('create holy grail', res.status === 201 && res.json.revision === 1, res);
const layout = res.json;
check('holy grail columns', JSON.stringify(layout.columns) === JSON.stringify(['1fr']), layout.columns);
check('holy grail css head', layout.css.startsWith('.layout {\n  display: grid;\n  grid-template-columns: 1fr;\n  grid-template-rows: auto auto 1fr auto auto;\n  gap: 16px;\n  grid-template-areas:\n    "header"\n    "nav"\n    "main"\n    "aside"\n    "footer";\n}\n\n.header { grid-area: header; }'), layout.css);
check('holy grail media block', layout.css.includes('@media (min-width: 768px) {\n  .layout {\n    grid-template-columns: 200px 1fr 200px;\n    grid-template-rows: auto 1fr auto;\n    grid-template-areas:\n      "header header header"\n      "nav main aside"\n      "footer footer footer";\n  }\n}\n'), layout.css);
check('holy grail html', layout.html === '<div class="layout">\n  <div class="header">header</div>\n  <div class="nav">nav</div>\n  <div class="main">main</div>\n  <div class="aside">aside</div>\n  <div class="footer">footer</div>\n</div>\n', layout.html);
const id = layout.id;

res = await call('GET', '/api/layouts');
check('library lists layout', res.status === 200 && res.json.layouts.some((l) => l.id === id), res);

// blank template css
res = await call('POST', '/api/layouts', { name: 'Blank test', template: 'blank' });
check('blank css', res.json.css === '.layout {\n  display: grid;\n  grid-template-columns: 1fr 1fr 1fr;\n  grid-template-rows: 1fr 1fr 1fr;\n  gap: 16px;\n}\n', res.json.css);
check('blank html', res.json.html === '<div class="layout"></div>\n', res.json.html);

// track sizes
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: 1, change: { kind: 'set_track', scope: 768, axis: 'column', index: 1, size: 'minmax(200px, 1fr)' } });
check('set track minmax', res.status === 200 && res.json.layout.breakpoints[0].columns[0] === 'minmax(200px, 1fr)', res);
let revision = res.json.revision;
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_track', scope: 768, axis: 'column', index: 1, size: '10em' } });
check('refuse 10em', res.status === 422 && res.json.message === 'Use a size like 1fr, 200px, 25%, auto or minmax(100px, 1fr).', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_track', scope: 768, axis: 'column', index: 1, size: '0fr' } });
check('refuse 0fr', res.status === 422 && res.json.message === 'Sizes run from 0.25fr to 100fr, 1px to 4000px and 1% to 100%.', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_track', scope: 768, axis: 'column', index: 1, size: 'minmax(1fr, 200px)' } });
check('refuse fr min', res.status === 422 && res.json.message === 'A flexible size (fr) can only be the maximum in minmax.', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_track', scope: 768, axis: 'column', index: 1, size: 'minmax(300px, 200px)' } });
check('refuse min>max', res.status === 422 && res.json.message === 'The minimum is larger than the maximum.', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_track', scope: 768, axis: 'column', index: 9, size: '1fr' } });
check('no column 9', res.status === 422 && res.json.message === 'There is no column 9.', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: 99, change: { kind: 'set_track', scope: 'base', axis: 'column', index: 1, size: '2fr' } });
check('unknown base revision', res.status === 422 && res.json.message === 'Unknown base revision.', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_track', scope: 500, axis: 'column', index: 1, size: '2fr' } });
check('no breakpoint 500', res.status === 422 && res.json.message === 'There is no breakpoint at 500px.', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'nonsense' } });
check('unknown change', res.status === 422 && res.json.message === 'Unknown change.', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_track', scope: 768, axis: 'column', index: 1, size: '1.50fr' } });
check('canonical 1.50fr -> 1.5fr', res.status === 200 && res.json.layout.breakpoints[0].columns[0] === '1.5fr', res);
revision = res.json.revision;
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_track', scope: 768, axis: 'column', index: 1, size: '1.5fr' } });
check('unchanged set track', res.status === 200 && res.json.unchanged === true && res.json.revision === revision, res);

// unchanged does not bump revision
res = await call('GET', `/api/layouts/${id}`);
check('revision stable', res.json.revision === revision, res.json.revision);

// areas: create, overlap, extend, rename, clear
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_area', scope: 'base', name: 'hero', row_start: 1, column_start: 1, row_end: 2, column_end: 2 } });
check('area created', res.status === 200 && res.json.layout.areas.some((a) => a.name === 'hero'), res);
revision = res.json.revision;
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_area', scope: 'base', name: 'sidecar', row_start: 1, column_start: 1, row_end: 3, column_end: 2 } });
check('area overlap refused', res.status === 422 && res.json.message === 'Area sidecar would overlap area hero.', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_area', scope: 'base', name: 'layout', row_start: 5, column_start: 1, row_end: 6, column_end: 2 } });
check('reserved name', res.status === 422 && res.json.message === 'The name layout is reserved.', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_area', scope: 'base', name: 'BadName', row_start: 5, column_start: 1, row_end: 6, column_end: 2 } });
check('bad area name', res.status === 422 && res.json.message.startsWith('Area names use'), res);
// rename: exactly the hero area with a new name
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_area', scope: 'base', name: 'masthead', row_start: 1, column_start: 1, row_end: 2, column_end: 2 } });
check('area renamed', res.status === 200 && res.json.layout.areas.some((a) => a.name === 'masthead') && !res.json.layout.areas.some((a) => a.name === 'hero'), res);
revision = res.json.revision;
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'rename_area', name: 'masthead', new_name: 'banner' } });
check('api rename_area', res.status === 200 && res.json.layout.areas.some((a) => a.name === 'banner'), res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'rename_area', name: 'nope', new_name: 'banner2' } });
check('rename unknown area', res.status === 422 && res.json.message === 'There is no area nope.', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'rename_area', name: 'banner', new_name: 'nav' } });
check('rename to used name', res.status === 422 && res.json.message === 'The name nav is already used.', res);
// set over itself: banner at 1,1..2,2 exactly
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_area', scope: 'base', name: 'banner', row_start: 1, column_start: 1, row_end: 2, column_end: 2 } });
check('set over itself unchanged', res.status === 200 && res.json.unchanged === true, res);

// add/remove tracks
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'add_track', scope: 768, axis: 'column', after: 1 } });
if (res.status !== 200) { console.log('FAIL add column', res.status, res.json); process.exit(1); }
const added = res.json.layout.breakpoints[0];
check('add column after 1 joins header', added.areas.find((a) => a.name === 'banner')?.column_end === 5 && added.areas.find((a) => a.name === 'nav')?.column_end === 2, added);
check('added column size 1fr', added.columns[1] === '1fr', added.columns);
revision = res.json.revision;
// undo the add so the breakpoint grid is back to the 3-column original for the removal example
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'undo' } });
check('undo add column', res.status === 200, res);
revision = res.json.revision;
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'remove_track', scope: 768, axis: 'column', index: 3 } });
const afterRemove = res.json.layout.breakpoints[0];
check('remove column 3 gives two columns', afterRemove.columns.length === 2, afterRemove);
check('aside removed', !afterRemove.areas.some((a) => a.name === 'aside'), afterRemove.areas);
revision = res.json.revision;

// gap
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_gap', scope: 768, row: 24, column: 24 } });
check('gap set', res.json.layout.breakpoints[0].gap.row === 24, res);
revision = res.json.revision;
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'set_gap', scope: 768, row: 300, column: 24 } });
check('gap refused', res.status === 422 && res.json.message === 'Gaps are whole pixels from 0 to 200.', res);

// breakpoints
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'add_breakpoint', min_width: 1024 } });
check('breakpoint added', res.status === 200 && res.json.layout.breakpoints.some((b) => b.min_width === 1024), res);
const newBp = res.json.layout.breakpoints.find((b) => b.min_width === 1024);
check('new bp copies grid below', newBp.columns.length === 2 && newBp.areas.length === 4, newBp);
check('new bp gap inherited', newBp.gap === null, newBp);
revision = res.json.revision;
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'add_breakpoint', min_width: 1024 } });
check('duplicate breakpoint', res.status === 422 && res.json.message === 'There is already a breakpoint at 1024px.', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'add_breakpoint', min_width: 200 } });
check('breakpoint range', res.status === 422 && res.json.message === 'Breakpoints start between 400px and 1440px.', res);

// apply CSS round trip
res = await call('GET', `/api/layouts/${id}`);
const css = res.json.css;
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: res.json.revision, change: { kind: 'apply_css', css } });
check('apply same css unchanged', res.status === 200 && res.json.unchanged === true, res);

// css error by line
const bad = '.layout {\n  display: grid;\n  grid-template-columns: 10em;\n}\n';
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: res.json.revision, change: { kind: 'apply_css', css: bad } });
check('css line error', res.status === 422 && res.json.message === 'Line 3: Use a size like 1fr, 200px, 25%, auto or minmax(100px, 1fr).', res);

// css edit that adds an area
const edited = css.replace('"header"', '"header header"');
// That would break the row length; instead craft a valid custom css.
const simple = '.layout {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  grid-template-rows: auto auto;\n  gap: 8px;\n  grid-template-areas:\n    "one two"\n    "one two";\n}\n\n.one { grid-area: one; }\n.two { grid-area: two; }\n';
res = await call('GET', `/api/layouts/${id}`);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: res.json.revision, change: { kind: 'apply_css', css: simple } });
check('apply css adds areas', res.status === 200 && res.json.layout.areas.length === 2, res);
revision = res.json.revision;
res = await call('GET', `/api/layouts/${id}`);
check('css applied canonical', res.json.css === simple, res.json.css);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'apply_css', css: simple } });
check('apply same css again unchanged', res.status === 200 && res.json.unchanged === true, res);

// undo / redo
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: res.json.revision, change: { kind: 'set_track', scope: 'base', axis: 'column', index: 1, size: '3fr' } });
revision = res.json.revision;
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'undo' } });
check('undo applies', res.status === 200 && res.json.layout.columns[0] === '1fr', res);
revision = res.json.revision;
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: revision, change: { kind: 'redo' } });
check('redo applies', res.status === 200 && res.json.layout.columns[0] === '3fr', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: res.json.revision, change: { kind: 'undo' } });
check('undo again', res.status === 200, res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: res.json.revision, change: { kind: 'undo' } });
check('second undo', res.status === 200, res);

// versions
res = await call('POST', `/api/layouts/${id}/versions`, { name: 'First pass' });
check('save version', res.status === 201 && res.json.number === 1, res);
res = await call('GET', `/api/layouts/${id}/versions`);
check('list versions', res.status === 200 && res.json.versions.length === 1, res);
res = await call('POST', `/api/layouts/${id}/versions`, { name: '' });
check('version name rule', res.status === 422 && res.json.message === 'Version names are 1 to 60 characters.', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: (await (await call('GET', `/api/layouts/${id}`)).json).revision, change: { kind: 'set_gap', scope: 'base', row: 10, column: 10 } });
res = await call('POST', `/api/layouts/${id}/versions`, { name: 'Second pass' });
check('second version', res.json.number === 2, res);
res = await call('GET', `/api/layouts/${id}/compare?from=1&to=2`);
check('compare differences', res.status === 200 && res.json.differences.some((d) => d.startsWith('Gap: ')), res);
res = await call('GET', `/api/layouts/${id}/compare?from=1&to=1`);
check('no differences', res.json.differences[0] === 'No differences.', res);

// restore
res = await call('GET', `/api/layouts/${id}`);
const beforeRestoreRevision = res.json.revision;
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: beforeRestoreRevision, change: { kind: 'restore_version', number: 1 } });
check('restore version', res.status === 200 && res.json.revision === beforeRestoreRevision + 1, res);
const restoredRevision = res.json.revision;
res = await call('GET', `/api/layouts/${id}/versions`);
check('restore creates version', res.json.versions.some((v) => v.name === 'Restored from version 1'), res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: beforeRestoreRevision, change: { kind: 'set_gap', scope: 'base', row: 33, column: 33 } });
check('stale change after restore applies when target untouched', res.status === 200, res);
const revAfterGap = res.status === 200 ? res.json.revision : restoredRevision;
res = await call('GET', `/api/layouts/${id}`);
const bobRejoin = await call('POST', '/api/session', { username: `bob-${uniq}`, password: 'drafting-02' });
// Restore again to set up a whole-layout conflict with bob's stale change


// sharing
res = await call('GET', `/api/layouts/${id}/share`);
check('share none', res.status === 200 && res.json.view_path === null, res);
res = await call('POST', `/api/layouts/${id}/view-link`);
check('create view link', res.status === 201 && res.json.view_path.startsWith('/view/'), res);
const viewPath = res.json.view_path;
res = await call('DELETE', `/api/layouts/${id}/view-link`);
check('revoke with link', res.status === 204, res);
res = await call('DELETE', `/api/layouts/${id}/view-link`);
check('revoke without link 409', res.status === 409 && res.json.error === 'no_view_link', res);
res = await call('POST', `/api/layouts/${id}/view-link`);
const viewPath2 = res.json.view_path;
res = await call('GET', `/api${viewPath}`);
check('old view token 404', res.status === 404, res);
freshCookie();
res = await call('GET', `/api${viewPath2}`);
check('view token works signed out', res.status === 200 && res.json.role === 'viewer', res);
res = await call('POST', `/api/layouts/${id}/changes`, { base_revision: 1, change: { kind: 'set_gap', scope: 'base', row: 5, column: 5 } });
check('view token cannot change', res.status === 401, res);

// join link (re-sign-in as ana first: the earlier freshCookie() signed us out)
const anaSession = await call('POST', '/api/session', { username: `ana-${uniq}`, password: 'drafting-01' });
res = await call('GET', `/api/layouts/${id}/share`);
const joinPath = res.json.join_path;
check('join link exists', Boolean(joinPath), res);
res = await call('POST', '/api/signup', { username: `bob-${uniq}`, password: 'drafting-02' });
const bobCookieHeader = res.headers.get('set-cookie').split(';')[0];
setCookie(bobCookieHeader);
res = await call('POST', `/api${joinPath}`);
check('bob joins', res.status === 200 && res.json.layout_id === id, res);
res = await call('GET', `/api/layouts/${id}`);
check('bob can open as collaborator', res.status === 200 && res.json.role === 'collaborator', res);
res = await call('GET', `/api/layouts/${id}/share`);
check('collaborator cannot share', res.status === 404, res);

// conflict: both change column 2 at the same base revision (ana's cookie is active here)
await call('POST', `/api/layouts/${id}/changes`, { base_revision: (await call('GET', `/api/layouts/${id}`)).json.revision, change: { kind: 'add_track', scope: 'base', axis: 'column', after: 1 } });
const current = (await call('GET', `/api/layouts/${id}`)).json;
const conflictBase = current.revision;
// bob's session
const bobSession = await fetch(BASE + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: `bob-${uniq}`, password: 'drafting-02' }) });
const bobHeader = (bobSession.headers.get('set-cookie') ?? '').split(';')[0];
const anaHeader = anaSession.headers.get('set-cookie').split(';')[0];
const [anaRes, bobRes] = await Promise.all([
  fetch(BASE + `/api/layouts/${id}/changes`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: anaHeader }, body: JSON.stringify({ base_revision: conflictBase, change: { kind: 'set_track', scope: 'base', axis: 'column', index: 2, size: '2fr' } }) }).then(async (r) => ({ status: r.status, json: await r.json() })),
  fetch(BASE + `/api/layouts/${id}/changes`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: bobHeader }, body: JSON.stringify({ base_revision: conflictBase, change: { kind: 'set_track', scope: 'base', axis: 'column', index: 2, size: '5fr' } }) }).then(async (r) => ({ status: r.status, json: await r.json() })),
]);
check('conflict refused 409', [anaRes.status, bobRes.status].includes(409), { ana: anaRes.status, bob: bobRes.status });
const loserRes = anaRes.status === 409 ? anaRes : bobRes;
check('conflict body has layout', Boolean(loserRes.json.layout), loserRes.json.error);
check('conflict message', loserRes.json.message.includes('changed column 2 first'), loserRes.json.message);

// collaborator removal
setCookie(bobCookieHeader);
const bobView = (await call('GET', `/api/layouts/${id}`)).json;
check('bob sees ana change', bobView.columns[1] === '2fr' || bobView.columns[1] === '5fr', bobView.columns);
// owner removes bob
const anaCookieHeader = anaSession.headers.get('set-cookie').split(';')[0];
setCookie(anaCookieHeader);
res = await call('DELETE', `/api/layouts/${id}/collaborators/bob-${uniq}`);
check('remove collaborator', res.status === 204, res);
setCookie(bobCookieHeader);
res = await call('GET', `/api/layouts/${id}`);
check('removed collaborator gets 404', res.status === 404, res);
res = await call('GET', '/api/layouts');
check('layout left library', !res.json.layouts.some((l) => l.id === id), res);

// error order
const noCookie = async (path) => fetch(BASE + path).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
res = await noCookie(`/api/layouts/${id}`);
check('signed out 401', res.status === 401, res);
res = await noCookie('/api/layouts/nope');
check('signed out unknown layout 401', res.status === 401, res);
setCookie(anaCookieHeader);
res = await call('GET', '/api/layouts/nope');
check('unknown layout 404', res.status === 404, res);
res = await call('GET', '/api/nothing');
check('unknown route 404', res.status === 404, res);
res = await noCookie('/app/../../package.json');
check('path traversal 404', res.status === 404, res);
res = await noCookie('/package.json');
check('package.json not served', res.status === 404, res.status);
res = await noCookie('/run.json');
check('run.json not served', res.status === 404, res.status);
res = await noCookie('/package-lock.json');
check('lockfile not served', res.status === 404, res.status);
res = await noCookie('/src/server.ts');
check('source not served', res.status === 404, res.status);
res = await noCookie('/.env');
check('env not served', res.status === 404, res.status);
res = await call('POST', `/api/layouts/${id}/changes`, 'not-json');
check('invalid json body', res.status === 422 && res.json.message === 'The request body is not valid.', res);
const big = 'x'.repeat(65537);
res = await fetch(BASE + `/api/layouts/${id}/changes`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: anaCookieHeader }, body: big });
check('oversize body 413', res.status === 413, res.status);
const exact = JSON.stringify({ base_revision: 1, change: { kind: 'set_gap', scope: 'base', row: 1, column: 1 } });
const pad = { base_revision: 1, change: { kind: 'set_gap', scope: 'base', row: 1, column: 1 }, padding: 'y'.repeat(65536 - exact.length - 20) };
const padJson = JSON.stringify(pad);
check('padding size within limit', padJson.length <= 65536, padJson.length);
res = await fetch(BASE + `/api/layouts/${id}/changes`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: anaCookieHeader }, body: padJson });
check('65536 bytes allowed or 409/200', [200, 409, 422].includes(res.status), res.status);

// grading route absent without key header
res = await call('POST', '/api/grading/setup', {});
check('grading route hidden', res.status === 404, res);
res = await call('POST', '/api/grading/setup', {}, { headers: { 'x-grading-key': 'wrong' } });
check('grading wrong key 404', res.status === 404, res);

console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILURES: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
