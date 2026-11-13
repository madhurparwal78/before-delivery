import type { Ctx } from '../api/ctx.js';
import { hashPassword } from '../services/passwords.js';
import { applyCommit } from '../domain/repo-service.js';
import { createPipeline } from '../domain/pipeline-service.js';
import { runDemoScheduler } from './demo-runner.js';

const PIPELINE_YML = `stages: [build, test, deploy]
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

const OWNERS = `[Backend]
/src/ @rin
[Docs]
*.md @asha
`;

export async function seedDemo(ctx: Ctx): Promise<void> {
  const client = await ctx.db.pool.connect();
  const now = ctx.now();
  const password = hashPassword('spurline-demo-1');
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO users (username, password_hash, time_zone, created_at, is_system) VALUES ('spurline-train', '-', 'UTC', $1, true) ON CONFLICT (username) DO NOTHING`, [now]);
    const users: Array<[string, string]> = [
      ['asha', 'Europe/Lisbon'],
      ['tomas', 'America/Bogota'],
      ['rin', 'Asia/Tokyo'],
      ['odile', 'UTC'],
    ];
    const ids = new Map<string, number>();
    for (const [username, zone] of users) {
      const r = await client.query<{ id: number }>(`INSERT INTO users (username, password_hash, time_zone, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO UPDATE SET time_zone = EXCLUDED.time_zone RETURNING id`, [username, password, zone, now]);
      ids.set(username, r.rows[0].id);
    }
    const g = await client.query<{ id: number }>(`INSERT INTO groups (name, path, parent_id, visibility, created_at) VALUES ('coldbrook', 'coldbrook', NULL, 'private', $1) ON CONFLICT (path) DO UPDATE SET visibility = EXCLUDED.visibility RETURNING id`, [now]);
    const coldbrook = g.rows[0].id;
    const apps = await client.query<{ id: number }>(`INSERT INTO groups (name, path, parent_id, visibility, created_at) VALUES ('apps', 'coldbrook/apps', $1, 'private', $2) ON CONFLICT (path) DO UPDATE SET visibility = EXCLUDED.visibility RETURNING id`, [coldbrook, now]);
    const appsId = apps.rows[0].id;
    const members: Array<[number, number, string]> = [
      [coldbrook, ids.get('asha')!, 'owner'],
      [coldbrook, ids.get('tomas')!, 'developer'],
      [coldbrook, ids.get('rin')!, 'developer'],
      [coldbrook, ids.get('odile')!, 'reporter'],
      [appsId, ids.get('rin')!, 'maintainer'],
    ];
    for (const [gid, uid, role] of members) {
      await client.query(`INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (group_id, user_id) DO UPDATE SET role = $3`, [gid, uid, role]);
    }
    const cr = await client.query<{ id: number }>(`INSERT INTO custom_roles (group_id, name, base, permissions, created_at) VALUES ($1, 'release-captain', 'developer', $2, $3) ON CONFLICT (group_id, name) DO UPDATE SET permissions = EXCLUDED.permissions RETURNING id`,
      [coldbrook, ['approve', 'manage_environments'], now]);
    await client.query(`INSERT INTO group_members (group_id, user_id, role, custom_role_id) VALUES ($1, $2, NULL, $3) ON CONFLICT (group_id, user_id) DO UPDATE SET custom_role_id = $3, role = NULL`, [coldbrook, ids.get('tomas')!, cr.rows[0].id]);
    for (const name of ['priority::high', 'priority::low', 'workflow::doing', 'workflow::review', 'type::bug']) {
      await client.query(`INSERT INTO labels (group_id, name, description, created_at) VALUES ($1, $2, '', $3) ON CONFLICT (group_id, project_id, name) DO UPDATE SET description = ''`, [coldbrook, name, now]);
    }
    const proj = await client.query<{ id: number }>(`INSERT INTO projects (group_id, slug, path, visibility, default_branch, merge_method, merge_trains, pipelines_must_succeed, reset_approvals_on_push, author_can_approve, auto_resolve_outdated, created_at)
      VALUES ($1, 'tidepool', 'coldbrook/apps/tidepool', 'private', 'main', 'merge_commit', true, true, true, false, false, $2) ON CONFLICT (path) DO UPDATE SET merge_trains = true, pipelines_must_succeed = true RETURNING id`, [appsId, now]);
    const projectId = proj.rows[0].id;
    await client.query(`INSERT INTO mr_iids (project_id, kind, next_iid) VALUES ($1, 'issue', 1), ($1, 'request', 1) ON CONFLICT DO NOTHING`, [projectId]);
    await client.query(`INSERT INTO protected_branches (project_id, pattern, allowed_to_push, allowed_to_merge) VALUES ($1, 'main', 'maintainer', 'developer') ON CONFLICT DO NOTHING`, [projectId]);
    await client.query(`INSERT INTO protected_tags (project_id, pattern, allowed_to_create) VALUES ($1, 'v*', 'maintainer') ON CONFLICT DO NOTHING`, [projectId]);
    await client.query(`INSERT INTO push_rules (project_id, branch_name, commit_message, forbidden_files, required_files, secrets) VALUES ($1, NULL, NULL, '{}', '{}', true) ON CONFLICT (project_id) DO UPDATE SET secrets = true`, [projectId]);
    await client.query(`INSERT INTO approval_rules (project_id, name, required_count, users, groups, created_at) VALUES ($1, 'Backend', 1, $2, '{}', $3)`, [projectId, ['rin', 'asha'], now]);
    await client.query(`INSERT INTO protected_environments (project_id, name, roles, approvals) VALUES ($1, 'production', 'maintainer', 1) ON CONFLICT (project_id, name) DO UPDATE SET roles = 'maintainer', approvals = 1`, [projectId]);
    const c1 = await applyCommit(ctx, client, projectId, {
      branch: 'main',
      start_ref: null,
      base_commit: null,
      message: 'First commit',
      actions: [{ action: 'create', path: 'README.md', content: 'hello\n' }],
      author: 'asha',
      authorTime: 1767225600,
      commitTime: 1767225600,
    }, { bypassProtection: true, bypassPushRules: true });
    const c2 = await applyCommit(ctx, client, projectId, {
      branch: 'main',
      start_ref: null,
      base_commit: c1.id,
      message: 'Add pipeline and owners',
      actions: [
        { action: 'create', path: 'src/app.ts', content: 'export const name = "tidepool";\n' },
        { action: 'create', path: '.spurline/OWNERS', content: OWNERS },
        { action: 'create', path: 'spurline.pipeline.yml', content: PIPELINE_YML },
      ],
      author: 'asha',
      authorTime: 1767229200,
      commitTime: 1767229200,
    }, { bypassProtection: true, bypassPushRules: true });
    const c3 = await applyCommit(ctx, client, projectId, {
      branch: 'feat/export',
      start_ref: 'main',
      base_commit: c2.id,
      message: 'Add export button',
      actions: [{ action: 'update', path: 'src/app.ts', content: 'export const name = "tidepool";\nexport const canExport = true;\n' }],
      author: 'tomas',
      authorTime: 1767232800,
      commitTime: 1767232800,
    }, { bypassProtection: true, bypassPushRules: true });
    await client.query(`INSERT INTO refs (project_id, kind, name, commit_id) VALUES ($1, 'tag', 'v0.1.0', $2) ON CONFLICT (project_id, kind, name) DO UPDATE SET commit_id = $2`, [projectId, c2.id]);
    await client.query(`INSERT INTO tags_meta (project_id, name, message) VALUES ($1, 'v0.1.0', 'First tagged build.') ON CONFLICT (project_id, name) DO UPDATE SET message = 'First tagged build.'`, [projectId]);
    const pl = await createPipeline(ctx, client, {
      projectId, projectPath: 'coldbrook/apps/tidepool', ref: 'main', sha: c2.id, source: 'push', defaultBranch: 'main',
    });
    if (pl.id !== null) {
      await runDemoScheduler(ctx, client, projectId, pl.id);
    }
    const { mergeBase } = await import('../domain/repo.js');
    const base = await mergeBase(client, c3.id, c2.id);
    const mr = await client.query<{ id: number; iid: number }>(`INSERT INTO merge_requests (project_id, iid, title, description, state, draft, author_id, source, target, assignees, reviewers, delete_source_branch, created_at, updated_at)
      VALUES ($1, 1, 'Add export button', 'Closes #1', 'opened', false, $2, 'feat/export', 'main', '{}', $3, true, $4, $4) RETURNING id, iid`,
      [projectId, ids.get('tomas')!, ['rin'], now]);
    await client.query(`INSERT INTO mr_versions (mr_id, number, head, base, start_commit, created_at) VALUES ($1, 1, $2, $3, $4, $5)`, [mr.rows[0].id, c3.id, base ?? c2.id, c2.id, now]);
    const labelHigh = (await client.query<{ id: number }>(`SELECT id FROM labels WHERE name = 'priority::high' AND group_id = $1`, [coldbrook])).rows[0];
    const labelDoing = (await client.query<{ id: number }>(`SELECT id FROM labels WHERE name = 'workflow::doing' AND group_id = $1`, [coldbrook])).rows[0];
    const labelReview = (await client.query<{ id: number }>(`SELECT id FROM labels WHERE name = 'workflow::review' AND group_id = $1`, [coldbrook])).rows[0];
    const milestone = await client.query<{ id: number }>(`INSERT INTO milestones (project_id, title, start_date, due_date, time_zone, state, created_at) VALUES ($1, 'Sprint 1', '2026-01-05', '2026-01-16', 'UTC', 'active', $2) RETURNING id`, [projectId, now]);
    const issue1 = await client.query<{ id: number }>(`INSERT INTO issues (project_id, iid, title, description, state, author_id, confidential, weight, created_at, updated_at) VALUES ($1, 1, 'Export fails on large projects', '', 'opened', $2, false, 3, $3, $3) RETURNING id`,
      [projectId, ids.get('odile')!, now]);
    for (const lid of [labelHigh?.id, labelDoing?.id]) {
      if (lid) await client.query(`INSERT INTO issue_labels (issue_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [issue1.rows[0].id, lid]);
    }
    await client.query(`INSERT INTO issue_milestones (issue_id, milestone_id) VALUES ($1, $2)`, [issue1.rows[0].id, milestone.rows[0].id]);
    const issue2 = await client.query<{ id: number }>(`INSERT INTO issues (project_id, iid, title, description, state, author_id, confidential, weight, created_at, updated_at) VALUES ($1, 2, 'Tidy the README', '', 'opened', $2, false, 1, $3, $3) RETURNING id`,
      [projectId, ids.get('asha')!, now]);
    if (labelReview) {
      await client.query(`INSERT INTO issue_labels (issue_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [issue2.rows[0].id, labelReview.id]);
    }
    const board = await client.query<{ id: number }>(`INSERT INTO boards (project_id, name, kind, created_at) VALUES ($1, 'Development', 'label', $2) RETURNING id`, [projectId, now]);
    await client.query(`INSERT INTO board_lists (board_id, title, position, kind) VALUES ($1, 'Open', 1, 'open')`, [board.rows[0].id]);
    await client.query(`INSERT INTO board_lists (board_id, title, position, kind) VALUES ($1, 'Closed', 2, 'closed')`, [board.rows[0].id]);
    await client.query(`INSERT INTO board_lists (board_id, title, position, kind, label_id) VALUES ($1, 'workflow::doing', 3, 'label', $2)`, [board.rows[0].id, labelDoing?.id ?? null]);
    await client.query(`INSERT INTO board_lists (board_id, title, position, kind, label_id) VALUES ($1, 'workflow::review', 4, 'label', $2)`, [board.rows[0].id, labelReview?.id ?? null]);
    const page = await client.query<{ id: number }>(`INSERT INTO wiki_pages (project_id, slug) VALUES ($1, 'home') ON CONFLICT (project_id, slug) DO UPDATE SET slug = 'home' RETURNING id`, [projectId]);
    await client.query(`INSERT INTO wiki_versions (page_id, version, title, content, author, created_at) VALUES ($1, 1, 'Home', '# Tidepool\n\nShared notes.', 'asha', $2)`, [page.rows[0].id, now]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
