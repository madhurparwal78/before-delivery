#!/usr/bin/env node
// Grading setup, versions, differences, restore, live sockets, presence.
import { call, setCookie, freshCookie, BASE } from './lib.mjs';
import WebSocket from '../node_modules/ws/index.js';

const failures = [];
function check(name, condition, extra) {
  if (condition) console.log(`ok   ${name}`);
  else { console.log(`FAIL ${name}${extra ? ` — ${JSON.stringify(extra).slice(0, 500)}` : ''}`); failures.push(name); }
}

const key = process.env.GRADING_KEY;
const uniq = String(Date.now()).slice(-6);

// wrong key => absent
let res = await call('POST', '/api/grading/setup', {}, { headers: { 'x-grading-key': 'nope' } });
check('grading wrong key looks absent', res.status === 404, res);
res = await call('POST', '/api/grading/setup', {});
check('grading missing key looks absent', res.status === 404, res);

// create the users and layout
const body = {
  users: [
    { username: 'ana-1', password: 'drafting-01' },
    { username: 'bob-1', password: 'drafting-02' },
  ],
  layouts: [
    {
      ref: 'L1', owner: 'ana-1', name: 'Pricing page', template: 'holy-grail',
      versions: [
        { name: 'First pass', template: 'blank' },
        { name: 'Second pass', template: 'holy-grail' },
      ],
      collaborators: ['bob-1'],
      view_link: true,
    },
  ],
};
res = await call('POST', '/api/grading/setup', body, { headers: { 'x-grading-key': key } });
check('grading setup 201', res.status === 201, res);
const setup = res.json;
check('sessions for each user', setup.sessions['ana-1'] && setup.sessions['bob-1'], Object.keys(setup.sessions ?? {}));
check('layout ref', setup.layouts.L1 && setup.layouts.L1.id && setup.layouts.L1.revision === 1, setup.layouts.L1);
check('view link', setup.layouts.L1.view_path?.startsWith('/view/'), setup.layouts.L1);
check('join link', setup.layouts.L1.join_path?.startsWith('/join/'), setup.layouts.L1);
const layoutId = setup.layouts.L1.id;
const viewPath = setup.layouts.L1.view_path;

// sessions work
setCookie(`mullion_session=${setup.sessions['ana-1']}`);
res = await call('GET', '/api/me');
check('ana session works', res.status === 200 && res.json.username === 'ana-1', res);
res = await call('GET', `/api/layouts`);
check('library has L1', res.json.layouts.some((l) => l.id === layoutId), res.json);

setCookie(`mullion_session=${setup.sessions['bob-1']}`);
res = await call('GET', `/api/layouts/${layoutId}`);
check('bob can open L1', res.status === 200 && res.json.role === 'collaborator', res);

// collaborators listed
setCookie(`mullion_session=${setup.sessions['ana-1']}`);
res = await call('GET', `/api/layouts/${layoutId}/share`);
check('collaborators listed', res.json.collaborators.includes('bob-1'), res.json);

// versions
res = await call('GET', `/api/layouts/${layoutId}/versions`);
check('two versions', res.json.versions.length === 2 && res.json.versions[0].name === 'First pass', res.json);

// differences: blank (v1) vs holy grail (v2)
res = await call('GET', `/api/layouts/${layoutId}/compare?from=1&to=2`);
const expected = [
  'Columns: 1fr 1fr 1fr → 1fr',
  'Rows: 1fr 1fr 1fr → auto auto 1fr auto auto',
  'Area aside added: 4 / 1 / 5 / 2',
  'Area footer added: 5 / 1 / 6 / 2',
  'Area header added: 1 / 1 / 2 / 2',
  'Area main added: 3 / 1 / 4 / 2',
  'Area nav added: 2 / 1 / 3 / 2',
  'Breakpoint From 768px added',
];
check('differences exact', JSON.stringify(res.json.differences) === JSON.stringify(expected), res.json.differences);

// version data
res = await call('GET', `/api/layouts/${layoutId}/versions/1`);
check('version 1 layout', res.json.layout.columns.length === 3 && res.json.layout.areas.length === 0, res.json.layout?.columns);

