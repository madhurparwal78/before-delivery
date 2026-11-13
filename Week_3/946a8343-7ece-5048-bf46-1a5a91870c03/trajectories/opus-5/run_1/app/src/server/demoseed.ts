import { loadProject } from './access';
import { nowMs } from './clock';
import { db } from './db';
import { quietTx } from './live';
import { seedInstance } from './seed';
import { jobsOfPipeline } from './pipeline';
import { putObject } from './storage';
import { StorageUnavailable } from './storage';

const pipelineConfig = `stages: [build, test, deploy]
build:
  stage: build
  script:
    - print Building tidepool
    - write dist/app.txt tidepool build
  artifacts:
    paths: [dist/app.txt]
test-unit:
  stage: test
  script:
    - print Running unit tests
deploy-production:
  stage: deploy
  script:
    - print Deploying tidepool
  environment:
    name: production
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
`;

const ownersFile = '[Backend]\n/src/ @rin\n[Docs]\n*.md @asha\n';

export const demoSeedBody = {
  users: [
    { username: 'asha', password: 'spurline-demo-1', time_zone: 'Europe/Lisbon' },
    { username: 'tomas', password: 'spurline-demo-1', time_zone: 'America/Bogota' },
    { username: 'rin', password: 'spurline-demo-1', time_zone: 'Asia/Tokyo' },
    { username: 'odile', password: 'spurline-demo-1', time_zone: 'UTC' },
  ],
  groups: [
    {
      key: 'coldbrook',
      path: 'coldbrook',
      visibility: 'private',
      members: [
        { username: 'asha', role: 'owner' },
        { username: 'tomas', role: 'developer' },
        { username: 'rin', role: 'developer' },
        { username: 'odile', role: 'reporter' },
      ],
    },
    {
      key: 'apps',
      path: 'coldbrook/apps',
      visibility: 'private',
      members: [{ username: 'rin', role: 'maintainer' }],
    },
  ],
  custom_roles: [
    {
      key: 'release-captain',
      group: 'coldbrook',
      name: 'release-captain',
      base: 'developer',
      permissions: ['approve', 'manage_environments'],
    },
  ],
  group_labels: [
    { group: 'coldbrook', name: 'priority::high', description: '' },
    { group: 'coldbrook', name: 'priority::low', description: '' },
    { group: 'coldbrook', name: 'workflow::doing', description: '' },
    { group: 'coldbrook', name: 'workflow::review', description: '' },
    { group: 'coldbrook', name: 'type::bug', description: '' },
  ],
  projects: [
    {
      key: 'tidepool',
      group: 'coldbrook/apps',
      slug: 'tidepool',
      visibility: 'private',
      default_branch: 'main',
      settings: {
        merge_method: 'merge_commit',
        merge_trains: true,
        pipelines_must_succeed: true,
        reset_approvals_on_push: true,
        author_can_approve: false,
        auto_resolve_outdated: false,
      },
      protected_branches: [{ name: 'main', allowed_to_push: 'maintainer', allowed_to_merge: 'developer' }],
      protected_tags: [{ name: 'v*', allowed_to_create: 'maintainer' }],
      push_rules: { branch_name: null, commit_message: null, forbidden_files: [], required_files: [], secrets: true },
      approval_rules: [{ name: 'Backend', required: 1, users: ['rin', 'asha'], groups: [] }],
      protected_environments: [{ name: 'production', roles: 'maintainer', approvals: 1 }],
      commits: [
        {
          key: 'c1',
          branch: 'main',
          start_ref: null,
          as: 'asha',
          timestamp: 1767225600,
          message: 'First commit',
          actions: [{ action: 'create', path: 'README.md', content: 'hello\n' }],
        },
        {
          key: 'c2',
          branch: 'main',
          as: 'asha',
          timestamp: 1767229200,
          message: 'Add pipeline and owners',
          actions: [
            { action: 'create', path: 'src/app.ts', content: 'export const name = "tidepool";\n' },
            { action: 'create', path: '.spurline/OWNERS', content: ownersFile },
            { action: 'create', path: 'spurline.pipeline.yml', content: pipelineConfig },
          ],
        },
        {
          key: 'c3',
          branch: 'feat/export',
          start_ref: 'main',
          as: 'tomas',
          timestamp: 1767232800,
          message: 'Add export button',
          actions: [
            {
              action: 'update',
              path: 'src/app.ts',
              content: 'export const name = "tidepool";\nexport const canExport = true;\n',
            },
          ],
        },
      ],
      tags: [{ name: 'v0.1.0', commit: 'c2', message: 'First tagged build.', as: 'asha' }],
      labels: [],
      milestones: [{ key: 'sprint1', title: 'Sprint 1', start: '2026-01-05', due: '2026-01-16', time_zone: 'UTC' }],
      issues: [
        {
          key: 'i1',
          title: 'Export fails on large projects',
          author: 'odile',
          description: '',
          labels: ['priority::high', 'workflow::doing'],
          assignees: [],
          milestone: 'sprint1',
          weight: 3,
          confidential: false,
          state: 'opened',
        },
        {
          key: 'i2',
          title: 'Tidy the README',
          author: 'asha',
          description: '',
          labels: ['workflow::review'],
          assignees: [],
          milestone: null,
          weight: 1,
          confidential: false,
          state: 'opened',
        },
      ],
      merge_requests: [
        {
          key: 'mr1',
          title: 'Add export button',
          source: 'feat/export',
          target: 'main',
          author: 'tomas',
          description: 'Closes #1',
          assignees: [],
          reviewers: ['rin'],
          delete_source_branch: true,
          state: 'opened',
          approvals: [],
          threads: [],
        },
      ],
      pipelines: [
        { key: 'pl1', ref: 'main', commit: 'c2', jobs: { build: 'success', 'test-unit': 'success', 'deploy-production': 'success' } },
      ],
      boards: [{ key: 'development', name: 'Development', kind: 'label', lists: ['workflow::doing', 'workflow::review'] }],
      wiki: [{ slug: 'home', title: 'Home', content: '# Tidepool\n\nShared notes.', author: 'asha' }],
      webhooks: [],
    },
  ],
};

