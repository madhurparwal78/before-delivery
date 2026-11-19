import type { ServerResponse } from 'node:http';
import { db } from '../db.js';
import { sendText, type Ctx } from '../http.js';
import { setFragmentRenderer, type Delivery, type LiveEvent, type Subscriber } from '../live.js';
import { lastStorageOk, PUSH_OUTAGE_MESSAGE, StorageUnavailable } from '../storage.js';
import { loadChangeView, loadChangeViewByNumber } from '../../domain/changeview.js';
import {
  getChange,
  getRepo,
  getUserById,
  roleFor,
  ROLE_RANK,
  type RepoRow,
  type Role,
  type UserRow,
} from '../../domain/model.js';
import { getBranchRevision, getRevision, getSnapshot, readFileBytes, readFileText } from '../../domain/revisions.js';
import { attr, page } from './layout.js';
import { confirmPage, loginPage, notFoundPage, signupPage } from './auth.js';
import { homePage } from './home.js';
import { loadFileDiffs, renderRail, renderStage } from './change.js';
import {
  changesListPage,
  editorPage,
  filePage,
  inboxPage,
  newChangePage,
  orgPage,
  queuePage,
  renderQueueBody,
  repoOverviewPage,
  reposPage,
  revisionPage,
  settingsPage,
} from './workspace.js';

function html(response: ServerResponse, status: number, markup: string): void {
  sendText(response, status, markup, 'text/html; charset=utf-8');
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location }).end();
}

async function changePage(
  user: UserRow,
  repo: RepoRow,
  role: Role,
  number: number,
): Promise<string | null> {
  const change = await getChange(db, repo.id, number);
  if (!change) return null;
  const view = await loadChangeView(db, repo, change, user.id);
  let outage: string | null = null;
  let diffs: Awaited<ReturnType<typeof loadFileDiffs>> = [];
  try {
    diffs = await loadFileDiffs(db, view);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    outage = PUSH_OUTAGE_MESSAGE;
  }

  const main = `<div class="working changepage" data-page="change" data-repo="${attr(
    `${repo.org}/${repo.name}`,
  )}" data-change-number="${number}" data-role="${attr(role)}" data-is-author="${
    change.authorUserId === user.id ? 'true' : 'false'
  }" data-viewer="${attr(user.username)}"">
<section class="stage" id="stage">${renderStage(view, diffs, outage)}</section>
<aside class="rail" id="rail">${renderRail(view, role)}</aside>
</div>`;
  return page(
    {
      title: `#${number} ${change.title}`,
      user,
      announcement: outage,
      serviceStatusOk: lastStorageOk(),
    },
    main,
  );
}

/** Live updates carry freshly rendered regions of the page the subscriber is on. */
export function registerFragmentRenderer(): void {
  setFragmentRenderer(async (subscriber: Subscriber, events: LiveEvent[]): Promise<Delivery> => {
    const user = subscriber.userId === null ? null : await getUserById(db, subscriber.userId);
    const repoRows = await db.query<{ org: string; name: string }>(
      'SELECT o.slug AS org, r.name FROM rs_repos r JOIN rs_orgs o ON o.id = r.org_id WHERE r.id = $1',
      [subscriber.repoId],
    );
    if (repoRows.length === 0 || user === null) return { events, fragments: {} };
    const repo = (await getRepo(db, repoRows[0].org, repoRows[0].name))!;
    const role = await roleFor(db, repo, user.id);
    if (role === null) return { events, fragments: {} };

    if (subscriber.page.kind === 'queue') {
      return { events, fragments: { queue: await renderQueueBody(db, repo, role) } };
    }
    const view = await loadChangeViewByNumber(db, repo, subscriber.page.number, user.id);
    if (!view) return { events, fragments: {} };
    const inStack = new Set(view.stack.map((row) => row.number));
    const mine = events.filter((event) => event.change === undefined || inStack.has(event.change));
    let diffs: Awaited<ReturnType<typeof loadFileDiffs>> = [];
    let outage: string | null = null;
    try {
      diffs = await loadFileDiffs(db, view);
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
      outage = PUSH_OUTAGE_MESSAGE;
    }
    return {
      events: mine,
      fragments: { stage: renderStage(view, diffs, outage), rail: renderRail(view, role) },
    };
  });
}

