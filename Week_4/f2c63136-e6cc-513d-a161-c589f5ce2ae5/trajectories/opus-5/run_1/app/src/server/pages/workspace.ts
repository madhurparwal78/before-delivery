import type { Db } from '../db.js';
import { CHECK_STATE_WORDS } from '../../domain/checks.js';
import { entryChecks, activeEntries, historyEntries } from '../../domain/queue.js';
import {
  getUserById,
  listAllRepos,
  listChanges,
  roleFor,
  ROLE_RANK,
  type RepoRow,
  type Role,
  type UserRow,
} from '../../domain/model.js';
import { getRevision, getSnapshot, listBranches, sortedPaths } from '../../domain/revisions.js';
import { attr, escapeHtml, page, STATE_WORDS, statusBar, timeElement } from './layout.js';

export async function inboxPage(tx: Db, user: UserRow, serviceStatusOk: boolean): Promise<string> {
  const repos = await listAllRepos(tx);
  const needs: string[] = [];
  const mine: string[] = [];
  let needsCount = 0;

  for (const repo of repos) {
    const role = await roleFor(tx, repo, user.id);
    if (role === null) continue;
    for (const change of await listChanges(tx, repo.id)) {
      const author = (await getUserById(tx, change.authorUserId))!;
      const row = `<li class="listrow">${statusBar(STATE_WORDS[change.state] ?? change.state)}
<a href="/${attr(repo.org)}/${attr(repo.name)}/changes/${change.number}">#${change.number} ${escapeHtml(
        change.title,
      )}</a>
<p class="muted">${escapeHtml(author.username)} • ${escapeHtml(repo.org)}/${escapeHtml(repo.name)}</p></li>`;
      if (change.authorUserId === user.id && change.state !== 'merged') mine.push(row);
      if (change.state !== 'merged' && change.state !== 'draft') {
        const pending = await tx.query(
          'SELECT 1 FROM rs_review_requests WHERE change_id = $1 AND user_id = $2 AND pending = true',
          [change.id, user.id],
        );
        if (pending.length > 0) {
          needs.push(row);
          needsCount += 1;
        }
      }
    }
  }

  const main = `<section class="card list">
<h2>Needs your review <span class="chip countchip">${needsCount}</span></h2>
${
  needs.length === 0
    ? '<p class="empty">Nothing is waiting for your review.</p><a class="arrow" href="/repos">Browse repositories →</a>'
    : `<ul class="rows">${needs.join('')}</ul>`
}
</section>
<section class="card list">
<h2>Your changes</h2>
${
  mine.length === 0
    ? '<p class="empty">You have no unmerged changes.</p><a class="arrow" href="/repos">Open a change →</a>'
    : `<ul class="rows">${mine.join('')}</ul>`
}
</section>`;
  return page({ title: 'Inbox', user, serviceStatusOk }, main);
}

export async function reposPage(tx: Db, user: UserRow, serviceStatusOk: boolean): Promise<string> {
  const repos = await listAllRepos(tx);
  const cards: string[] = [];
  const orgs = await tx.query<{ slug: string; name: string }>(
    'SELECT slug, name FROM rs_orgs WHERE owner_user_id = $1 ORDER BY slug',
    [user.id],
  );
  for (const repo of repos) {
    const role = await roleFor(tx, repo, user.id);
    if (role === null) continue;
    cards.push(`<li class="listrow"><a href="/${attr(repo.org)}/${attr(repo.name)}">${escapeHtml(repo.org)}/${escapeHtml(
      repo.name,
    )}</a><p class="muted">${escapeHtml(repo.visibility)} • your role: ${escapeHtml(role)}</p></li>`);
  }

  const main = `<section class="card list">
<h2>Repositories</h2>
${
  cards.length === 0
    ? '<p class="empty">You have no repositories yet.</p><a class="arrow" href="#create-repo">Create a repository →</a>'
    : `<ul class="rows">${cards.join('')}</ul>`
}
</section>
<section class="card formcard">
<h2>Create an organisation</h2>
<form data-form="org" class="stack">
<label class="field"><span>Organisation address</span><input type="text" aria-label="Organisation address" name="slug" /></label>
<label class="field"><span>Organisation name</span><input type="text" aria-label="Organisation name" name="name" /></label>
<button type="submit" class="primary">Create organisation</button>
</form>
</section>
<section class="card formcard" id="create-repo">
<h2>Create a repository</h2>
<form data-form="repo" class="stack">
<label class="field"><span>Organisation</span><select aria-label="Organisation" name="org">${orgs
    .map((org) => `<option value="${attr(org.slug)}">${escapeHtml(org.slug)}</option>`)
    .join('')}</select></label>
<label class="field"><span>Repository name</span><input type="text" aria-label="Repository name" name="name" /></label>
<label class="field"><span>Visibility</span><select aria-label="Visibility" name="visibility"><option value="private">Private</option><option value="public">Public</option></select></label>
<button type="submit" class="primary">Create repository</button>
</form>
</section>`;
  return page({ title: 'Repositories', user, serviceStatusOk }, main);
}

