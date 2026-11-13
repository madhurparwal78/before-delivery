import { ProjectRow, defaultSettings, loadProject, roleLevels } from './access';
import { hashPassword } from './auth';
import { nowMs } from './clock';
import { Tx } from './live';
import { CommitAction, applyActions } from './push';
import { branchHead, filesOfCommit, setBranch, storeCommit, writeTree } from './repo';
import { createPipeline, jobsOfPipeline, rollup } from './pipeline';
import { settleStatuses } from './runner';
import { createIssue } from './planning';
import { createThread, createVersion, loadRequest } from './mr';
import { addToTrain } from './train';
import { errors } from './errors';

export type SeedBody = Record<string, unknown>;

type Dict = Record<string, unknown>;

function list(value: unknown): Dict[] {
  return Array.isArray(value) ? (value as Dict[]) : [];
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

export async function seedInstance(t: Tx, body: SeedBody): Promise<Record<string, unknown>> {
  const users: Record<string, { id: number }> = {};
  const groups: Record<string, { id: number; path: string }> = {};
  const groupsByPath = new Map<string, number>();
  const customRoles: Record<string, { id: number }> = {};
  const epics: Record<string, { id: number; iid: number }> = {};
  const projects: Record<string, Record<string, unknown>> = {};

  for (const user of list(body.users)) {
    const username = str(user.username);
    const row = await t.sql.one<{ id: string }>(
      `insert into users (username, password_hash, time_zone) values ($1, $2, $3)
       on conflict (username) do update set time_zone = $3 returning id`,
      [username, hashPassword(str(user.password, 'spurline-demo-1')), str(user.time_zone, 'UTC')],
    );
    users[username] = { id: Number(row?.id) };
  }
  const trainUser = await t.sql.one<{ id: string }>(
    `insert into users (username, password_hash, can_sign_in) values ('spurline-train', $1, false)
     on conflict (username) do update set can_sign_in = false returning id`,
    [hashPassword('not-a-password')],
  );

  for (const group of list(body.groups)) {
    const path = str(group.path);
    const segments = path.split('/');
    const name = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join('/');
    const parentId = parentPath === '' ? null : groupsByPath.get(parentPath) ?? null;
    if (parentPath !== '' && parentId === null) throw errors.validation('groups', `Unknown parent group ${parentPath}.`);
    const row = await t.sql.one<{ id: string }>(
      `insert into groups (parent_id, name, path, visibility) values ($1, $2, $3, $4)
       on conflict (path) do update set visibility = $4 returning id`,
      [parentId, name, path, str(group.visibility, 'private')],
    );
    const id = Number(row?.id);
    groupsByPath.set(path, id);
    groups[str(group.key, path)] = { id, path };
  }

  for (const role of list(body.custom_roles)) {
    const groupId = groupsByPath.get(str(role.group));
    if (groupId === undefined) throw errors.validation('custom_roles', `Unknown group ${str(role.group)}.`);
    const row = await t.sql.one<{ id: string }>(
      'insert into custom_roles (group_id, name, base, permissions) values ($1, $2, $3, $4) returning id',
      [groupId, str(role.name), str(role.base, 'developer'), JSON.stringify(role.permissions ?? [])],
    );
    customRoles[str(role.key, str(role.name))] = { id: Number(row?.id) };
  }

  for (const group of list(body.groups)) {
    const groupId = groupsByPath.get(str(group.path));
    if (groupId === undefined) continue;
    for (const member of list(group.members)) {
      const username = str(member.username);
      const userId = users[username]?.id ?? (await userId2(t, username));
      const customKey = str(member.custom_role, '');
      await t.sql.query(
        `insert into memberships (subject_type, subject_id, user_id, role, custom_role_id)
         values ('group', $1, $2, $3, $4)
         on conflict (subject_type, subject_id, user_id) do update set role = $3, custom_role_id = $4`,
        [
          groupId,
          userId,
          customKey === '' ? str(member.role, 'developer') : null,
          customKey === '' ? null : customRoles[customKey]?.id ?? null,
        ],
      );
    }
  }

  for (const label of list(body.group_labels)) {
    const groupId = groupsByPath.get(str(label.group));
    if (groupId === undefined) continue;
    await t.sql.query('insert into labels (group_id, name, description) values ($1, $2, $3)', [
      groupId,
      str(label.name),
      str(label.description),
    ]);
  }

  const issueKeys = new Map<string, number>();

  for (const project of list(body.projects)) {
    const key = str(project.key);
    const groupPath = str(project.group);
    const groupId = groupsByPath.get(groupPath);
    if (groupId === undefined) throw errors.validation('projects', `Unknown group ${groupPath}.`);
    const slug = str(project.slug);
    const settings = { ...defaultSettings, ...(project.settings as object ?? {}) };
    const row = await t.sql.one<{ id: string }>(
      `insert into projects (group_id, slug, path, visibility, default_branch, settings)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        groupId,
        slug,
        `${groupPath}/${slug}`,
        str(project.visibility, 'private'),
        str(project.default_branch, 'main'),
        JSON.stringify(settings),
      ],
    );
    const projectId = Number(row?.id);
    const loaded = await loadProject(t.sql, projectId);
    if (loaded === null) throw errors.notFound();

    for (const member of list(project.members)) {
      const username = str(member.username);
      const id = users[username]?.id ?? (await userId2(t, username));
      const customKey = str(member.custom_role, '');
      await t.sql.query(
        `insert into memberships (subject_type, subject_id, user_id, role, custom_role_id)
         values ('project', $1, $2, $3, $4)
         on conflict (subject_type, subject_id, user_id) do update set role = $3, custom_role_id = $4`,
        [
          projectId,
          id,
          customKey === '' ? str(member.role, 'developer') : null,
          customKey === '' ? null : customRoles[customKey]?.id ?? null,
        ],
      );
    }

    for (const branch of list(project.protected_branches)) {
      await t.sql.query(
        `insert into protected_branches (project_id, pattern, allowed_to_push, allowed_to_merge)
         values ($1, $2, $3, $4)
         on conflict (project_id, pattern) do update set allowed_to_push = $3, allowed_to_merge = $4`,
        [projectId, str(branch.name), str(branch.allowed_to_push, 'maintainer'), str(branch.allowed_to_merge, 'developer')],
      );
    }
    for (const tag of list(project.protected_tags)) {
      await t.sql.query(
        `insert into protected_tags (project_id, pattern, allowed_to_create) values ($1, $2, $3)
         on conflict (project_id, pattern) do update set allowed_to_create = $3`,
        [projectId, str(tag.name), str(tag.allowed_to_create, 'maintainer')],
      );
    }
    if (project.push_rules !== undefined && project.push_rules !== null) {
      const rules = project.push_rules as Dict;
      await t.sql.query(
        `insert into push_rules (project_id, rules) values ($1, $2)
         on conflict (project_id) do update set rules = $2`,
        [
          projectId,
          JSON.stringify({
            branch_name: rules.branch_name ?? null,
            commit_message: rules.commit_message ?? null,
            forbidden_files: rules.forbidden_files ?? [],
            required_files: rules.required_files ?? [],
            secrets: rules.secrets === true,
          }),
        ],
      );
    }
    for (const rule of list(project.approval_rules)) {
      await t.sql.query(
        'insert into approval_rules (project_id, name, required, users, groups) values ($1, $2, $3, $4, $5)',
        [projectId, str(rule.name), num(rule.required, 1), JSON.stringify(rule.users ?? []), JSON.stringify(rule.groups ?? [])],
      );
    }
    for (const environment of list(project.protected_environments)) {
      await t.sql.query(
        `insert into protected_environments (project_id, name, roles, approvals) values ($1, $2, $3, $4)
         on conflict (project_id, name) do update set roles = $3, approvals = $4`,
        [projectId, str(environment.name), str(environment.roles, 'maintainer'), num(environment.approvals, 1)],
      );
    }
    const variables = (project.variables as Record<string, string> | undefined) ?? {};
    for (const [variableKey, value] of Object.entries(variables)) {
      await t.sql.query('insert into project_variables (project_id, key, value) values ($1, $2, $3)', [
        projectId,
        variableKey,
        String(value),
      ]);
    }

    const commitIds: Record<string, string> = {};
    for (const commit of list(project.commits)) {
      const branch = str(commit.branch, loaded.default_branch);
      const startRef = commit.start_ref === null || commit.start_ref === undefined ? null : str(commit.start_ref);
      const head = await branchHead(t.sql, projectId, branch);
      const parent = head ?? (startRef === null ? null : await branchHead(t.sql, projectId, startRef));
      const before = parent === null ? new Map<string, string>() : await filesOfCommit(t.sql, projectId, parent);
      const actions = list(commit.actions).map((action) => ({
        action: str(action.action, 'create') as CommitAction['action'],
        path: str(action.path),
        content: action.content === undefined ? undefined : str(action.content),
        previous_path: action.previous_path === undefined ? undefined : str(action.previous_path),
      }));
      const after = applyActions(before, actions);
      const tree = await writeTree(t, projectId, after);
      const when = num(commit.timestamp, Math.floor(nowMs() / 1000));
      const author = str(commit.as, 'spurline-train');
      const id = await storeCommit(t, projectId, {
        tree,
        parents: parent === null ? [] : [parent],
        author,
        authored_at: when,
        committer: author,
        committed_at: when,
        message: str(commit.message, 'Commit'),
      });
      await setBranch(t, projectId, branch, id);
      commitIds[str(commit.key, id)] = id;
    }

    for (const tag of list(project.tags)) {
      const commit = commitIds[str(tag.commit)] ?? (await branchHead(t.sql, projectId, loaded.default_branch));
      await t.sql.query(
        `insert into refs (project_id, kind, name, commit_id, message) values ($1, 'tag', $2, $3, $4)
         on conflict (project_id, kind, name) do update set commit_id = $3, message = $4`,
        [projectId, str(tag.name), commit, str(tag.message)],
      );
    }

    const labels: Record<string, { id: number }> = {};
    for (const label of list(project.labels)) {
      const labelRow = await t.sql.one<{ id: string }>(
        'insert into labels (project_id, name, description) values ($1, $2, $3) returning id',
        [projectId, str(label.name), str(label.description)],
      );
      labels[str(label.name)] = { id: Number(labelRow?.id) };
    }

    const milestones: Record<string, { id: number }> = {};
    for (const milestone of list(project.milestones)) {
      const milestoneRow = await t.sql.one<{ id: string }>(
        `insert into milestones (project_id, title, start_date, due_date, time_zone) values ($1, $2, $3, $4, $5)
         returning id`,
        [
          projectId,
          str(milestone.title),
          milestone.start === null || milestone.start === undefined ? null : str(milestone.start),
          milestone.due === null || milestone.due === undefined ? null : str(milestone.due),
          str(milestone.time_zone, 'UTC'),
        ],
      );
      milestones[str(milestone.key, str(milestone.title))] = { id: Number(milestoneRow?.id) };
    }

    const issues: Record<string, { id: number; iid: number }> = {};
    for (const issue of list(project.issues)) {
      const created = await createIssue(t, loaded, str(issue.author, 'spurline-train'), {
        title: str(issue.title),
        description: str(issue.description),
        labels: (issue.labels as string[] | undefined) ?? [],
        assignees: (issue.assignees as string[] | undefined) ?? [],
        milestone: issue.milestone === null || issue.milestone === undefined ? null : milestones[str(issue.milestone)]?.id ?? null,
        weight: issue.weight === null || issue.weight === undefined ? null : num(issue.weight),
        confidential: bool(issue.confidential),
      });
      if (str(issue.state, 'opened') === 'closed') {
        await t.sql.query("update issues set state = 'closed', closed_ms = $2 where id = $1", [created.id, nowMs()]);
      }
      issues[str(issue.key, String(created.iid))] = { id: created.id, iid: created.iid };
      issueKeys.set(`${key}/${str(issue.key)}`, created.id);
    }

    const requests: Record<string, { id: number; iid: number }> = {};
    const threads: Record<string, { id: number }> = {};
    for (const request of list(project.merge_requests)) {
      const iidRow = await t.sql.one<{ iid: number }>(
        'update projects set next_mr_iid = next_mr_iid + 1 where id = $1 returning next_mr_iid - 1 as iid',
        [projectId],
      );
      const iid = Number(iidRow?.iid ?? 1);
      const requestRow = await t.sql.one<{ id: string }>(
        `insert into merge_requests (project_id, iid, title, description, author, source, target, state,
                                     delete_source_branch, assignees, reviewers)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [
          projectId,
          iid,
          str(request.title),
          str(request.description),
          str(request.author, 'spurline-train'),
          str(request.source),
          str(request.target, loaded.default_branch),
          str(request.state, 'opened'),
          bool(request.delete_source_branch),
          JSON.stringify(request.assignees ?? []),
          JSON.stringify(request.reviewers ?? []),
        ],
      );
      const requestId = Number(requestRow?.id);
      requests[str(request.key, String(iid))] = { id: requestId, iid };
      const full = await loadRequest(t.sql, projectId, iid);
      if (full === null) continue;
      const sourceHead = await branchHead(t.sql, projectId, full.source);
      if (sourceHead !== null) {
        await createVersion(t, loaded, full, sourceHead);
      }
      for (const username of (request.approvals as string[] | undefined) ?? []) {
        await t.sql.query('insert into approvals (mr_id, username) values ($1, $2) on conflict do nothing', [
          requestId,
          username,
        ]);
      }
      for (const thread of list(request.threads)) {
        const position =
          thread.path === null || thread.path === undefined
            ? null
            : {
                path: str(thread.path),
                old_line: thread.old_line === null || thread.old_line === undefined ? null : num(thread.old_line),
                new_line: thread.new_line === null || thread.new_line === undefined ? null : num(thread.new_line),
                end_line: thread.end_line === null || thread.end_line === undefined ? null : num(thread.end_line),
                version: 1,
              };
        const created = await createThread(
          t,
          loaded,
          full,
          str(thread.author, 'spurline-train'),
          str(thread.body),
          position,
          false,
        );
        if (bool(thread.resolved)) {
          await t.sql.query('update threads set resolved = true where id = $1', [created.threadId]);
        }
        threads[str(thread.key, String(created.threadId))] = { id: created.threadId };
      }
    }

    const pipelines: Record<string, { id: number; jobs: Record<string, number> }> = {};
    for (const pipeline of list(project.pipelines)) {
      const sha = commitIds[str(pipeline.commit)] ?? (await branchHead(t.sql, projectId, str(pipeline.ref, loaded.default_branch)));
      if (sha === null) continue;
      const result = await createPipeline(t, {
        project: loaded,
        ref: str(pipeline.ref, loaded.default_branch),
        sha,
        source: 'push',
        actor: 'spurline-train',
        beforeSha: null,
      });
      if (!('id' in result)) continue;
      const jobs = await jobsOfPipeline(t.sql, result.id);
      const wanted = (pipeline.jobs as Record<string, string> | undefined) ?? {};
      const jobIds: Record<string, number> = {};
      for (const job of jobs) {
        jobIds[job.name] = job.id;
        const status = wanted[job.name];
        if (status === undefined) continue;
        await t.sql.query(
          `update jobs set status = $2, started_ms = $3, finished_ms = $4, script_index = $5,
                           log = $6, log_sealed = false where id = $1`,
          [
            job.id,
            status,
            nowMs(),
            nowMs(),
            job.spec.script.length,
            JSON.stringify([{ stream: 'sys', text: `Job finished: ${status}` }]),
          ],
        );
      }
      await settleStatuses(t, loaded, result.id);
      const finalJobs = await jobsOfPipeline(t.sql, result.id);
      await t.sql.query('update pipelines set status = $2 where id = $1', [result.id, rollup(finalJobs)]);
      pipelines[str(pipeline.key, String(result.id))] = { id: result.id, jobs: jobIds };
    }

    const trains: Record<string, { position: number; sha: string; pipeline_id: number | null }> = {};
    for (const train of list(project.train)) {
      const target = str(train.target, loaded.default_branch);
      await t.sql.query('update projects set settings = settings || \'{"merge_trains":true}\' where id = $1', [projectId]);
      const trainProject = await loadProject(t.sql, projectId);
      if (trainProject === null) continue;
      for (const requestKey of (train.requests as string[] | undefined) ?? []) {
        const info = requests[requestKey];
        if (info === undefined) continue;
        const full = await loadRequest(t.sql, projectId, info.iid);
        if (full === null) continue;
        await addToTrain(
          t,
          trainProject,
          { level: roleLevels.owner, role: 'owner', permissions: [], implied: false },
          full,
          'spurline-train',
        );
        const car = await t.sql.one<{ position: number; sha: string; pipeline_id: string | null }>(
          'select position, sha, pipeline_id from train_cars where mr_id = $1',
          [info.id],
        );
        if (car !== null) {
          trains[requestKey] = {
            position: Number(car.position),
            sha: car.sha,
            pipeline_id: car.pipeline_id === null ? null : Number(car.pipeline_id),
          };
        }
      }
      void target;
    }

    const boards: Record<string, { id: number; lists: Record<string, number> }> = {};
    for (const board of list(project.boards)) {
      const values = (board.lists as string[] | undefined) ?? [];
      const lists = [
        { id: 1, title: 'Open', value: null },
        { id: 2, title: 'Closed', value: null },
        ...values.map((value, index) => ({ id: index + 3, title: value, value })),
      ];
      const boardRow = await t.sql.one<{ id: string }>(
        'insert into boards (project_id, name, kind, lists) values ($1, $2, $3, $4) returning id',
        [projectId, str(board.name, 'Board'), str(board.kind, 'label'), JSON.stringify(lists)],
      );
      boards[str(board.key, str(board.name))] = {
        id: Number(boardRow?.id),
        lists: Object.fromEntries(lists.map((item) => [item.title, item.id])),
      };
    }

    const wiki: Record<string, { version: number }> = {};
    for (const page of list(project.wiki)) {
      await t.sql.query(
        'insert into wiki_pages (project_id, slug, version, title, content, author) values ($1, $2, 1, $3, $4, $5)',
        [projectId, str(page.slug), str(page.title), str(page.content), str(page.author, 'spurline-train')],
      );
      wiki[str(page.slug)] = { version: 1 };
    }

    const webhooks: Record<string, { id: number }> = {};
    for (const hook of list(project.webhooks)) {
      const hookRow = await t.sql.one<{ id: string }>(
        'insert into webhooks (project_id, url, secret, events) values ($1, $2, $3, $4) returning id',
        [projectId, str(hook.url), str(hook.secret), JSON.stringify(hook.events ?? [])],
      );
      webhooks[str(hook.key, String(Number(hookRow?.id)))] = { id: Number(hookRow?.id) };
    }

    const environments = await t.sql.query<{ id: string; name: string }>(
      'select id, name from environments where project_id = $1',
      [projectId],
    );
    const seq = await t.sql.one<{ seq: string }>('select seq from projects where id = $1', [projectId]);
    projects[key] = {
      id: projectId,
      path: `${groupPath}/${slug}`,
      commits: commitIds,
      merge_requests: Object.fromEntries(
        Object.entries(requests).map(([name, value]) => [name, { id: value.id, iid: value.iid }]),
      ),
      threads,
      issues: Object.fromEntries(Object.entries(issues).map(([name, value]) => [name, { id: value.id, iid: value.iid }])),
      milestones,
      labels,
      pipelines,
      train: trains,
      boards,
      environments: Object.fromEntries(environments.map((row) => [row.name, { id: Number(row.id) }])),
      wiki,
      webhooks,
      seq: Number(seq?.seq ?? 0),
    };
  }

  for (const epic of list(body.epics)) {
    const groupId = groupsByPath.get(str(epic.group));
    if (groupId === undefined) continue;
    const iidRow = await t.sql.one<{ iid: number }>(
      'select coalesce(max(iid), 0) + 1 as iid from epics where group_id = $1',
      [groupId],
    );
    const iid = Number(iidRow?.iid ?? 1);
    let parentId: number | null = null;
    if (epic.parent !== null && epic.parent !== undefined) {
      const parent = epics[str(epic.parent)];
      parentId = parent === undefined ? null : parent.id;
    }
    const row = await t.sql.one<{ id: string }>(
      'insert into epics (group_id, iid, title, description, author, parent_id) values ($1, $2, $3, $4, $5, $6) returning id',
      [groupId, iid, str(epic.title), str(epic.description), str(epic.author, 'spurline-train'), parentId],
    );
    const epicId = Number(row?.id);
    epics[str(epic.key, String(iid))] = { id: epicId, iid };
    for (const reference of (epic.issues as string[] | undefined) ?? []) {
      const issueId = issueKeys.get(reference);
      if (issueId === undefined) continue;
      await t.sql.query('insert into epic_issues (epic_id, issue_id) values ($1, $2) on conflict do nothing', [
        epicId,
        issueId,
      ]);
    }
  }

  return {
    users: Object.fromEntries(Object.entries(users).map(([name, value]) => [name, { id: value.id }])),
    groups,
    custom_roles: customRoles,
    epics: Object.fromEntries(Object.entries(epics).map(([name, value]) => [name, { id: value.id, iid: value.iid }])),
    projects,
  };
}

async function userId2(t: Tx, username: string): Promise<number> {
  const row = await t.sql.one<{ id: string }>('select id from users where username = $1', [username]);
  if (row === null) throw errors.validation('username', `user @${username} doesn't exist`);
  return Number(row.id);
}

export async function seedProjectRef(sql: import('./db').Sql, project: ProjectRow): Promise<string | null> {
  return branchHead(sql, project.id, project.default_branch);
}