/** Renders every page address; anything the caller cannot see answers the not-found page. */
export async function handlePage(ctx: Ctx): Promise<void> {
  const user = ctx.caller && ctx.caller.kind === 'user' ? ctx.caller.user : null;
  const segments = ctx.segments;
  const response = ctx.response;
  const storageOk = lastStorageOk();
  const notFound = () => html(response, 404, notFoundPage());

  if (segments.length === 0) {
    if (user) return redirect(response, '/inbox');
    return html(response, 200, homePage(storageOk));
  }

  if (segments[0] === 'signup' && segments.length === 1) return html(response, 200, signupPage());
  if (segments[0] === 'login' && segments.length === 1) return html(response, 200, loginPage());
  if (segments[0] === 'confirm' && segments.length === 2) {
    return html(response, 200, confirmPage(decodeURIComponent(segments[1])));
  }

  if (!user) return redirect(response, '/login');

  if (segments[0] === 'inbox' && segments.length === 1) {
    return html(response, 200, await inboxPage(db, user, storageOk));
  }
  if (segments[0] === 'repos' && segments.length === 1) {
    return html(response, 200, await reposPage(db, user, storageOk));
  }

  if (segments.length === 1) {
    const markup = await orgPage(db, user, segments[0], storageOk);
    if (markup === '') return notFound();
    return html(response, 200, markup);
  }

  const repo = await getRepo(db, segments[0], segments[1]);
  if (!repo) return notFound();
  const role = await roleFor(db, repo, user.id);
  if (role === null) return notFound();
  const rest = segments.slice(2);

  if (rest.length === 0) {
    const branch = ctx.url.searchParams.get('branch') ?? repo.defaultBranch;
    return html(response, 200, await repoOverviewPage(db, user, repo, role, branch, storageOk));
  }

  if ((rest[0] === 'blob' || rest[0] === 'edit' || rest[0] === 'raw') && rest.length >= 3) {
    const branch = decodeURIComponent(rest[1]);
    const path = rest.slice(2).map(decodeURIComponent).join('/');
    const head = await getBranchRevision(db, repo.id, branch);
    if (head === null) return notFound();
    const snapshot = await getSnapshot(db, repo.id, head);
    if (!snapshot.has(path) && rest[0] !== 'edit') return notFound();
    let text: string | null = null;
    let outage: string | null = null;
    try {
      text = snapshot.has(path) ? await readFileText(db, repo.id, head, path) : '';
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
      outage = PUSH_OUTAGE_MESSAGE;
    }
    if (rest[0] === 'raw') {
      if (outage !== null) return html(response, 503, page({ title: 'Raw', user, announcement: outage }, ''));
      const bytes = await readFileBytes(db, repo.id, head, path);
      return sendText(response, 200, bytes ?? Buffer.alloc(0), 'text/plain; charset=utf-8');
    }
    if (rest[0] === 'edit') {
      if (ROLE_RANK[role] < ROLE_RANK.writer) return notFound();
      return html(response, 200, editorPage(user, repo, branch, path, outage ? '' : text, head, outage, storageOk));
    }
    return html(response, 200, filePage(user, repo, branch, path, text, outage, storageOk));
  }

  if (rest[0] === 'revisions' && rest.length === 2) {
    const revision = await getRevision(db, repo.id, rest[1]);
    if (!revision) return notFound();
    const snapshot = await getSnapshot(db, repo.id, revision.id);
    let texts: Map<string, string> | null = new Map();
    let outage: string | null = null;
    try {
      for (const path of snapshot.keys()) {
        texts.set(path, (await readFileText(db, repo.id, revision.id, path)) ?? '');
      }
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
      outage = PUSH_OUTAGE_MESSAGE;
      texts = null;
    }
    return html(
      response,
      200,
      await revisionPage(db, user, repo, revision.id, texts, outage, role, storageOk),
    );
  }

  if (rest[0] === 'changes') {
    if (rest.length === 1) return html(response, 200, await changesListPage(db, user, repo, storageOk));
    if (rest[1] === 'new') {
      if (ROLE_RANK[role] < ROLE_RANK.writer) return notFound();
      return html(response, 200, await newChangePage(db, user, repo, storageOk));
    }
    if (/^\d+$/.test(rest[1]) && rest.length === 2) {
      const markup = await changePage(user, repo, role, Number.parseInt(rest[1], 10));
      if (markup === null) return notFound();
      return html(response, 200, markup);
    }
    return notFound();
  }

  if (rest[0] === 'queue' && rest.length === 1) {
    return html(response, 200, await queuePage(db, user, repo, role, storageOk));
  }

  if (rest[0] === 'settings' && rest.length === 1) {
    if (ROLE_RANK[role] < ROLE_RANK.maintainer) return notFound();
    return html(response, 200, await settingsPage(db, user, repo, storageOk));
  }

  return notFound();
}