export async function orgPage(tx: Db, user: UserRow, slug: string, serviceStatusOk: boolean): Promise<string> {
  const orgs = await tx.query<{ id: string; name: string }>('SELECT id, name FROM rs_orgs WHERE slug = $1', [slug]);
  if (orgs.length === 0) return '';
  const teams = await tx.query<{ id: string; name: string }>(
    'SELECT id, name FROM rs_teams WHERE org_id = $1 ORDER BY name',
    [orgs[0].id],
  );
  const blocks: string[] = [];
  for (const team of teams) {
    const members = await tx.query<{ username: string; name: string }>(
      `SELECT u.username, u.name FROM rs_team_members m JOIN rs_users u ON u.id = m.user_id
       WHERE m.team_id = $1 ORDER BY u.username`,
      [team.id],
    );
    blocks.push(`<section class="card list">
<h3>${escapeHtml(team.name)}</h3>
<ul class="rows">${members
      .map((member) => `<li class="listrow">${escapeHtml(member.name)} <span class="muted">${escapeHtml(member.username)}</span></li>`)
      .join('')}</ul>
<form data-form="team-member" data-team="${attr(team.name)}" class="stack">
<label class="field"><span>Username to add to ${escapeHtml(team.name)}</span><input type="text" aria-label="Username to add to ${attr(
      team.name,
    )}" name="username" /></label>
<button type="submit" class="flat">Add to ${escapeHtml(team.name)}</button>
</form>
</section>`);
  }

  const main = `<h1>${escapeHtml(orgs[0].name)}</h1>
${blocks.join('')}
<section class="card formcard">
<h2>Create a team</h2>
<form data-form="team" class="stack">
<label class="field"><span>Team name</span><input type="text" aria-label="Team name" name="name" /></label>
<button type="submit" class="primary">Create team</button>
</form>
</section>`;
  return page({ title: slug, user, serviceStatusOk }, main);
}

export async function repoOverviewPage(
  tx: Db,
  user: UserRow,
  repo: RepoRow,
  role: Role,
  branch: string,
  serviceStatusOk: boolean,
): Promise<string> {
  const branches = await listBranches(tx, repo.id);
  const chosen = branches.find((item) => item.name === branch) ?? branches.find((item) => item.name === repo.defaultBranch)!;
  const snapshot = await getSnapshot(tx, repo.id, chosen.revision);
  const changes = await listChanges(tx, repo.id);
  const revisions = await tx.query<{ id: string; message: string; created_at: Date }>(
    'SELECT id, message, created_at FROM rs_revisions WHERE repo_id = $1 ORDER BY created_at DESC, id LIMIT 8',
    [repo.id],
  );

  const main = `<h1>${escapeHtml(repo.org)}/${escapeHtml(repo.name)}</h1>
<div class="bento overviewcards">
<section class="card">
<h2>Files</h2>
<form class="inline" data-form="branch-pick">
<label class="field"><span>Branch</span><select aria-label="Branch" name="branch">${branches
    .map(
      (item) =>
        `<option value="${attr(item.name)}"${item.name === chosen.name ? ' selected' : ''}>${escapeHtml(item.name)}</option>`,
    )
    .join('')}</select></label>
</form>
<ul class="rows" role="list" aria-label="Files">${sortedPaths(snapshot.keys())
    .map(
      (path) =>
        `<li><a href="/${attr(repo.org)}/${attr(repo.name)}/blob/${attr(chosen.name)}/${attr(path)}" class="mono">${escapeHtml(
          path,
        )}</a></li>`,
    )
    .join('')}</ul>
</section>
<section class="card">
<h2>Open changes</h2>
<ul class="rows" role="list" aria-label="Open changes">${changes
    .filter((change) => change.state !== 'merged')
    .map(
      (change) =>
        `<li class="listrow">${statusBar(STATE_WORDS[change.state] ?? change.state)}<a href="/${attr(repo.org)}/${attr(
          repo.name,
        )}/changes/${change.number}">#${change.number} ${escapeHtml(change.title)}</a></li>`,
    )
    .join('')}</ul>
