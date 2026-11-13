import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { newSessionToken, hashPassword } from '../services/passwords.js';
import { storeBlob, storeTree, storeCommit, blobId, splitLines } from '../domain/repo.js';
import { buildTreeFromFiles } from '../domain/repo.js';
import { applyCommit } from '../domain/repo-service.js';
import { Scheduler } from '../domain/scheduler.js';
import { addToTrain, rebuildCarsFrom } from '../domain/train.js';
import { createPipeline } from '../domain/pipeline-service.js';
import { carsFor } from '../domain/train.js';

interface SeedInput {
  users?: Array<{ username: string; password: string; time_zone?: string }>;
  custom_roles?: Array<{ key: string; group: string; name: string; base: string; permissions?: string[] }>;
  group_labels?: Array<{ group: string; name: string; description?: string }>;
  epics?: Array<{ key: string; group: string; title: string; parent?: string | null; author: string; issues?: string[] }>;
  projects?: SeedProject[];
  groups?: Array<{ key: string; path: string; visibility?: string; members?: Array<{ username: string; role?: string; custom_role?: string }> }>;
}

interface SeedProject {
  key: string;
  group: string;
  slug: string;
  visibility?: string;
  default_branch?: string;
  members?: Array<{ username: string; role?: string; custom_role?: string }>;
  settings?: Record<string, unknown>;
  protected_branches?: Array<{ name: string; allowed_to_push?: string; allowed_to_merge?: string }>;
  protected_tags?: Array<{ name: string; allowed_to_create?: string }>;
  push_rules?: Record<string, unknown>;
  approval_rules?: Array<{ name: string; required?: number; users?: string[]; groups?: string[] }>;
  protected_environments?: Array<{ name: string; roles?: string; approvals?: number }>;
  variables?: Record<string, string>;
  commits?: Array<{ key: string; branch: string; start_ref?: string | null; as: string; timestamp?: number; message: string; actions: Array<Record<string, unknown>> }>;
  tags?: Array<{ name: string; commit: string; message?: string; as?: string }>;
  labels?: Array<{ name: string; description?: string }>;
  milestones?: Array<{ key: string; title: string; start?: string; due?: string; time_zone?: string }>;
  issues?: Array<Record<string, unknown>>;
  merge_requests?: Array<Record<string, unknown>>;
  pipelines?: Array<{ key: string; ref: string; commit: string; jobs?: Record<string, string> }>;
  train?: Array<{ target: string; requests: string[] }>;
  boards?: Array<{ key: string; name: string; kind?: string; lists?: string[] }>;
  wiki?: Array<{ slug: string; title: string; content: string; author: string }>;
  webhooks?: Array<{ key: string; url: string; secret: string; events?: string[] }>;
}