// restore version 1 via change
res = await call('GET', `/api/layouts/${layoutId}`);
const baseRevision = res.json.revision;
res = await call('POST', `/api/layouts/${layoutId}/changes`, { base_revision: baseRevision, change: { kind: 'restore_version', number: 1 } });
check('restore version 1', res.status === 200, res);
res = await call('GET', `/api/layouts/${layoutId}/versions`);
check('restore created version 3', res.json.versions.some((v) => v.number === 3 && v.name === 'Restored from version 1'), res.json.versions);

// live socket: open an editor socket and a view socket, then make a change
async function openSocket(path, cookieHeader) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:4173${path}`, { headers: cookieHeader ? { cookie: cookieHeader } : {} });
    const messages = [];
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('message', (data) => messages.push(JSON.parse(String(data))));
    ws.on('error', (e) => reject(e));
    setTimeout(() => resolve({ ws, messages }), 2000);
  });
}

const anaCookieHeader = `mullion_session=${setup.sessions['ana-1']}`;
const editor = await openSocket(`/api/layouts/${layoutId}/live`, anaCookieHeader);
const viewer = await openSocket(viewPath.replace('/view', '/api/view') + '/live');
await new Promise((r) => setTimeout(r, 700));

// make a change as ana
res = await call('GET', `/api/layouts/${layoutId}`);
res = await call('POST', `/api/layouts/${layoutId}/changes`, { base_revision: res.json.revision, change: { kind: 'set_track', scope: 'base', axis: 'column', index: 1, size: '2fr' } });
check('change applied', res.status === 200, res);

await new Promise((r) => setTimeout(r, 1500));
const editorChanges = editor.messages.filter((m) => m.kind === 'change');
const viewerChanges = viewer.messages.filter((m) => m.kind === 'change');
check('editor got live change', editorChanges.length >= 1, editor.messages.map((m) => m.kind));
check('view page got live change', viewerChanges.length >= 1, viewer.messages.map((m) => m.kind));
const presenceMessages = editor.messages.filter((m) => m.kind === 'presence');
check('editor got presence', presenceMessages.length >= 1 && presenceMessages[0].usernames?.includes('ana-1'), presenceMessages);

// cross-origin upgrade refused
let refused = false;
await new Promise((resolve) => {
  const ws = new WebSocket('ws://127.0.0.1:4173/api/layouts/' + layoutId + '/live', { headers: { cookie: anaCookieHeader, origin: 'http://evil.example' } });
  ws.on('error', () => { refused = true; resolve(); });
  ws.on('open', () => { ws.close(); resolve(); });
  setTimeout(resolve, 1500);
});
check('cross-origin upgrade refused', refused, refused);

// unauthorized upgrade refused
let unauthorized = false;
await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:4173/api/layouts/${layoutId}/live`);
  ws.on('error', () => { unauthorized = true; resolve(); });
  ws.on('open', () => { ws.close(); resolve(); });
  setTimeout(resolve, 1500);
});
check('unauthorized upgrade refused', unauthorized, unauthorized);

editor.ws?.close?.();
viewer.ws?.close?.();

// grading setup idempotence: same passwords reuse users
res = await call('POST', '/api/grading/setup', body, { headers: { 'x-grading-key': key } });
check('grading setup repeat works', res.status === 201, res);

// taken username with a different password
const taken = { users: [{ username: 'ana-1', password: 'different-pass' }], layouts: [] };
res = await call('POST', '/api/grading/setup', taken, { headers: { 'x-grading-key': key } });
check('taken user with new password 409', res.status === 409 && res.json.error === 'taken', res);

// invalid layout values refuse everything
const bad = { users: [{ username: `c-${uniq}`, password: 'drafting-03' }], layouts: [{ ref: 'B', owner: `c-${uniq}`, name: 'Bad', columns: ['1fr'], rows: ['1fr'], gap: { row: 16, column: 16 }, areas: [{ name: '1bad', row_start: 1, column_start: 1, row_end: 2, column_end: 2 }], breakpoints: [] }] };
res = await call('POST', '/api/grading/setup', bad, { headers: { 'x-grading-key': key } });
check('bad area name refuses', res.status === 422, res);

console.log(failures.length === 0 ? '\nALL PASS' : `\n${failures.length} FAILURES: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