<a class="arrow" href="/${attr(repo.org)}/${attr(repo.name)}/changes/new">New change</a>
</section>
<section class="card">
<h2>Recent revisions</h2>
<ul class="rows" role="list" aria-label="Recent revisions">${revisions
    .map(
      (revision) =>
        `<li><a class="mono" href="/${attr(repo.org)}/${attr(repo.name)}/revisions/${attr(revision.id)}">${escapeHtml(
          revision.id,
        )}</a> <span class="muted">${escapeHtml(revision.message)}</span></li>`,
    )
    .join('')}</ul>
</section>
<section class="card">
<h2>Merge rules</h2>
<p class="chips"><span class="chip">Approvals: ${repo.requiredApprovals}</span><span class="chip">Checks: ${
    repo.requiredChecks.length === 0 ? 'none' : escapeHtml(repo.requiredChecks.join(', '))
  }</span><span class="chip">Merge queue: ${repo.queueOn ? 'on' : 'off'}</span></p>
<p class="links"><a href="/${attr(repo.org)}/${attr(repo.name)}/changes">Changes</a> <a href="/${attr(repo.org)}/${attr(
    repo.name,
  )}/queue">Merge queue</a> ${
    ROLE_RANK[role] >= ROLE_RANK.maintainer
      ? `<a href="/${attr(repo.org)}/${attr(repo.name)}/settings">Settings</a>`
      : ''
  }</p>
</section>
</div>`;
  return page({ title: `${repo.org}/${repo.name}`, user, serviceStatusOk }, main);
}

export function filePage(
  user: UserRow,
  repo: RepoRow,
  branch: string,
  path: string,
  text: string | null,
  outage: string | null,
  serviceStatusOk: boolean,
): string {
  const bytes = text === null ? 0 : Buffer.from(text, 'utf8').length;
  const main = `<h1 class="mono">${escapeHtml(path)}</h1>
<p class="muted">${escapeHtml(repo.org)}/${escapeHtml(repo.name)} at ${escapeHtml(branch)}</p>
<p class="links"><a href="/${attr(repo.org)}/${attr(repo.name)}/raw/${attr(branch)}/${attr(path)}">Raw</a>
<a href="/${attr(repo.org)}/${attr(repo.name)}/edit/${attr(branch)}/${attr(path)}">Edit file</a></p>
${
  outage
    ? ''
    : `<section class="card"><pre class="mono filecontent" role="region" aria-label="File content" data-byte-length="${bytes}">${escapeHtml(
        text ?? '',
      )}</pre></section>`
}`;
  return page({ title: path, user, announcement: outage, serviceStatusOk }, main);
}

export function editorPage(
  user: UserRow,
  repo: RepoRow,
  branch: string,
  path: string,
  text: string | null,
  head: string,
  outage: string | null,
  serviceStatusOk: boolean,
): string {
  const main = `<h1 class="mono">${escapeHtml(path)}</h1>
<section class="card formcard editor" data-branch="${attr(branch)}" data-path="${attr(path)}" data-expected-head="${attr(
    head,
  )}" data-repo="${attr(`${repo.org}/${repo.name}`)}">
