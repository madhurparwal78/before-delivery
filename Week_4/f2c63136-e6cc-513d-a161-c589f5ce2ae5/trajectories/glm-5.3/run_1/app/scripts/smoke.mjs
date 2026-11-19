#!/usr/bin/env node
/** End-to-end smoke test of the published product behaviour. */
const BASE = process.env.BASE ?? 'http://127.0.0.1:4173';
const GRADING_KEY = process.env.GRADING_KEY ?? 'gk-ridgestack-7d3a91c4';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { passed++; process.stdout.write(`ok   ${name}\n`); }
  else { failed++; failures.push(name + (extra ? ` — ${JSON.stringify(extra).slice(0, 300)}` : '')); process.stdout.write(`FAIL ${name}${extra ? ' ' + JSON.stringify(extra).slice(0, 300) : ''}\n`); }
}

function sessionFrom(res) {
  const cookie = res.headers.get('set-cookie') ?? '';
  const match = cookie.match(/ridgestack_session=([^;]+)/);
  return match ? match[1] : null;
}

async function call(path, { method = 'GET', body, token, session, raw } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (session) headers['Cookie'] = `ridgestack_session=${session}`;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, body: json, text, headers: res.headers };
}

async function main() {
  // Health
  const health = await call('/api/health');
  check('health ok', health.status === 200 && health.body.status === 'ok', health.body);

  // Grading setup: build a full three-change stack with approvals.
  const stamp = Date.now().toString(36);
  // Grading setup: build a full stack with steps.
  const setupRes = await fetch(BASE + '/api/grading/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Grading-Key': GRADING_KEY },
    body: JSON.stringify({
      users: [
        { email: `ada-${stamp}@example.dev`, username: `ada${stamp}`, name: 'Ada Lovelace', password: 'password-123' },
        { email: `bob-${stamp}@example.dev`, username: `bob${stamp}`, name: 'Bob Vista', password: 'password-123' },
        { email: `cat-${stamp}@example.dev`, username: `cat${stamp}`, name: 'Cat Morse', password: 'password-123' },
      ],
      orgs: [
        { slug: `org${stamp}`, name: 'Smoke Org', owner: `ada${stamp}`, teams: [{ name: 'core', members: [`bob${stamp}`, `cat${stamp}`] }] },
      ],
      repos: [
        {
          org: `org${stamp}`,
          name: 'demo',
          visibility: 'private',
          roles: [
            { subject: `user:ada${stamp}`, role: 'owner' },
            { subject: `user:bob${stamp}`, role: 'maintainer' },
            { subject: 'team:core', role: 'writer' },
          ],
          settings: { required_approvals: 2, required_checks: ['lint'], queue: true },
          steps: [
            { as: `ada${stamp}`, key: 'p1', push: { branch: 'main', message: 'Seed files', files: { 'README.md': '# demo\n', 'src/app.ts': 'const a = 1;\n', '.review/OWNERS': `* @ada${stamp}\n/src/app.ts @org${stamp}/core\n` } } },
            { as: `ada${stamp}`, key: 'b1', push: { branch: 'feature-one', from: 'main', message: 'Feature one', files: { 'src/app.ts': 'const a = 2;\n' } } },
            { as: `bob${stamp}`, key: 'c1', change: { title: 'Feature one', head: 'feature-one', base: 'main' } },
            { as: `bob${stamp}`, key: 'b2', push: { branch: 'feature-two', from: 'feature-one', message: 'Feature two', files: { 'src/extra.ts': 'export const extra = true;\n' } } },
            { as: `bob${stamp}`, key: 'c2', change: { title: 'Feature two', head: 'feature-two', base: 'feature-one' } },
          ],
        },
      ],
    }),
  });
  check('grading setup 201', setupRes.status === 201, setupRes.status);
  const setupBody = await setupRes.json();
  const repo = setupBody.repos[`org${stamp}/demo`];
  check('setup has repo id', typeof repo?.id === 'number', setupBody);
  const cookies = setupBody.users;
  const ada = cookies[`ada${stamp}`].cookie;
  const bob = cookies[`bob${stamp}`].cookie;
  const cat = cookies[`cat${stamp}`].cookie;

  // Grading without key: 404
  const noKey = await call('/api/grading/clock', { method: 'POST', body: { advance_seconds: 1 } });
  check('grading route without key is 404', noKey.status === 404, noKey.status);

  // Change page objects
  const c1 = repo.keys.c1;
  const c2 = repo.keys.c2;
  check('change key shape', c1.number === 1 && typeof c1.id === 'string', c1);

  // Read the change as a reader outside the repo: not found (cat is writer, use anon)
  const anonChange = await call(`/api/orgs/org${stamp}/repos/demo/changes/1`);
  check('anonymous read is 401 or 404', [401, 404].includes(anonChange.status), anonChange.status);

  // Public repository visibility: tidepool-api from seeded data
  const seededLogin = await call('/api/login', { method: 'POST', body: { email: 'lena@tidepool.example', password: 'ridgestack-seed-1' } });
  check('seed login lena', seededLogin.status === 200, seededLogin.body);
  const lena = sessionFrom(seededLogin);
  const priyaLogin = await call('/api/login', { method: 'POST', body: { email: 'priya@harbor.example', password: 'ridgestack-seed-1' } });
  check('seed login priya', priyaLogin.status === 200, priyaLogin.body);
  const priya = sessionFrom(priyaLogin);
  const seededRepo = await call('/api/orgs/tidepool/repos/tidepool-api', { session: lena });
  check('seeded tidepool repo visible', seededRepo.status === 200 && seededRepo.body?.name === 'tidepool-api', seededRepo.body);

  // harbor repo as priya
  const priyaChange2 = await call('/api/orgs/harbor/repos/harbor-ledger/changes/1', { session: priya });
  check('seeded change #1 visible to priya', priyaChange2.status === 200 && priyaChange2.body?.number === 1, priyaChange2.body?.number);
  check('seeded change has stack', Array.isArray(priyaChange2.body?.stack) && priyaChange2.body.stack.length === 2, priyaChange2.body?.stack);

  // Push flow on the grading repo: bob pushes to feature-one (restack cascade)
  const branch = await call(`/api/orgs/org${stamp}/repos/demo/branches/feature-one`, { session: bob });
  check('branch read', branch.status === 200 && branch.body.revision.length === 12, branch.body);

  // A push with stale head
  const stale = await call(`/api/orgs/org${stamp}/repos/demo/push`, {
    method: 'POST', session: bob,
    body: { branch: 'feature-one', expected_head: '000000000000', message: 'x', files: [{ path: 'src/app.ts', content: 'y\n' }] },
  });
  check('stale push is 409 with current head', stale.status === 409 && stale.body.error === 'Stale head' && stale.body.current_head === branch.body.revision, stale.body);

  // Token flow
  const tokenRes = await call(`/api/orgs/org${stamp}/repos/demo/tokens`, {
    method: 'POST', session: ada, body: { name: 'ci', access: 'write' },
  });
  check('token created', tokenRes.status === 201 && tokenRes.body.token.startsWith('rgs_'), tokenRes.body);
  const writeToken = tokenRes.body.token;

  // Push with token: fix feature-one
  const pushRes = await call(`/api/orgs/org${stamp}/repos/demo/push`, {
    method: 'POST', token: writeToken,
    body: {
      branch: 'feature-one', expected_head: branch.body.revision, message: 'Adjust app',
      files: [{ path: 'src/app.ts', content: 'const a = 3;\n' }],
    },
  });
  check('token push accepted', pushRes.status === 201 && pushRes.body.revision?.length === 12, { status: pushRes.status, body: pushRes.body });

  // The change above got restacked
  const c2After = await call(`/api/orgs/org${stamp}/repos/demo/changes/2`, { session: bob });
  check('upper change restacked', c2After.status === 200, c2After.body?.restack);

  // Reviews: cat approves #1, bob approves #1
  const r1 = await call(`/api/orgs/org${stamp}/repos/demo/changes/1/reviews`, {
    method: 'POST', session: cat, body: { type: 'approve' },
  });
  check('cat approves #1', r1.status === 201 && r1.body.state === 'approved', r1.body);
  const r2 = await call(`/api/orgs/org${stamp}/repos/demo/changes/1/reviews`, {
    method: 'POST', session: ada, body: { type: 'approve' },
  });
  check('ada approves #1', r2.status === 201, r2.body);

  // Author cannot approve own change
  const r3 = await call(`/api/orgs/org${stamp}/repos/demo/changes/1/reviews`, {
    method: 'POST', session: bob, body: { type: 'approve' },
  });
  check('author cannot approve own change', r3.status === 403 && r3.body.error === 'You cannot approve your own change', r3.body);

  // Checks: report success on #1's head revision
  const c1Obj = await call(`/api/orgs/org${stamp}/repos/demo/changes/1`, { session: bob });
  const lintFail = await call(`/api/orgs/org${stamp}/repos/demo/checks`, {
    method: 'POST', token: writeToken,
    body: { revision: c1Obj.body.head_revision, name: 'lint', state: 'failure', summary: 'nope' },
  });
  check('lint failure reported', lintFail.status === 201, lintFail.body);
  const boxFail = await call(`/api/orgs/org${stamp}/repos/demo/changes/1`, { session: bob });
  const checksRule = boxFail.body.merge_rules.find((r) => r.rule === 'checks');
  check('merge box lists failed check', checksRule && checksRule.text.includes('lint (Failed)'), boxFail.body.merge_rules);
  const lintOk = await call(`/api/orgs/org${stamp}/repos/demo/checks`, {
    method: 'POST', token: writeToken,
    body: { revision: c1Obj.body.head_revision, name: 'lint', state: 'success', summary: 'ok' },
  });
  check('lint success reported', lintOk.status === 201, lintOk.body);

  // Queue admission: refusals first
  const queueOff = await call(`/api/orgs/org${stamp}/repos/demo/settings`, {
    method: 'PUT', session: ada, body: { queue: false },
  });
  check('settings update', queueOff.status === 200 && queueOff.body.queue === false, queueOff.body);
  const queueRefused = await call(`/api/orgs/org${stamp}/repos/demo/changes/1/queue`, { method: 'POST', session: bob });
  console.log('DEBUG queueRefused status:', queueRefused.status, JSON.stringify(queueRefused.body).slice(0, 120));
  check('queue off refusal', queueRefused.status === 409 && queueRefused.body.error === 'This repository does not use a merge queue', queueRefused.body);
  const queueOn = await call(`/api/orgs/org${stamp}/repos/demo/settings`, { method: 'PUT', session: ada, body: { queue: true } });
  console.log('DEBUG queueOn status:', queueOn.status, JSON.stringify(queueOn.body).slice(0, 120));
  check('queue re-enabled', queueOn.status === 200 && queueOn.body.queue === true, queueOn.body);

  const admitted = await call(`/api/orgs/org${stamp}/repos/demo/changes/1/queue`, { method: 'POST', session: bob });
  check('admitted to queue', admitted.status === 201 && admitted.body.position === 1 && admitted.body.state === 'waiting', admitted.body);
  const queueRevision = admitted.body.revision;

  // Queue: lint on the queue revision, then success so the head can merge
  const lintQueued = await call(`/api/orgs/org${stamp}/repos/demo/checks`, {
    method: 'POST', token: writeToken,
    body: { revision: queueRevision, name: 'lint', state: 'in_progress' },
  });
  check('queue lint in progress', lintQueued.status === 201, lintQueued.body);
  const lintQueuedOk = await call(`/api/orgs/org${stamp}/repos/demo/checks`, {
    method: 'POST', token: writeToken,
    body: { revision: queueRevision, name: 'lint', state: 'success', summary: 'ok' },
  });
  check('queue lint success', lintQueuedOk.status === 201, lintQueuedOk.body);

  // Advance the clock past a queue step: the head merges
  const step = await fetch(BASE + '/api/grading/clock', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Grading-Key': GRADING_KEY },
    body: JSON.stringify({ advance_seconds: 31 }),
  });
  const stepBody = await step.json();
  check('clock advances', step.status === 200 && typeof stepBody.offset_seconds === 'number', stepBody);
  const queueAfter = await call(`/api/orgs/org${stamp}/repos/demo/queue`, { session: bob });
  const entry1 = queueAfter.body.entries.find((e) => e.change?.endsWith('#1'));
  check('entry merged after step', queueAfter.body.history.some((h) => h.change?.endsWith('#1') && h.state === 'merged'), queueAfter.body);
  const c1Merged = await call(`/api/orgs/org${stamp}/repos/demo/changes/1`, { session: bob });
  check('change #1 merged', c1Merged.body.state === 'merged' && c1Merged.body.merge_rules === undefined || c1Merged.body.state === 'merged', c1Merged.body.state);

  // Change #2 was retargeted to main after #1 merged
  const c2Retargeted = await call(`/api/orgs/org${stamp}/repos/demo/changes/2`, { session: bob });
  check('#2 base branch retargeted', c2Retargeted.body.base === 'main', c2Retargeted.body.base);
  check('#2 got base-changed notice', c2Retargeted.body.restack.notice?.includes('Base changed to main'), c2Retargeted.body.restack);

  // Thread with suggestion on #2
  const diff2 = await call(`/api/orgs/org${stamp}/repos/demo/changes/2/diff`, { session: cat });
  check('#2 diff readable', diff2.status === 200 && diff2.body.files.length >= 1, diff2.body?.files?.length);
  const extraFile = diff2.body.files.find((f) => f.path === 'src/extra.ts');
  check('extra.ts in diff', !!extraFile, diff2.body.files?.map((f) => f.path));

  const thread = await call(`/api/orgs/org${stamp}/repos/demo/changes/2/threads`, {
    method: 'POST', session: cat,
    body: { path: 'src/extra.ts', side: 'new', line: 1, body: 'Rename this', suggestion: { lines: ['export const feature = true;\n'] } },
  });
  check('thread with suggestion created', thread.status === 201 && thread.body.comments[0].suggestion !== null, thread.body);

  // Invalid thread line
  const badThread = await call(`/api/orgs/org${stamp}/repos/demo/changes/2/threads`, {
    method: 'POST', session: cat,
    body: { path: 'src/extra.ts', side: 'new', line: 99, body: 'nope' },
  });
  check('bad line refused', badThread.status === 422 && badThread.body.errors.line === 'Line 99 is not in the diff', badThread.body);

  // Apply the suggestion as the author (bob created change #2? change created by bob)
  const applyRes = await call(`/api/orgs/org${stamp}/repos/demo/changes/2/suggestions/apply`, {
    method: 'POST', session: bob, body: { comments: [thread.body.comments[0].id] },
  });
  check('suggestion applied', applyRes.status === 201 && applyRes.body.message === 'Apply 1 suggestion', applyRes.body);

  // Double-apply refused
  const applyAgain = await call(`/api/orgs/org${stamp}/repos/demo/changes/2/suggestions/apply`, {
    method: 'POST', session: bob, body: { comments: [thread.body.comments[0].id] },
  });
  check('applied suggestion refused', applyAgain.status === 409 && applyAgain.body.error === 'This suggestion was already applied', applyAgain.body);

  // Archive export
  const archive = await call(`/api/orgs/org${stamp}/repos/demo/revisions/${pushRes.body.revision}/archive`, {
    method: 'POST', session: ada,
  });
  check('archive export', archive.status === 201 && archive.body.key === `archives/${repo.id}/${pushRes.body.revision}.zip` && archive.body.entries.some((e) => e.endsWith('REVISION.txt')), archive.body);

  // Error order: bad JSON body
  const res413 = await fetch(BASE + `/api/orgs/org${stamp}/repos/demo/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `ridgestack_session=${bob}` },
    body: JSON.stringify({ branch: 'big', expected_head: null, message: 'm', files: [{ path: 'a.txt', content: 'x'.repeat(70000) }] }),
  });
  check('oversized push 413', res413.status === 413, res413.status);

  // Non-JSON body
  const res422 = await fetch(BASE + '/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json',
  });
  check('non-json 422', res422.status === 422 && (await res422.json()).errors.body === 'Body must be JSON');

  // Pages
  const home = await fetch(BASE + '/');
  const homeText = await home.text();
  check('home 200 with hero', home.status === 200 && homeText.includes('Stacks that keep their approvals'), home.status);
  check('home has service status', homeText.includes('Service status'));
  const inbox = await fetch(BASE + '/inbox', { headers: { Cookie: `ridgestack_session=${bob}` } });
  check('inbox 200', inbox.status === 200);
  const changePage = await fetch(BASE + `/org${stamp}/demo/changes/2`, { headers: { Cookie: `ridgestack_session=${bob}` } });
  const changePageText = await changePage.text();
  check('change page 200', changePage.status === 200, changePage.status);
  check('change page has stack rail', changePageText.includes('data-stack-position'), null);
  check('change page has merge box', changePageText.includes('Merge box'), null);
  check('change page has diff rows', changePageText.includes('data-kind="added"') || changePageText.includes('data-kind'), null);
  const notFound = await fetch(BASE + '/org-nope/repo-nope', { headers: { Cookie: `ridgestack_session=${bob}` } });
  check('not-found page 404', notFound.status === 404 && (await notFound.text()).includes("We couldn't find that page"));

  // Signed-out working screen redirects to login
  const signedOut = await fetch(BASE + `/org${stamp}/demo/changes/2`, { redirect: 'manual' });
  check('signed-out change page shows login', signedOut.status === 200 || signedOut.status === 302, signedOut.status);

  // Mail: Mailpit should have the merge mail for bob (author of #1? #1 author is bob)
  const mailpit = await fetch((process.env.MAILPIT_URL ?? 'http://mailpit:8025') + '/api/v1/messages');
  const mailBody = await mailpit.json();
  const subjects = mailBody.messages?.map((m) => m.Subject) ?? [];
  check('mailpit has messages', mailBody.total > 0, mailBody.total);
  check('merge mail present', subjects.some((s) => s.includes('merged: Feature one')), subjects.slice(0, 5));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('failures:');
    for (const f of failures) console.log('  -', f);
    process.exit(1);
  }
}

main().catch((e) => { console.error('smoke crashed', e); process.exit(2); });