export async function seedDemoInstance(): Promise<void> {
  const existing = await db.one<{ count: string }>('select count(*)::text as count from users', []);
  if (Number(existing?.count ?? '0') > 0) return;
  const result = await quietTx(async (t) => seedInstance(t, demoSeedBody));
  const projects = result.projects as Record<string, { id: number; pipelines: Record<string, { id: number; jobs: Record<string, number> }> }>;
  const project = projects.tidepool;
  if (project === undefined) return;
  await quietTx(async (t) => {
    const loaded = await loadProject(t.sql, project.id);
    if (loaded === null) return;
    const pipeline = project.pipelines.pl1;
    if (pipeline === undefined) return;
    const jobs = await jobsOfPipeline(t.sql, pipeline.id);
    const build = jobs.find((job) => job.name === 'build');
    const deploy = jobs.find((job) => job.name === 'deploy-production');
    const keys: string[] = [];
    if (build !== undefined) {
      const key = `artifacts/${build.id}/dist/app.txt`;
      try {
        await putObject(key, 'tidepool build\n');
        await t.sql.query(
          'insert into artifacts (job_id, path, size, expires_ms, object_key) values ($1, $2, $3, null, $4)',
          [build.id, 'dist/app.txt', 'tidepool build\n'.length, key],
        );
        keys.push(key);
      } catch (error) {
        if (!(error instanceof StorageUnavailable)) throw error;
      }
    }
    const environment = await t.sql.one<{ id: string }>(
      "insert into environments (project_id, name, tier, state) values ($1, 'production', 'production', 'available') on conflict (project_id, name) do update set tier = 'production' returning id",
      [loaded.id],
    );
    if (environment === null) return;
    await t.sql.query(
      `insert into deployments (environment_id, number, status, sha, pipeline_id, job_id, deployer, required,
                               artifact_keys, created_ms, finished_ms)
       values ($1, 1, 'success', (select sha from pipelines where id = $2), $2, $3, 'asha', 0, $4, $5, $5)
       on conflict (environment_id, number) do nothing`,
      [Number(environment.id), pipeline.id, deploy?.id ?? null, JSON.stringify(keys), nowMs()],
    );
  });
}