<label class="field"><span>File content</span><textarea aria-label="File content" data-editor-content rows="18">${escapeHtml(
    text ?? '',
  )}</textarea></label>
<label class="field"><span>Revision message</span><input type="text" aria-label="Revision message" data-editor-message /></label>
<div class="row"><button type="button" class="primary" data-editor-save>Save file</button>
<a class="flat" href="/${attr(repo.org)}/${attr(repo.name)}/blob/${attr(branch)}/${attr(path)}">Cancel</a></div>
<div data-editor-notice></div>
</section>`;
  return page({ title: `Edit ${path}`, user, announcement: outage, serviceStatusOk }, main);
}

export async function revisionPage(
  tx: Db,
  user: UserRow,
  repo: RepoRow,
  revisionId: string,
  texts: Map<string, string> | null,
  outage: string | null,
  role: Role,
  serviceStatusOk: boolean,
): Promise<string> {
  const revision = (await getRevision(tx, repo.id, revisionId))!;
  const snapshot = await getSnapshot(tx, repo.id, revisionId);
  const files = sortedPaths(snapshot.keys());
  const main = `<h1 class="mono">${escapeHtml(revision.id)}</h1>
<section class="card">
<p>${escapeHtml(revision.message)}</p>
<p class="muted">${escapeHtml(revision.authorUsername)} • ${timeElement(revision.createdAt)}</p>
<p class="muted mono">parents: ${revision.parents.length === 0 ? 'none' : escapeHtml(revision.parents.join(', '))}</p>
${ROLE_RANK[role] >= ROLE_RANK.maintainer ? '<button type="button" class="flat" data-export-archive>Export archive</button>' : ''}
</section>
${
  outage
    ? ''
    : files
        .map(
          (path) => `<section class="card">
<h2 class="mono">${escapeHtml(path)}</h2>
<pre class="mono filecontent" role="region" aria-label="File content" data-byte-length="${
            Buffer.from(texts?.get(path) ?? '', 'utf8').length
          }">${escapeHtml(texts?.get(path) ?? '')}</pre>
</section>`,
        )
        .join('')
}`;
  return page(
    { title: revision.id, user, announcement: outage, serviceStatusOk, bodyClass: `revision-${revision.id}` },
    main,
  );
}

export async function changesListPage(
  tx: Db,
  user: UserRow,
  repo: RepoRow,
  serviceStatusOk: boolean,
): Promise<string> {
  const changes = await listChanges(tx, repo.id);
  const main = `<h1>Changes</h1>
<p class="links"><a href="/${attr(repo.org)}/${attr(repo.name)}/changes/new">New change</a></p>
<section class="card list">
<ul class="rows" role="list" aria-label="Open changes">${changes
    .map(
      (change) =>
        `<li class="listrow">${statusBar(STATE_WORDS[change.state] ?? change.state)}<a href="/${attr(repo.org)}/${attr(
          repo.name,
        )}/changes/${change.number}">#${change.number} ${escapeHtml(change.title)}</a></li>`,
    )
    .join('')}</ul>
</section>`;
  return page({ title: 'Changes', user, serviceStatusOk }, main);
}

export async function newChangePage(
  tx: Db,
  user: UserRow,
  repo: RepoRow,
  serviceStatusOk: boolean,
): Promise<string> {
  const branches = await listBranches(tx, repo.id);
  const options = branches
    .map((branch) => `<option value="${attr(branch.name)}">${escapeHtml(branch.name)}</option>`)
    .join('');
  const main = `<h1>New change</h1>
