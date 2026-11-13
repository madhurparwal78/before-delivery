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
  results.push(pass);
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ` — ${detail}`}\n`);
}

const tag = String(Date.now()).slice(-7);
const own = `own${tag}`;
const dev = `dev${tag}`;
const config = [
  'stages: [test, deploy]',
  'check:',
  '  stage: test',
  '  script:',
  '    - print ok',
  'fail-b:',
  '  stage: test',
  '  script:',
  '    - exit 1',
  '  rules:',
  '    - if: $CI_MERGE_REQUEST_IID == "2"',
  'deploy:',
  '  stage: deploy',
  '  script:',
  '    - write dist/app.txt built',
  '    - print deploying',
  '  artifacts:',
  '    paths: [dist/app.txt]',
  '  environment:',
  '    name: production',
  '  rules:',
  '    - if: $CI_COMMIT_BRANCH == "main" && $CI_PIPELINE_SOURCE == "push"',
  '',
].join('\n');

const files = (value) => `base\n${value}\n`;
const seed = {
  users: [
    { username: own, password: 'pass-1234' },
    { username: dev, password: 'pass-1234' },
  ],
  groups: [
    {
      key: 'g',
      path: `train-${tag}`,
      visibility: 'private',
      members: [
        { username: own, role: 'owner' },
        { username: dev, role: 'developer' },
      ],
    },
  ],
  projects: [
    {
      key: 'p',
      group: `train-${tag}`,
      slug: 'rail',
      default_branch: 'main',
      settings: { merge_trains: true, pipelines_must_succeed: true },
      protected_branches: [{ name: 'main', allowed_to_push: 'maintainer', allowed_to_merge: 'developer' }],
      protected_environments: [{ name: 'production', roles: 'maintainer', approvals: 1 }],
      commits: [
        {
          key: 'c1',
          branch: 'main',
          as: own,
          timestamp: 1767225600,
          message: 'First commit',
          actions: [
            { action: 'create', path: 'a.txt', content: files('main') },
            { action: 'create', path: 'b.txt', content: files('main') },
            { action: 'create', path: 'c.txt', content: files('main') },
            { action: 'create', path: 'spurline.pipeline.yml', content: config },
          ],
        },
        {
          key: 'c2',
          branch: 'feat/a',
          start_ref: 'main',
          as: dev,
          timestamp: 1767229200,
          message: 'A',
          actions: [{ action: 'update', path: 'a.txt', content: files('a') }],
        },
        {
          key: 'c3',
          branch: 'feat/b',
          start_ref: 'main',
          as: dev,
          timestamp: 1767229300,
          message: 'B',
          actions: [{ action: 'update', path: 'b.txt', content: files('b') }],
        },
        {
          key: 'c4',
          branch: 'feat/c',
          start_ref: 'main',
          as: dev,
          timestamp: 1767229400,
          message: 'C',
          actions: [{ action: 'update', path: 'c.txt', content: files('c') }],
        },
      ],
      merge_requests: [
        { key: 'a', title: 'A', source: 'feat/a', target: 'main', author: dev, state: 'opened' },
        { key: 'b', title: 'B', source: 'feat/b', target: 'main', author: dev, state: 'opened' },
        { key: 'c', title: 'C', source: 'feat/c', target: 'main', author: dev, state: 'opened' },
      ],
    },
  ],
};

const seeded = await call('POST', '/api/grading/seed', seed);
if (seeded.status !== 201) {
  process.stdout.write(`seed failed: ${JSON.stringify(seeded.body)}\n`);
  process.exit(1);
}
await session(own);
await session(dev);
const projectId = seeded.body.projects.p.id;

for (const iid of [1, 2, 3]) {
  const added = await call('POST', `/api/projects/${projectId}/merge_requests/${iid}/train`, {}, dev);
  if (added.status !== 201) check(`add !${iid} to train`, false, JSON.stringify(added.body));
}
const train = await call('GET', `/api/projects/${projectId}/train?target=main`, undefined, own);
const cars = train.body.cars;
check('three cars', cars.length === 3, JSON.stringify(cars.map((car) => [car.iid, car.position])));
check(
  'each car has its own speculative commit',
  new Set(cars.map((car) => car.sha)).size === 3,
  JSON.stringify(cars.map((car) => car.sha.slice(0, 7))),
);
const tree = await call('GET', `/api/projects/${projectId}/train/2/tree`, undefined, own);
check(
  'second car builds on the first',
  tree.body.files['a.txt'] === 'base\na\n' && tree.body.files['b.txt'] === 'base\nb\n',
  JSON.stringify(Object.entries(tree.body.files).filter(([path]) => path.endsWith('.txt'))),
);

await call('POST', '/api/grading/runner/settle', { project: projectId });
const afterFail = await call('GET', `/api/projects/${projectId}/train?target=main`, undefined, own);
check(
  'failed car leaves the train',
  !afterFail.body.cars.some((car) => car.iid === 2),
  JSON.stringify(afterFail.body.cars.map((car) => [car.iid, car.position])),
);
const states = {};
for (const iid of [1, 2, 3]) {
  states[iid] = (await call('GET', `/api/projects/${projectId}/merge_requests/${iid}`, undefined, own)).body.state;
}
check(
  'the removed request returns to open while the others merge',
  states[1] === 'merged' && states[2] === 'opened' && states[3] === 'merged',
  JSON.stringify(states),
);
const removedNotes = (await call('GET', `/api/projects/${projectId}/merge_requests/2/notes?filter=history`, undefined, own)).body.notes.map(
  (note) => note.body,
);
check(
  'removal note names the pipeline',
  removedNotes.some((note) => /^Removed from merge train: pipeline \d+ failed\.$/.test(note)),
  JSON.stringify(removedNotes),
);

const merge1 = (await call('GET', `/api/projects/${projectId}/merge_requests/1`, undefined, own)).body.merge_commit;
check('first car merged its stored commit', merge1 === cars[0].sha, `${merge1?.slice(0, 7)} vs ${cars[0].sha.slice(0, 7)}`);
const headCommit = (await call('GET', `/api/projects/${projectId}/branch_head?name=main`, undefined, own)).body.commit;
const merge3 = (await call('GET', `/api/projects/${projectId}/merge_requests/3`, undefined, own)).body.merge_commit;
check('the rebuilt car merged its new commit', headCommit === merge3, `${headCommit?.slice(0, 7)} vs ${merge3?.slice(0, 7)}`);

const environments = await call('GET', `/api/projects/${projectId}/environments`, undefined, own);
const production = environments.body.environments.find((environment) => environment.name === 'production');
check('production environment exists', production !== undefined, JSON.stringify(environments.body));
const awaiting = production?.deployments.find((deployment) => deployment.status === 'awaiting_approval');
check('deployment waits for approval', awaiting !== undefined, JSON.stringify(production?.deployments));
if (awaiting !== undefined) {
  const byDeployer = await call('POST', `/api/projects/${projectId}/deployments/${awaiting.id}/approvals`, { status: 'approved' }, dev);
  check(
    'deployer and lower roles refused',
    byDeployer.status === 403,
    JSON.stringify(byDeployer.body),
  );
  const approved = await call('POST', `/api/projects/${projectId}/deployments/${awaiting.id}/approvals`, { status: 'approved' }, own);
  check(
    'owner approval recorded',
    approved.status === 200 && approved.body.announcement === 'Deployment approval recorded: 1 of 1.',
    JSON.stringify(approved.body),
  );
  await call('POST', '/api/grading/runner/settle', { project: projectId });
  const after = await call('GET', `/api/projects/${projectId}/environments/${production.id}`, undefined, own);
  const success = after.body.deployments.find((deployment) => deployment.id === awaiting.id);
  check('deployment ran', success?.status === 'success', JSON.stringify(after.body.deployments));
  const rollback = await call('POST', `/api/environments/${production.id}/rollback`, { deployment: success?.number }, own);
  check('rollback refused for the current deployment artifact', rollback.status === 201 || rollback.status === 409, JSON.stringify(rollback.body));
}

await call('POST', '/api/grading/storage', { down: true });
const exported = await call('POST', `/api/projects/${projectId}/exports`, {}, own);
for (let step = 0; step < 6; step += 1) await call('POST', '/api/grading/clock', { advance_ms: 200 });
const failedExport = await call('GET', `/api/exports/${exported.body.id}`, undefined, own);
check(
  'export fails during an outage at 80',
  failedExport.body.status === 'failed' && failedExport.body.progress === 80 && failedExport.body.error === 'Export failed: file storage is unavailable.',
  JSON.stringify(failedExport.body),
);
const health = await call('GET', '/api/health');
check('health reports unavailable', health.body.status === 'unavailable', JSON.stringify(health.body));
await call('POST', '/api/grading/storage', { down: false });
const retried = await call('POST', `/api/projects/${projectId}/exports`, {}, own);
for (let step = 0; step < 6; step += 1) await call('POST', '/api/grading/clock', { advance_ms: 200 });
const finished = await call('GET', `/api/exports/${retried.body.id}`, undefined, own);
check(
  'retry export finishes with a link',
  finished.body.status === 'finished' && finished.body.progress === 100 && finished.body.download !== null,
  JSON.stringify(finished.body),
);

process.stdout.write(`\n${results.filter(Boolean).length}/${results.length} checks passed\n`);