export async function seed(rc: RequestCtx): Promise<unknown> {
  const input = requireBody(rc) as unknown as SeedInput;
  const client = await rc.ctx.db.pool.connect();
  const now = rc.ctx.now();
  const out: Record<string, unknown> = { users: {}, groups: {}, custom_roles: {}, epics: {}, projects: {} };
  try {
    await client.query('BEGIN');
    // users
    for (const u of input.users ?? []) {
      if (!/^[a-z0-9_]{3,24}$/.test(u.username)) {
        throw errs.validationMsg(`Username ${u.username} must be 3 to 24 characters: a-z, 0-9 and _.`, 'username');
      }
      const r = await client.query<{ id: number }>(`INSERT INTO users (username, password_hash, time_zone, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO UPDATE SET time_zone = EXCLUDED.time_zone RETURNING id`,
        [u.username, hashPassword(u.password), u.time_zone ?? 'UTC', now]);
      (out.users as Record<string, unknown>)[u.username] = { id: r.rows[0].id };
    }
    // ensure system user
    await client.query(`INSERT INTO users (username, password_hash, time_zone, created_at, is_system) VALUES ('spurline-train', '-', 'UTC', $1, true) ON CONFLICT (username) DO NOTHING`, [now]);
    // groups
    const groupIds = new Map<string, number>();
    for (const g of input.groups ?? []) {
      const segs = g.path.split('/');
      if (segs.length > 4) throw errs.validationMsg('Groups can only nest 4 levels.', 'path');
      // intermediate parents are created as needed, earlier in the path
      for (let depth = 1; depth < segs.length; depth++) {
        const parentPath = segs.slice(0, depth).join('/');
        if (groupIds.has(parentPath)) continue;
        const parentOfParent = depth > 1 ? groupIds.get(segs.slice(0, depth - 1).join('/'))! : null;
        const r0 = await client.query<{ id: number }>(
          `INSERT INTO groups (name, path, parent_id, visibility, created_at) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (path) DO UPDATE SET visibility = EXCLUDED.visibility RETURNING id`,
          [segs[depth - 1], parentPath, parentOfParent, g.visibility ?? 'private', now]);
        groupIds.set(parentPath, r0.rows[0].id);
      }
      let parentId: number | null = null;
      if (segs.length > 1) {
        const parentPath = segs.slice(0, -1).join('/');
        parentId = groupIds.get(parentPath) ?? null;
      }
      const name = segs[segs.length - 1];
      const r = await client.query<{ id: number; path: string }>(
        `INSERT INTO groups (name, path, parent_id, visibility, created_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (path) DO UPDATE SET visibility = EXCLUDED.visibility RETURNING id, path`,
        [name, g.path, parentId, g.visibility ?? 'private', now]);
      groupIds.set(g.path, r.rows[0].id);
      (out.groups as Record<string, unknown>)[g.key] = { id: r.rows[0].id, path: g.path };
      for (const m of g.members ?? []) {
        const uid = (await client.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [m.username])).rows[0]?.id;
        if (!uid) continue;
        if (m.custom_role) {
          const crId = (await client.query<{ id: number }>(`SELECT cr.id FROM custom_roles cr JOIN groups g2 ON g2.id = cr.group_id WHERE cr.name = $1 AND (g2.path = $2 OR g2.path = $3) LIMIT 1`, [m.custom_role, g.path, g.path.split('/')[0]])).rows[0]?.id;
          if (crId) {
            await client.query(`INSERT INTO group_members (group_id, user_id, role, custom_role_id) VALUES ($1, $2, NULL, $3) ON CONFLICT (group_id, user_id) DO UPDATE SET role = NULL, custom_role_id = $3`, [r.rows[0].id, uid, crId]);
          }
        } else {
          await client.query(`INSERT INTO group_members (group_id, user_id, role, custom_role_id) VALUES ($1, $2, $3, NULL) ON CONFLICT (group_id, user_id) DO UPDATE SET role = $3`, [r.rows[0].id, uid, m.role ?? 'developer']);
        }
      }
    }
    const groupPathToId = new Map<string, number>();
    for (const g of (await client.query<{ id: number; path: string }>(`SELECT id, path FROM groups`)).rows) {
      groupPathToId.set(g.path, g.id);
    }
    // custom roles
    for (const cr of input.custom_roles ?? []) {
      const gid = groupPathToId.get(cr.group.split('/')[0]);
      const groupFor = findGroupId(groupPathToId, cr.group);
      void gid;
      if (groupFor === null) throw errs.validationMsg(`Group ${cr.group} doesn't exist.`, 'group');
      const r = await client.query<{ id: number }>(`INSERT INTO custom_roles (group_id, name, base, permissions, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (group_id, name) DO UPDATE SET base = EXCLUDED.base, permissions = EXCLUDED.permissions RETURNING id`,
        [groupFor, cr.name, cr.base, cr.permissions ?? [], now]);
      (out.custom_roles as Record<string, unknown>)[cr.key] = { id: r.rows[0].id };
    }
    const roleKeyToId = new Map<string, number>();
    for (const cr of (await client.query<{ id: number; group_id: number; name: string }>(`SELECT id, group_id, name FROM custom_roles`)).rows) {
      roleKeyToId.set(`${cr.group_id}:${cr.name}`, cr.id);
    }
    // group labels
    for (const gl of input.group_labels ?? []) {
      const gid = findGroupId(groupPathToId, gl.group);
      if (gid === null) continue;
      await client.query(`INSERT INTO labels (group_id, name, description, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (group_id, project_id, name) DO UPDATE SET description = EXCLUDED.description`,
        [gid, gl.name, gl.description ?? '', now]);
    }
    // epics need groups first; store issue refs for later
    const epicSpecs = input.epics ?? [];
    // projects
    const projectOut: Record<string, unknown> = {};
    const mrKeyToId = new Map<string, { id: number; iid: number }>();
    const issueKeyToId = new Map<string, { id: number; iid: number; projectKey: string }>();
    const commitKeyToId = new Map<string, string>();
    const milestoneKeyToId = new Map<string, number>();
    const labelKeyIds = new Map<string, number>();
    for (const p of input.projects ?? []) {
      const gid = findGroupId(groupPathToId, p.group);
      if (gid === null) throw errs.validationMsg(`Group ${p.group} doesn't exist.`, 'group');
      const path = `${p.group}/${p.slug}`;
      const existingProject = (await client.query<{ id: number }>(`SELECT id FROM projects WHERE path = $1`, [path])).rows[0];
      if (existingProject) {
        await client.query(`DELETE FROM projects WHERE id = $1`, [existingProject.id]);
      }
      const projR = await client.query<{ id: number }>(
        `INSERT INTO projects (group_id, slug, path, visibility, default_branch, merge_method, merge_trains, pipelines_must_succeed, reset_approvals_on_push, author_can_approve, auto_resolve_outdated, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (path) DO UPDATE SET default_branch = EXCLUDED.default_branch, merge_method = EXCLUDED.merge_method, merge_trains = EXCLUDED.merge_trains, pipelines_must_succeed = EXCLUDED.pipelines_must_succeed, reset_approvals_on_push = EXCLUDED.reset_approvals_on_push, author_can_approve = EXCLUDED.author_can_approve, auto_resolve_outdated = EXCLUDED.auto_resolve_outdated RETURNING id`,
        [
          gid, p.slug, path, p.visibility ?? 'private', p.default_branch ?? 'main',
          str(p.settings?.merge_method, 'merge_commit'), Boolean(p.settings?.merge_trains), Boolean(p.settings?.pipelines_must_succeed),
          p.settings?.reset_approvals_on_push === undefined ? true : Boolean(p.settings?.reset_approvals_on_push),
          Boolean(p.settings?.author_can_approve), Boolean(p.settings?.auto_resolve_outdated), now,
        ]);
      const projectId = projR.rows[0].id;
      await client.query(`INSERT INTO mr_iids (project_id, kind, next_iid) VALUES ($1, 'issue', 1), ($1, 'request', 1) ON CONFLICT DO NOTHING`, [projectId]);
      // members
      for (const m of p.members ?? []) {
        const uid = (await client.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [m.username])).rows[0]?.id;
        if (!uid) continue;
        if (m.custom_role) {
          const gids = await ancestorGroupIds(client, gid);
          const crId = (await client.query<{ id: number }>(`SELECT cr.id FROM custom_roles cr WHERE cr.name = $1 AND cr.group_id = ANY($2::bigint[]) LIMIT 1`, [m.custom_role, gids])).rows[0]?.id;
          if (crId) {
            await client.query(`INSERT INTO project_members (project_id, user_id, role, custom_role_id) VALUES ($1, $2, NULL, $3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = NULL, custom_role_id = $3`, [projectId, uid, crId]);
          }
        } else {
          await client.query(`INSERT INTO project_members (project_id, user_id, role, custom_role_id) VALUES ($1, $2, $3, NULL) ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3`, [projectId, uid, m.role ?? 'developer']);
        }
      }
      // protection
      for (const pb of p.protected_branches ?? []) {
        await client.query(`INSERT INTO protected_branches (project_id, pattern, allowed_to_push, allowed_to_merge) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, pattern) DO UPDATE SET allowed_to_push = $3, allowed_to_merge = $4`,
          [projectId, pb.name, pb.allowed_to_push ?? 'maintainer', pb.allowed_to_merge ?? 'developer']);
      }
      for (const pt of p.protected_tags ?? []) {
        await client.query(`INSERT INTO protected_tags (project_id, pattern, allowed_to_create) VALUES ($1, $2, $3) ON CONFLICT (project_id, pattern) DO UPDATE SET allowed_to_create = $3`,
          [projectId, pt.name, pt.allowed_to_create ?? 'maintainer']);
      }
      const pr = p.push_rules ?? {};
      await client.query(`INSERT INTO push_rules (project_id, branch_name, commit_message, forbidden_files, required_files, secrets) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (project_id) DO UPDATE SET branch_name = $2, commit_message = $3, forbidden_files = $4, required_files = $5, secrets = $6`,
        [projectId, (pr.branch_name as string) ?? null, (pr.commit_message as string) ?? null, (pr.forbidden_files as string[]) ?? [], (pr.required_files as string[]) ?? [], Boolean(pr.secrets)]);
      for (const ar of p.approval_rules ?? []) {
        await client.query(`INSERT INTO approval_rules (project_id, name, required_count, users, groups, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [projectId, ar.name, ar.required ?? 1, ar.users ?? [], ar.groups ?? [], now]);
      }
      for (const pe of p.protected_environments ?? []) {
        await client.query(`INSERT INTO protected_environments (project_id, name, roles, approvals) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, name) DO UPDATE SET roles = $3, approvals = $4`,
          [projectId, pe.name, pe.roles ?? 'maintainer', pe.approvals ?? 0]);
      }
      for (const [key, value] of Object.entries(p.variables ?? {})) {
        await client.query(`INSERT INTO variables (project_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (project_id, key) DO UPDATE SET value = $3`, [projectId, key, value]);
      }
      // commits
      const projOut: Record<string, unknown> = { id: projectId, path, commits: {}, merge_requests: {}, threads: {}, issues: {}, milestones: {}, labels: {}, pipelines: {}, train: {}, boards: {}, environments: {}, wiki: {}, webhooks: {} };
      for (const cm of p.commits ?? []) {
        let baseForCommit: string | null = null;
        if (cm.start_ref) {
          baseForCommit = (await client.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, cm.start_ref])).rows[0]?.commit_id ?? null;
        } else {
          baseForCommit = (await client.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, cm.branch])).rows[0]?.commit_id ?? null;
        }
        const result = await applyCommit(rc.ctx, client, projectId, {
          branch: cm.branch,
          start_ref: cm.start_ref ?? null,
          base_commit: baseForCommit,
          message: cm.message,
          actions: cm.actions.map((a) => ({
            action: String((a as Record<string, unknown>).action) as 'create' | 'update' | 'delete' | 'move',
            path: String((a as Record<string, unknown>).path ?? ''),
            content: (a as Record<string, unknown>).content === undefined ? undefined : String((a as Record<string, unknown>).content),
            previous_path: (a as Record<string, unknown>).previous_path === undefined ? undefined : String((a as Record<string, unknown>).previous_path),
          })),
          author: cm.as,
          authorTime: cm.timestamp,
          commitTime: cm.timestamp,
        }, { bypassProtection: true, bypassPushRules: true });
        commitKeyToId.set(`${p.key}/${cm.key}`, result.id);
        (projOut.commits as Record<string, unknown>)[cm.key] = result.id;
      }
      // tags
      for (const tag of p.tags ?? []) {
        const commitId = commitKeyToId.get(`${p.key}/${tag.commit}`);
        if (!commitId) continue;
        await client.query(`INSERT INTO refs (project_id, kind, name, commit_id) VALUES ($1, 'tag', $2, $3) ON CONFLICT (project_id, kind, name) DO UPDATE SET commit_id = $3`, [projectId, tag.name, commitId]);
        await client.query(`INSERT INTO tags_meta (project_id, name, message) VALUES ($1, $2, $3) ON CONFLICT (project_id, name) DO UPDATE SET message = $3`, [projectId, tag.name, tag.message ?? '']);
      }
      // labels
      for (const label of p.labels ?? []) {
        const r = await client.query<{ id: number }>(`INSERT INTO labels (project_id, name, description, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (group_id, project_id, name) DO UPDATE SET description = EXCLUDED.description RETURNING id`,
          [projectId, label.name, label.description ?? '', now]);
        labelKeyIds.set(label.name, r.rows[0].id);
        (projOut.labels as Record<string, unknown>)[label.name] = { id: r.rows[0].id };
      }
      // milestones
      for (const ms of p.milestones ?? []) {
        const r = await client.query<{ id: number }>(`INSERT INTO milestones (project_id, title, start_date, due_date, time_zone, state, created_at) VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING id`,
          [projectId, ms.title, ms.start ?? null, ms.due ?? null, ms.time_zone ?? 'UTC', now]);
        milestoneKeyToId.set(`${p.key}/${ms.key}`, r.rows[0].id);
        (projOut.milestones as Record<string, unknown>)[ms.key] = { id: r.rows[0].id };
      }
      // issues
      for (const iss of p.issues ?? []) {
        const i = iss as Record<string, unknown>;
        const author = (await client.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [String(i.author)])).rows[0];
        if (!author) continue;
        const nextIid = await nextIidFor(client, projectId, 'issue');
        const r = await client.query<{ id: number }>(`INSERT INTO issues (project_id, iid, title, description, state, author_id, confidential, weight, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
          [projectId, nextIid, String(i.title ?? ''), String(i.description ?? ''), String(i.state ?? 'opened'), author.id, Boolean(i.confidential), typeof i.weight === 'number' ? i.weight : null, now]);
        const issueKey = String(i.key ?? `i${nextIid}`);
        issueKeyToId.set(`${p.key}/${issueKey}`, { id: r.rows[0].id, iid: nextIid, projectKey: p.key });
        (projOut.issues as Record<string, unknown>)[issueKey] = { id: r.rows[0].id, iid: nextIid };
        for (const ln of (i.labels as string[] | undefined) ?? []) {
          const labelId = await resolveLabelId(client, projectId, ln);
          if (labelId) {
            await client.query(`INSERT INTO issue_labels (issue_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [r.rows[0].id, labelId]);
          }
        }
        if (i.milestone) {
          const msId = milestoneKeyToId.get(String(i.milestone).includes('/') ? String(i.milestone) : `${p.key}/${i.milestone}`) ?? await milestoneByTitle(client, projectId, String(i.milestone));
          if (msId) {
            await client.query(`INSERT INTO issue_milestones (issue_id, milestone_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [r.rows[0].id, msId]);
          }
        }
      }
      // merge requests
      for (const mr of p.merge_requests ?? []) {
        const m = mr as Record<string, unknown>;
        const author = (await client.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [String(m.author)])).rows[0];
        if (!author) continue;
        const sourceHead = (await client.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, String(m.source)])).rows[0]?.commit_id;
        const targetHead = (await client.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, String(m.target)])).rows[0]?.commit_id;
        if (!sourceHead || !targetHead) continue;
        const nextIid = await nextIidFor(client, projectId, 'request');
        const title = String(m.title ?? '');
        const r = await client.query<{ id: number }>(`INSERT INTO merge_requests (project_id, iid, title, description, state, draft, author_id, source, target, assignees, reviewers, delete_source_branch, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING id`,
          [projectId, nextIid, title, String(m.description ?? ''), String(m.state ?? 'opened'), title.startsWith('Draft: '), author.id, String(m.source), String(m.target), (m.assignees as string[]) ?? [], (m.reviewers as string[]) ?? [], m.delete_source_branch === true, now]);
        const mrKey = String(m.key ?? `mr${nextIid}`);
        mrKeyToId.set(`${p.key}/${mrKey}`, { id: r.rows[0].id, iid: nextIid });
        (projOut.merge_requests as Record<string, unknown>)[mrKey] = { id: r.rows[0].id, iid: nextIid };
        const { mergeBase } = await import('../domain/repo.js');
        const base = await mergeBase(client, sourceHead, targetHead);
        await client.query(`INSERT INTO mr_versions (mr_id, number, head, base, start_commit, created_at) VALUES ($1, 1, $2, $3, $4, $5)`, [r.rows[0].id, sourceHead, base ?? '', targetHead, now]);
        // approvals
        for (const ap of (m.approvals as string[] | undefined) ?? []) {
          const uid = (await client.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [ap])).rows[0];
          if (uid) {
            await client.query(`INSERT INTO approvals (mr_id, user_id, sha, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [r.rows[0].id, uid.id, sourceHead, now]);
          }
        }
        // threads
        for (const th of (m.threads as Array<Record<string, unknown>> | undefined) ?? []) {
          const thAuthor = (await client.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [String(th.author)])).rows[0];
          if (!thAuthor) continue;
          const oldLine = th.old_line === null || th.old_line === undefined ? null : Number(th.old_line);
          const newLine = th.new_line === null || th.new_line === undefined ? null : Number(th.new_line);
          const endLine = th.end_line === null || th.end_line === undefined ? null : Number(th.end_line);
          const tr = await client.query<{ id: number }>(`INSERT INTO threads (mr_id, path, old_line, new_line, end_line, version, side, current_line, resolved, outdated, created_at) VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, false, $9) RETURNING id`,
            [r.rows[0].id, th.path ? String(th.path) : null, oldLine, newLine, endLine, oldLine !== null ? 'old' : 'new', newLine ?? oldLine, Boolean(th.resolved), now]);
          const nr = await client.query<{ id: number }>(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, thread_id, created_at) VALUES ($1, $2, $3, false, false, $4, $5, $6) RETURNING id`,
            [projectId, String(th.author), String(th.body ?? ''), r.rows[0].id, tr.rows[0].id, now]);
          (projOut.threads as Record<string, unknown>)[String(th.key ?? `t${tr.rows[0].id}`)] = { id: tr.rows[0].id };
          void nr;
        }
      }
      // pipelines
      for (const pl of p.pipelines ?? []) {
        const sha = commitKeyToId.get(`${p.key}/${pl.commit}`);
        if (!sha) continue;
        const targetHead = (await client.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [projectId, pl.ref])).rows[0]?.commit_id ?? sha;
        const result = await createPipeline(rc.ctx, client, {
          projectId, projectPath: path, ref: pl.ref, sha: targetHead, source: 'push', defaultBranch: p.default_branch ?? 'main',
        });
        if (result.id === null) continue;
        (projOut.pipelines as Record<string, unknown>)[pl.key] = { id: result.id, jobs: {} };
        // set job statuses
        for (const [jobName, status] of Object.entries(pl.jobs ?? {})) {
          const job = (await client.query<{ id: number; name: string; status: string }>(`SELECT id, name, status FROM jobs WHERE pipeline_id = $1 AND name = $2 ORDER BY id DESC LIMIT 1`, [result.id, jobName])).rows[0];
          if (!job) continue;
          const nowT = rc.ctx.now();
          await client.query(`UPDATE jobs SET status = $2, started_at = COALESCE(started_at, $3), finished_at = $3 WHERE id = $1`, [job.id, String(status), nowT]);
          const maxN = (await client.query<{ n: number }>(`SELECT COALESCE(max(n), 0) AS n FROM job_log_lines WHERE job_id = $1`, [job.id])).rows[0];
          await client.query(`INSERT INTO job_log_lines (job_id, n, stream, text) VALUES ($1, $2, 'sys', $3)`, [job.id, Number(maxN?.n ?? 0) + 1, `Job finished: ${String(status)}`]);
          ((projOut.pipelines as Record<string, unknown>)[pl.key] as Record<string, unknown>).jobs = { ...(((projOut.pipelines as Record<string, unknown>)[pl.key] as Record<string, unknown>).jobs as Record<string, number> ?? {}), [jobName]: job.id };
        }
        // recompute pipeline status
        const jobs = (await client.query(`SELECT * FROM jobs WHERE pipeline_id = $1`, [result.id])).rows;
        const { rollupStatus } = await import('../domain/scheduler.js');
        const status = rollupStatus(jobs as never);
        await client.query(`UPDATE pipelines SET status = $2, finished_at = $3 WHERE id = $1`, [result.id, status, rc.ctx.now()]);
        // deployment for env jobs
        for (const job of jobs) {
          if (job.status === 'success' && job.env_name) {
            const envName = String(job.env_name);
            const env = await ensureEnvironment(client, projectId, envName, envName === 'production' ? 'production' : 'other');
            const depR = await client.query<{ id: number }>(`INSERT INTO deployments (environment_id, number, status, sha, pipeline_id, job_id, created_at, finished_at, rolled_back) VALUES ($1, (SELECT COALESCE(max(number), 0) + 1 FROM deployments WHERE environment_id = $1), 'success', $2, $3, $4, $5, $5, false) RETURNING id`,
              [env.id, targetHead, result.id, job.id, rc.ctx.now()]);
            await client.query(`UPDATE environments SET current_number = (SELECT COALESCE(max(number), 0) FROM deployments WHERE environment_id = $1) WHERE id = $1`, [env.id]);
            (projOut.environments as Record<string, unknown>)[envName] = { id: env.id, deployment: depR.rows[0].id };
            // store build artifacts
            const arts = (await client.query(`SELECT * FROM artifacts WHERE job_id = $1`, [job.id])).rows;
            for (const a of arts) {
              if (a.object_key) {
                await client.query(`INSERT INTO deploy_artifacts (deployment_id, path, object_key, size) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [depR.rows[0].id, a.path, a.object_key, a.size]);
              }
            }
          }
        }
      }
      // train
      for (const train of p.train ?? []) {
        await client.query(`UPDATE projects SET merge_trains = true WHERE id = $1`, [projectId]);
        const cars: Array<{ iid: number; id: number }> = [];
        for (const reqKey of train.requests) {
          const mr = mrKeyToId.get(`${p.key}/${reqKey}`);
          if (!mr) continue;
          const mrRow = (await client.query(`SELECT * FROM merge_requests WHERE id = $1`, [mr.id])).rows[0];
          const result = await addToTrain(rc.ctx, client, projectId, path, mrRow, p.default_branch ?? 'main');
          cars.push({ iid: mr.iid, id: mr.id });
          (projOut.train as Record<string, unknown>)[reqKey] = { position: result.position, sha: result.sha, pipeline_id: result.pipelineId };
        }
      }
      // boards
      for (const board of p.boards ?? []) {
        const bR = await client.query<{ id: number }>(`INSERT INTO boards (project_id, name, kind, created_at) VALUES ($1, $2, $3, $4) RETURNING id`, [projectId, board.name, board.kind ?? 'label', now]);
        const lists: Record<string, number> = {};
        await client.query(`INSERT INTO board_lists (board_id, title, position, kind) VALUES ($1, 'Open', 1, 'open')`, [bR.rows[0].id]);
        await client.query(`INSERT INTO board_lists (board_id, title, position, kind) VALUES ($1, 'Closed', 2, 'closed')`, [bR.rows[0].id]);
        lists['Open'] = 1;
        let position = 3;
        for (const listName of board.lists ?? []) {
          const labelId = await resolveLabelId(client, projectId, listName);
          const r = await client.query<{ id: number }>(`INSERT INTO board_lists (board_id, title, position, kind, label_id) VALUES ($1, $2, $3, 'label', $4) RETURNING id`, [bR.rows[0].id, listName, position, labelId]);
          lists[listName] = r.rows[0].id;
          position++;
        }
        (projOut.boards as Record<string, unknown>)[board.key] = { id: bR.rows[0].id, lists };
      }
      // wiki
      for (const page of p.wiki ?? []) {
        const wp = await client.query<{ id: number }>(`INSERT INTO wiki_pages (project_id, slug) VALUES ($1, $2) ON CONFLICT (project_id, slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`, [projectId, page.slug]);
        await client.query(`INSERT INTO wiki_versions (page_id, version, title, content, author, created_at) VALUES ($1, 1, $2, $3, $4, $5)`, [wp.rows[0].id, page.title, page.content, page.author, now]);
        (projOut.wiki as Record<string, unknown>)[page.slug] = { version: 1 };
      }
      // webhooks
      for (const hook of p.webhooks ?? []) {
        const r = await client.query<{ id: number }>(`INSERT INTO webhooks (project_id, url, secret, events, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [projectId, hook.url, hook.secret, hook.events ?? [], now]);
        (projOut.webhooks as Record<string, unknown>)[hook.key] = { id: r.rows[0].id };
      }
      const seq = await rc.ctx.currentSeq(client, projectId);
      (projOut as Record<string, unknown>).seq = seq;
      projectOut[p.key] = projOut;
    }
    (out.projects as Record<string, unknown>) = projectOut;
    // epics
    const epicOut: Record<string, unknown> = {};
    for (const e of epicSpecs) {
      const gid = findGroupId(groupPathToId, e.group);
      if (gid === null) continue;
      const author = (await client.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [e.author])).rows[0];
      if (!author) continue;
      const iid = await nextEpicIidFor(client, gid);
      const r = await client.query<{ id: number }>(`INSERT INTO epics (group_id, iid, title, description, author_id, state, confidential, created_at) VALUES ($1, $2, $3, $4, $5, 'opened', false, $6) RETURNING id`,
        [gid, iid, e.title, '', author.id, now]);
      for (const issueRef of e.issues ?? []) {
        const issue = issueKeyToId.get(issueRef);
        if (issue) {
          await client.query(`INSERT INTO epic_issues (epic_id, issue_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [r.rows[0].id, issue.id]);
        }
      }
      epicOut[e.key] = { id: r.rows[0].id, iid };
    }
    out.epics = epicOut;
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (e instanceof AppError) throw e;
    process.stderr.write(`seed error: ${e instanceof Error ? e.stack : String(e)}\n`);
    throw new AppError(422, 'validation', 'The seed data is invalid.');
  } finally {
    client.release();
  }
}

function str(v: unknown, def: string): string {
  return typeof v === 'string' ? v : def;
}

function findGroupId(map: Map<string, number>, path: string): number | null {
  return map.get(path) ?? null;
}

async function ancestorGroupIds(c: import('pg').PoolClient, groupId: number): Promise<number[]> {
  const out: number[] = [];
  let cur: number | null = groupId;
  while (cur !== null) {
    out.push(cur);
    const r: { rows: Array<{ parent_id: number | null }> } = await c.query<{ parent_id: number | null }>(`SELECT parent_id FROM groups WHERE id = $1`, [cur]);
    cur = r.rows[0]?.parent_id ?? null;
  }
  return out;
}

async function nextIidFor(c: import('pg').PoolClient, projectId: number, kind: 'issue' | 'request'): Promise<number> {
  const r = await c.query<{ next_iid: number }>(
    `INSERT INTO mr_iids (project_id, kind, next_iid) VALUES ($1, $2, 2) ON CONFLICT (project_id, kind) DO UPDATE SET next_iid = mr_iids.next_iid + 1 RETURNING next_iid - 1 AS next_iid`,
    [projectId, kind],
  );
  return r.rows[0].next_iid;
}

async function nextEpicIidFor(c: import('pg').PoolClient, groupId: number): Promise<number> {
  const r = await c.query<{ next_iid: number }>(
    `INSERT INTO epic_iids (group_id, next_iid) VALUES ($1, 2) ON CONFLICT (group_id) DO UPDATE SET next_iid = epic_iids.next_iid + 1 RETURNING next_iid - 1`,
    [groupId],
  );
  return r.rows[0].next_iid;
}

async function resolveLabelId(c: import('pg').PoolClient, projectId: number, name: string): Promise<number | null> {
  // project label first, then an inherited group label from the project's group or an ancestor
  const project = (await c.query<{ group_id: number }>(`SELECT group_id FROM projects WHERE id = $1`, [projectId])).rows[0];
  if (!project) return null;
  const ancestors = await ancestorGroupIds(c, project.group_id);
  const rows = (await c.query<{ id: number }>(
    `SELECT id FROM labels WHERE name = $1 AND (project_id = $2 OR (project_id IS NULL AND group_id = ANY($3::bigint[])))`,
    [name, projectId, ancestors],
  )).rows;
  return rows[0]?.id ?? null;
}

async function milestoneByTitle(c: import('pg').PoolClient, projectId: number, title: string): Promise<number | null> {
  return (await c.query<{ id: number }>(`SELECT id FROM milestones WHERE project_id = $1 AND title = $2`, [projectId, title])).rows[0]?.id ?? null;
}

async function ensureEnvironment(c: import('pg').PoolClient, projectId: number, name: string, tier: string): Promise<{ id: number }> {
  const r = await c.query<{ id: number }>(`INSERT INTO environments (project_id, name, tier, state, current_number) VALUES ($1, $2, $3, 'available', 0) ON CONFLICT (project_id, name) DO UPDATE SET tier = EXCLUDED.tier RETURNING id`, [projectId, name, tier]);
  return r.rows[0];
}

// ---- other grading routes ----

export async function gradingSession(rc: RequestCtx): Promise<unknown> {
  const body = requireBody(rc);
  const username = typeof body.username === 'string' ? String(body.username) : '';
  const user = (await rc.ctx.db.query<{ id: number; username: string; time_zone: string }>(`SELECT id, username, time_zone FROM users WHERE username = $1`, [username])).rows[0];
  if (!user) throw errs.notFound();
  const token = newSessionToken();
  await rc.ctx.db.query(`INSERT INTO sessions (token, user_id, created_at, last_used) VALUES ($1, $2, $3, $3)`, [token, user.id, rc.ctx.now()]);
  rc.res.setHeader('Set-Cookie', `spur_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
  return { user: { id: user.id, username: user.username, time_zone: user.time_zone } };
}

export async function gradingClock(rc: RequestCtx): Promise<unknown> {
  const body = requireBody(rc);
  const now = rc.ctx.now();
  if (typeof body.set_ms === 'number') {
    rc.ctx.clock.set(body.set_ms);
  } else if (typeof body.advance_ms === 'number') {
    rc.ctx.clock.advance(body.advance_ms);
  }
  const newNow = rc.ctx.now();
  await applyDeadlines(rc, now, newNow);
  return { now_ms: newNow, now: new Date(newNow).toISOString() };
}

async function applyDeadlines(rc: RequestCtx, before: number, after: number): Promise<void> {
  void before;
  // expiry of artifacts, approvals, auto-stops and train timeouts all apply at once
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const now = after;
    const expiredArts = (await client.query<{ id: number; object_key: string; project_id: number }>(
      `SELECT a.id, a.object_key, j.project_id FROM artifacts a JOIN jobs j ON j.id = a.job_id WHERE a.expires_at IS NOT NULL AND a.expires_at < $1 AND a.keep = false`, [now])).rows;
    for (const a of expiredArts) {
      if (a.object_key) await rc.ctx.storage.del(a.object_key).catch(() => undefined);
      await client.query(`UPDATE artifacts SET object_key = NULL WHERE id = $1`, [a.id]);
      await rc.ctx.live(client, a.project_id, 'job', { event: 'artifact_expired', artifact: a.id });
    }
    const expiringDeploys = (await client.query(`SELECT d.id, d.environment_id, d.status, e.name, e.project_id FROM deployments d JOIN environments e ON e.id = d.environment_id WHERE d.status = 'awaiting_approval'`)).rows;
    for (const d of expiringDeploys) {
      const approvals = (await client.query<{ id: number; expires_at: number }>(`SELECT id, expires_at FROM deployment_approvals WHERE deployment_id = $1 AND status = 'approved'`, [d.id])).rows;
      const valid = approvals.filter((a) => a.expires_at !== null && a.expires_at >= now);
      const prot = (await client.query<{ approvals: number }>(`SELECT pe.approvals FROM protected_environments pe WHERE pe.project_id = $1 AND pe.name = $2`, [d.project_id, d.name])).rows[0];
      if (prot && valid.length < prot.approvals && approvals.length !== valid.length) {
        await rc.ctx.live(client, d.project_id, 'deployment', { environment: d.name, number: d.number, event: 'approval_expired' });
      }
    }
    const autoStops = (await client.query(`SELECT id, project_id, auto_stop_at FROM environments WHERE auto_stop_at IS NOT NULL AND auto_stop_at <= $1`, [now])).rows;
    for (const e of autoStops) {
      await client.query(`UPDATE environments SET state = 'stopped', auto_stop_at = NULL WHERE id = $1`, [e.id]);
      await rc.ctx.live(client, e.project_id, 'environment', { id: e.id, state: 'stopped' });
    }
    // train car timeouts
    const cars = (await client.query(`SELECT tc.*, mr.iid, mr.project_id FROM train_cars tc JOIN merge_requests mr ON mr.id = tc.mr_id WHERE tc.created_at + $1 <= $2`, [rc.ctx.settings.jobTimeoutMs, now])).rows;
    for (const car of cars) {
      const mrRow = (await client.query(`SELECT * FROM merge_requests WHERE id = $1`, [car.mr_id])).rows[0];
      const project = (await client.query<{ path: string; default_branch: string }>(`SELECT path, default_branch FROM projects WHERE id = $1`, [car.project_id])).rows[0];
      await client.query(`INSERT INTO notes (project_id, author, body, system, pending, mr_id, created_at) VALUES ($1, 'spurline-train', $2, true, false, $3, $4)`,
        [car.project_id, `Removed from merge train: pipeline ${car.pipeline_id} timed out.`, car.mr_id, now]);
      await client.query(`DELETE FROM train_cars WHERE mr_id = $1`, [car.mr_id]);
      if (project) {
        await rebuildCarsFrom(rc.ctx, client, car.project_id, project.path, car.target, project.default_branch, car.position);
      }
      await rc.ctx.live(client, car.project_id, 'train', { target: car.target, event: 'removed', iid: car.iid });
    }
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
  } finally {
    client.release();
  }
}

export async function gradingCommit(rc: RequestCtx): Promise<unknown> {
  const body = requireBody(rc);
  const projectId = typeof body.project === 'number' ? body.project : null;
  const as = typeof body.as === 'string' ? String(body.as) : '';
  const timestamp = typeof body.timestamp === 'number' ? body.timestamp : Math.floor(rc.ctx.now() / 1000);
  if (projectId === null) throw errs.validation({ project: "Project can't be blank." });
  const user = (await rc.ctx.db.query<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [as])).rows[0];
  if (!user) throw errs.notFound();
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project } = await (await import('./common.js')).loadProject(client, rc.ctx, projectId, user.id);
    const { pushProtectionVerdict, branchHead } = await import('../domain/repo-service.js');
    const { effectiveAccess } = await import('../domain/access.js');
    const access = await effectiveAccess(client, projectId, user.id);
    const branch = String(body.branch ?? '');
    const previousHead = await branchHead(client, projectId, branch);
    const verdict = await pushProtectionVerdict(client, projectId, branch, access.role, access.permissions.has('push_protected'));
    if (!verdict.ok) throw new AppError(verdict.status ?? 403, verdict.code ?? 'protected_branch', verdict.message ?? '');
    const result = await applyCommit(rc.ctx, client, projectId, {
      branch,
      start_ref: body.start_ref === undefined ? null : String(body.start_ref),
      base_commit: typeof body.base_commit === 'string' ? body.base_commit : null,
      message: String(body.message ?? ''),
      actions: (Array.isArray(body.actions) ? body.actions : []).map((a) => {
        const act = a as Record<string, unknown>;
        return {
          action: String(act.action) as 'create' | 'update' | 'delete' | 'move',
          path: String(act.path ?? ''),
          content: act.content === undefined ? undefined : String(act.content),
          previous_path: act.previous_path === undefined ? undefined : String(act.previous_path),
        };
      }),
      author: as,
      authorTime: timestamp,
      commitTime: timestamp,
    }, { bypassProtection: true, bypassPushRules: false });
    const { pushConsequences } = await import('../domain/push-consequences.js');
    const push = await pushConsequences(rc.ctx, client, {
      projectId, projectPath: project.path, branch, previousHead, newHead: result.id,
      defaultBranch: project.default_branch, resetApprovalsOnPush: project.reset_approvals_on_push,
      autoResolveOutdated: project.auto_resolve_outdated, actor: as,
    });
    await client.query('COMMIT');
    return {
      commit: result.id,
      seq: push.seq,
      pipeline: push.pipeline.created && push.pipeline.id ? { id: push.pipeline.id } : { created: false, reason: push.pipeline.reason },
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function gradingRunnerStep(rc: RequestCtx): Promise<unknown> {
  const body = requireBody(rc);
  const projectId = typeof body.project === 'number' ? body.project : null;
  const count = typeof body.count === 'number' ? body.count : 1;
  if (projectId === null) throw errs.validation({ project: "Project can't be blank." });
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const scheduler = new Scheduler(rc.ctx);
    const all: Array<{ id: number; name: string; status: string }> = [];
    for (let i = 0; i < count; i++) {
      const result = await scheduler.round(client, projectId);
      all.push(...result.jobs);
    }
    const seq = await rc.ctx.currentSeq(client, projectId);
    await client.query('COMMIT');
    return { rounds: count, jobs: all, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function gradingRunnerSettle(rc: RequestCtx): Promise<unknown> {
  const body = requireBody(rc);
  const projectId = typeof body.project === 'number' ? body.project : null;
  if (projectId === null) throw errs.validation({ project: "Project can't be blank." });
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const scheduler = new Scheduler(rc.ctx);
    const all: Array<{ id: number; name: string; status: string }> = [];
    let rounds = 0;
    for (let i = 0; i < 500; i++) {
      const before = JSON.stringify(all.length);
      void before;
      const result = await scheduler.round(client, projectId);
      all.push(...result.jobs);
      rounds++;
      if (!result.changed) break;
    }
    const seq = await rc.ctx.currentSeq(client, projectId);
    await client.query('COMMIT');
    return { rounds, jobs: all, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function gradingStorage(rc: RequestCtx): Promise<unknown> {
  const body = requireBody(rc);
  const down = body.down === true;
  rc.ctx.storage.setDown(down);
  return { storage: down ? 'down' : 'up' };
}

export async function gradingSinkPost(rc: RequestCtx): Promise<unknown> {
  const name = rc.params.name;
  const statusParam = rc.query.get('status');
  let status = 200;
  const stored = (await rc.ctx.db.query<{ status: number }>(`SELECT status FROM sink_requests WHERE name = $1`, [name])).rows[0];
  if (stored) status = stored.status;
  else if (statusParam !== null) status = parseInt(statusParam, 10);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(rc.req.headers)) {
    headers[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  const body = rc.raw.toString('utf8');
  const record = { headers, body, received_at_ms: rc.ctx.now() };
  await rc.ctx.db.query(
    `INSERT INTO sink_requests (name, status, requests) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (name) DO UPDATE SET requests = sink_requests.requests || EXCLUDED.requests`,
    [name, status, JSON.stringify([record])],
  );
  rc.res.writeHead(status, { 'Content-Type': 'text/plain' });
  rc.res.end('');
  return { __handled: true };
}

export async function gradingSinkPut(rc: RequestCtx): Promise<unknown> {
  const name = rc.params.name;
  const body = requireBody(rc);
  const status = typeof body.status === 'number' ? body.status : 200;
  await rc.ctx.db.query(
    `INSERT INTO sink_requests (name, status, requests) VALUES ($1, $2, '[]'::jsonb)
     ON CONFLICT (name) DO UPDATE SET status = EXCLUDED.status`,
    [name, status],
  );
  return { status };
}

export async function gradingSinkGet(rc: RequestCtx): Promise<unknown> {
  const name = rc.params.name;
  const row = (await rc.ctx.db.query<{ requests: Array<{ headers: Record<string, string>; body: string; received_at_ms: number }> }>(`SELECT requests FROM sink_requests WHERE name = $1`, [name])).rows[0];
  return { requests: row?.requests ?? [] };
}