<section class="card formcard">
<form data-form="change" data-repo="${attr(`${repo.org}/${repo.name}`)}" class="stack">
<label class="field"><span>Title</span><input type="text" aria-label="Title" name="title" /></label>
<label class="field"><span>Description</span><textarea aria-label="Description" name="description"></textarea></label>
<label class="field"><span>Head branch</span><select aria-label="Head branch" name="head">${options}</select></label>
<label class="field"><span>Base branch</span><select aria-label="Base branch" name="base">${options}</select></label>
<label class="checkboxfield"><input type="checkbox" aria-label="Open as draft" name="draft" /><span>Open as draft</span></label>
<button type="submit" class="primary">Create change</button>
</form>
</section>`;
  return page({ title: 'New change', user, serviceStatusOk }, main);
}

export async function settingsPage(
  tx: Db,
  user: UserRow,
  repo: RepoRow,
  serviceStatusOk: boolean,
): Promise<string> {
  const tokens = await tx.query<{ id: string; name: string; access: string }>(
    'SELECT id, name, access FROM rs_tokens WHERE repo_id = $1 ORDER BY id',
    [repo.id],
  );
  const members = await tx.query<{ subject_type: string; role: string; subject: string }>(
    `SELECT r.subject_type, r.role,
       COALESCE(u.username, '@' || o.slug || '/' || t.name) AS subject
     FROM rs_roles r
     LEFT JOIN rs_users u ON r.subject_type = 'user' AND u.id = r.subject_id
     LEFT JOIN rs_teams t ON r.subject_type = 'team' AND t.id = r.subject_id
     LEFT JOIN rs_orgs o ON o.id = t.org_id
     WHERE r.repo_id = $1 ORDER BY subject`,
    [repo.id],
  );

  const main = `<h1>Settings</h1>
<div class="settingspage" data-repo="${attr(`${repo.org}/${repo.name}`)}">
<section class="card formcard">
<h2>Merge rules</h2>
<form data-form="rules" class="stack">
<label class="field"><span>Required approvals</span><input type="number" min="0" max="10" aria-label="Required approvals" name="required_approvals" value="${
    repo.requiredApprovals
  }" /></label>
<label class="field"><span>Required checks</span><input type="text" aria-label="Required checks" name="required_checks" value="${attr(
    repo.requiredChecks.join(', '),
  )}" /></label>
<label class="checkboxfield"><input type="checkbox" aria-label="Use the merge queue" name="queue"${
    repo.queueOn ? ' checked' : ''
  } /><span>Use the merge queue</span></label>
<button type="submit" class="primary">Save rules</button>
</form>
</section>
<section class="card formcard">
<h2>Tokens</h2>
<form data-form="token" class="stack">
<label class="field"><span>Token name</span><input type="text" aria-label="Token name" name="name" /></label>
<label class="field"><span>Token access</span><select aria-label="Token access" name="access"><option value="read">Read</option><option value="write">Write</option></select></label>
<button type="submit" class="flat">Create token</button>
</form>
<div data-token-slot></div>
<ul class="rows" role="list" aria-label="Tokens">${tokens
    .map(
      (token) =>
        `<li class="listrow"><span>${escapeHtml(token.name)}</span><span class="muted">${escapeHtml(
          token.access,
        )}</span><button type="button" class="flat" data-revoke-token="${token.id}">Revoke ${escapeHtml(
          token.name,
        )}</button></li>`,
    )
    .join('')}</ul>
</section>
<section class="card formcard">
<h2>Members</h2>
<form data-form="role" class="stack">
<label class="field"><span>User or team</span><input type="text" aria-label="User or team" name="subject" /></label>
<label class="field"><span>Role</span><select aria-label="Role" name="role"><option value="reader">Reader</option><option value="writer">Writer</option><option value="maintainer">Maintainer</option><option value="owner">Owner</option></select></label>
<button type="submit" class="flat">Grant role</button>
</form>
<ul class="rows" role="list" aria-label="Members">${members
    .map(
      (member) =>
        `<li class="listrow"><span>${escapeHtml(member.subject)}</span><span class="muted">${escapeHtml(
          member.role,
        )}</span><button type="button" class="flat" data-remove-role="${attr(
          member.subject_type === 'team' ? `team:${member.subject.replace(/^@/, '')}` : `user:${member.subject}`,
        )}">Remove ${escapeHtml(member.subject)}</button></li>`,
    )
    .join('')}</ul>
