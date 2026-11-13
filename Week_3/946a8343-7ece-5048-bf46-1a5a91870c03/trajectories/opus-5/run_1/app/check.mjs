const base = `http://127.0.0.1:${process.env.APP_PUBLIC_PORT ?? 4173}`;
const cookies = new Map();

async function call(method, path, body, user) {
  const headers = { 'content-type': 'application/json' };
  if (user !== undefined) headers.cookie = cookies.get(user) ?? '';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

async function session(username) {
  const response = await fetch(`${base}/api/grading/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  cookies.set(username, (response.headers.get('set-cookie') ?? '').split(';')[0]);
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ` — ${detail}`}\n`);
}

const pipelineConfig =
  'stages: [build, test]\nbuild:\n  stage: build\n  script:\n    - print building\n    - write dist/out.txt built\n  artifacts:\n    paths: [dist/out.txt]\ntest:\n  stage: test\n  needs: [build]\n  script:\n    - print testing\n';

const tag = process.argv[2] ?? String(Date.now()).slice(-6);
const users = [`ana${tag}`, `ben${tag}`, `cy${tag}`];
const [ana, ben, cy] = users;

const seed = {
  users: users.map((username) => ({ username, password: 'pass-1234' })),
  groups: [
    {
      key: 'g',
      path: `check-${tag}`,
      visibility: 'private',
      members: [
        { username: ana, role: 'owner' },
        { username: ben, role: 'maintainer' },
        { username: cy, role: 'developer' },
      ],
    },
  ],
  projects: [
    {
      key: 'p',
      group: `check-${tag}`,
      slug: 'shop',
      default_branch: 'main',
      settings: { reset_approvals_on_push: true, merge_trains: true },
      protected_branches: [{ name: 'main', allowed_to_push: 'maintainer', allowed_to_merge: 'developer' }],
      push_rules: { secrets: true },
      approval_rules: [{ name: 'Backend', required: 1, users: [ben], groups: [] }],
      commits: [
        {
          key: 'c1',
          branch: 'main',
          as: ana,
          timestamp: 1767225600,
          message: 'First commit',
          actions: [
            { action: 'create', path: 'README.md', content: 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n' },
            { action: 'create', path: 'spurline.pipeline.yml', content: pipelineConfig },
          ],
        },
        {
          key: 'c2',
          branch: 'feat/a',
          start_ref: 'main',
          as: cy,
          timestamp: 1767229200,
          message: 'Change two',
          actions: [
            { action: 'update', path: 'README.md', content: 'one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n' },
          ],
        },
      ],
      merge_requests: [
        {
          key: 'mr1',
          title: 'Change two',
          source: 'feat/a',
          target: 'main',
          author: cy,
          description: 'Closes #1',
          reviewers: [ben],
          delete_source_branch: true,
          state: 'opened',
        },
      ],
      issues: [{ key: 'i1', title: 'Fix two', author: ana, state: 'opened' }],
    },
  ],
};

const seeded = await call('POST', '/api/grading/seed', seed);
if (seeded.status !== 201) {
  process.stdout.write(`seed failed: ${JSON.stringify(seeded.body)}\n`);
  process.exit(1);
}
for (const user of users) await session(user);
const project = seeded.body.projects.p;
const projectId = project.id;
const head = project.commits.c1;
check('seed returns commit id', head.length === 64, JSON.stringify(project.commits));

const refused = await call(
  'POST',
  `/api/projects/${projectId}/commits`,
  { branch: 'main', base_commit: head, message: 'direct', actions: [{ action: 'update', path: 'README.md', content: 'x\n' }] },
  cy,
);
check(
  'protected branch refusal',
  refused.status === 403 && refused.body.error === 'protected_branch' && refused.body.message === "You can't push to protected branch main.",
  JSON.stringify(refused),
);

const stale = await call(
  'POST',
  `/api/projects/${projectId}/commits`,
  { branch: 'main', base_commit: 'a'.repeat(64), message: 'stale', actions: [{ action: 'update', path: 'README.md', content: 'x\n' }] },
  ben,
);
check('stale base 409', stale.status === 409 && stale.body.error === 'stale_base', JSON.stringify(stale));

const secret = await call(
  'POST',
  `/api/projects/${projectId}/commits`,
  {
    branch: 'feat/a',
    base_commit: project.commits.c2,
    message: 'secret',
    actions: [{ action: 'create', path: 'keys.txt', content: 'AKABCDEFGHIJKLMNOPQR\n' }],
  },
  cy,
);
check(
  'secret push rule',
  secret.status === 422 && secret.body.message === 'Secret found: cloud-key in keys.txt at line 1.',
  JSON.stringify(secret),
);

const diff = await call('GET', `/api/projects/${projectId}/merge_requests/1/diff`, undefined, ben);
const hunk = diff.body.diffs[0].hunks[0];
check('hunk header', hunk.header === '@@ -1,5 +1,5 @@', JSON.stringify(hunk.header));
check(
  'deletion before addition',
  hunk.lines.map((line) => line.type).join(',') === 'context,del,add,context,context,context',
  hunk.lines.map((line) => line.type).join(','),
);

const thread = await call(
  'POST',
  `/api/projects/${projectId}/merge_requests/1/threads`,
  { body: 'Rename this.', position: { path: 'README.md', new_line: 3, version: 1 } },
  ben,
);
check('thread created', thread.status === 201, JSON.stringify(thread));

const approve = await call('POST', `/api/projects/${projectId}/merge_requests/1/approve`, { sha: null }, ben);
check(
  'approval announcement',
  approve.status === 200 && approve.body.announcement === 'Approved. All approval rules are satisfied.',
  JSON.stringify(approve.body),
);

const blocked = await call('POST', `/api/projects/${projectId}/merge_requests/1/merge`, {}, ben);
check(
  'merge blocked by threads',
  blocked.status === 409 && blocked.body.message === '1 unresolved thread must be resolved.',
  JSON.stringify(blocked.body),
);

const sourceHead = (await call('GET', `/api/projects/${projectId}/branch_head?name=feat/a`, undefined, cy)).body.commit;
const push = await call(
  'POST',
  `/api/projects/${projectId}/commits`,
  {
    branch: 'feat/a',
    base_commit: sourceHead,
    message: 'Change three',
    actions: [
      { action: 'update', path: 'README.md', content: 'one\nTWO\nTHREE\nfour\nfive\nsix\nseven\neight\nnine\nten\n' },
    ],
  },
  cy,
);
check('push to source branch', push.status === 201, JSON.stringify(push.body));

const after = await call('GET', `/api/projects/${projectId}/merge_requests/1`, undefined, ben);
check('version 2 made', after.body.versions.length === 2, JSON.stringify(after.body.versions.map((v) => v.number)));
check('approvals reset on push', after.body.approvals.approved_by.length === 0, JSON.stringify(after.body.approvals.approved_by));
check('thread outdated after change', after.body.threads[0].outdated === true, JSON.stringify(after.body.threads[0]));
const notes = (await call('GET', `/api/projects/${projectId}/merge_requests/1/notes?filter=history`, undefined, ben)).body.notes.map(
  (note) => note.body,
);
check('push notes', notes.includes('Added 1 commit.') && notes.includes('Approvals reset: new commits were pushed.'), JSON.stringify(notes));

const resolve = await call(
  'PATCH',
  `/api/projects/${projectId}/merge_requests/1/threads/${after.body.threads[0].id}`,
  { resolved: true },
  ben,
);
check('thread resolved', resolve.status === 200 && resolve.body.unresolved === 0, JSON.stringify(resolve.body));

await call('POST', `/api/projects/${projectId}/merge_requests/1/approve`, {}, ben);
const merged = await call('POST', `/api/projects/${projectId}/merge_requests/1/merge`, {}, ben);
check('merge succeeds', merged.status === 200 && merged.body.state === 'merged', JSON.stringify(merged.body));
const issue = await call('GET', `/api/projects/${projectId}/issues/1`, undefined, ana);
check(
  'closing keyword closed the issue',
  issue.body.state === 'closed' && issue.body.notes.some((note) => note.body === 'Closed by !1.'),
  JSON.stringify(issue.body.notes.map((note) => note.body)),
);
const refs = await call('GET', `/api/projects/${projectId}/refs`, undefined, ana);
check(
  'source branch deleted on merge',
  !refs.body.branches.some((branch) => branch.name === 'feat/a'),
  JSON.stringify(refs.body.branches.map((branch) => branch.name)),
);

const lint = await call(
  'POST',
  `/api/projects/${projectId}/ci/lint`,
  { content: 'stages: [build]\nbuild:\n  stage: test\n  script:\n    - print x\n' },
  ana,
);
check(
  'lint stage error',
  lint.body.errors[0] === 'Line 3: job "build" uses stage "test", which isn\'t in stages.',
  JSON.stringify(lint.body.errors),
);
const lintOk = await call(
  'POST',
  `/api/projects/${projectId}/ci/lint`,
  { content: 'stages: [build]\nbuild:\n  stage: build\n  script:\n    - print x\n' },
  ana,
);
check('lint valid summary', lintOk.body.summary === 'Valid. 1 jobs in 1 stages.', lintOk.body.summary);

const settle = await call('POST', '/api/grading/runner/settle', { project: projectId });
check('runner settles', settle.status === 200, JSON.stringify(settle.body).slice(0, 120));
const pipelines = await call('GET', `/api/projects/${projectId}/pipelines`, undefined, ana);
const latest = pipelines.body.pipelines[0];
const full = await call('GET', `/api/pipelines/${latest.id}`, undefined, ana);
check(
  'graph layout',
  full.body.jobs.every((job) => job.x === 40 + job.layer * 240 && job.y === 40 + job.row * 96),
  JSON.stringify(full.body.jobs.map((job) => [job.name, job.layer, job.row, job.x, job.y])),
);
check(
  'needs layer',
  full.body.jobs.find((job) => job.name === 'test')?.layer === 1,
  JSON.stringify(full.body.jobs.map((job) => [job.name, job.layer])),
);

const notFound = await call('GET', `/api/projects/${projectId}`, undefined, undefined);
check('unauthenticated 401', notFound.status === 401 && notFound.body.error === 'unauthenticated', JSON.stringify(notFound));
const badJson = await fetch(`${base}/api/projects/${projectId}/issues`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: cookies.get(ana) ?? '' },
  body: '{',
});
check('bad json 400', badJson.status === 400, String(badJson.status));

process.stdout.write(`\n${results.filter((item) => item.pass).length}/${results.length} checks passed\n`);