</section>`;
  return page({ title: 'Settings', user, serviceStatusOk }, main);
}

async function entryChecksList(tx: Db, repo: RepoRow, entry: Awaited<ReturnType<typeof activeEntries>>[number]): Promise<string> {
  if (entry.revisionId === null) return '';
  const rows = await entryChecks(tx, repo, entry);
  return `<ul class="checks" role="list" aria-label="Checks">${rows
    .map(
      (row) => `<li data-check-name="${attr(row.name)}" data-state="${attr(row.state)}">
<span class="checkname mono">${escapeHtml(row.name)}</span><span class="checkstate">${escapeHtml(
        CHECK_STATE_WORDS[row.state],
      )}</span>${row.required ? '<span class="checkrequired">(required)</span>' : ''}${
        row.timeoutAt ? `<span class="checktimeout">Times out at ${timeElement(row.timeoutAt)}</span>` : ''
      }</li>`,
    )
    .join('')}</ul>`;
}

export async function renderQueueBody(tx: Db, repo: RepoRow, role: Role): Promise<string> {
  const entries = await activeEntries(tx, repo.id);
  const history = await historyEntries(tx, repo.id);
  const canMove = ROLE_RANK[role] >= ROLE_RANK.maintainer;

  const items: string[] = [];
  for (const [index, entry] of entries.entries()) {
    items.push(`<li class="queueentry" tabindex="0" data-queue-entry-id="${entry.id}" data-state="${attr(
      entry.state,
    )}" data-position="${entry.position ?? 0}" data-change-number="${entry.changeNumber}" data-anim="none">
<a href="/${attr(repo.org)}/${attr(repo.name)}/changes/${entry.changeNumber}">#${entry.changeNumber} ${escapeHtml(
      entry.changeTitle,
    )}</a>
<p>Position ${entry.position ?? 0}</p>
<p class="mono">Queue revision ${escapeHtml(entry.revisionId ?? '')}</p>
${await entryChecksList(tx, repo, entry)}
${
  canMove
    ? `<button type="button" class="flat" data-queue-move="up" data-entry="${entry.id}"${
        index === 0 ? ' disabled' : ''
      }>Move up</button>
<button type="button" class="flat" data-queue-move="down" data-entry="${entry.id}"${
        index === entries.length - 1 ? ' disabled' : ''
      }>Move down</button>`
    : ''
}
</li>`);
  }

  const rows = history
    .map(
      (entry) => `<tr data-queue-entry-id="${entry.id}" data-state="${attr(entry.state)}" data-change-number="${
        entry.changeNumber
      }" data-position="${entry.position ?? 0}" data-anim="none">
<td><a href="/${attr(repo.org)}/${attr(repo.name)}/changes/${entry.changeNumber}">#${entry.changeNumber}</a></td>
<td>${escapeHtml(entry.state)}</td>
<td>${entry.finishedAt ? timeElement(entry.finishedAt) : ''}</td>
<td>${escapeHtml(entry.reason ?? '')}</td>
</tr>`,
    )
    .join('');

  return `${
    items.length === 0
      ? '<p class="empty">The merge queue is empty.</p><a class="arrow" href="/' +
        attr(repo.org) +
        '/' +
        attr(repo.name) +
        '/changes">Back to changes →</a>'
      : `<ul class="queueentries" role="list" aria-label="Queue entries">${items.join('')}</ul>`
  }
<table class="queuehistory" aria-label="Queue history">
<thead><tr><th>Change</th><th>State</th><th>Time</th><th>Reason</th></tr></thead>
<tbody>${rows}</tbody>
</table>`;
}

export async function queuePage(
  tx: Db,
  user: UserRow,
  repo: RepoRow,
  role: Role,
  serviceStatusOk: boolean,
): Promise<string> {
  const main = `<h1>Merge queue</h1>
<div class="working queuepage" data-repo="${attr(`${repo.org}/${repo.name}`)}" data-page="queue">
<section class="stage" id="queue-stage">${await renderQueueBody(tx, repo, role)}</section>
</div>`;
  return page({ title: 'Merge queue', user, serviceStatusOk }, main);
}
