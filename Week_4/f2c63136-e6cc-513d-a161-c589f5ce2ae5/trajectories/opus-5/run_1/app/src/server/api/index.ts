import { db } from '../db.js';
import { notFound } from '../errors.js';
import { addSubscriber, removeSubscriber, type PageContext } from '../live.js';
import { repoAccess, type Ctx } from '../http.js';
import {
  handleAddTeamMember,
  handleConfirm,
  handleCreateOrg,
  handleCreateRepo,
  handleCreateTeam,
  handleHealth,
  handleListRepos,
  handleLogin,
  handleLogout,
  handleMe,
  handleSignup,
} from './accounts.js';
import {
  handleArchive,
  handleChecks,
  handleCreateToken,
  handleGetBranch,
  handleGetRepo,
  handleGetRevision,
  handleGrantRole,
  handlePush,
  handleRemoveRole,
  handleRevisionFile,
  handleRevokeToken,
  handleSettings,
} from './repos.js';
import {
  handleApplySuggestions,
  handleChangeDiff,
  handleCreateChange,
  handleCreateReview,
  handleCreateThread,
  handleDismissReview,
  handleGetChange,
  handleGetQueue,
  handleListChanges,
  handleMerge,
  handleQueueChange,
  handleQueuePosition,
  handleReady,
  handleReply,
  handleReviewRequest,
  handleThreadState,
  handleViewed,
} from './changes.js';
import { handleGradingClock, handleGradingSetup } from './grading.js';

function number(value: string): number {
  if (!/^\d+$/.test(value)) throw notFound();
  return Number.parseInt(value, 10);
}

async function handleLive(ctx: Ctx, org: string, name: string): Promise<void> {
  const access = await repoAccess(db, ctx, org, name, 'read', { tokensAllowed: false });
  const pageKind = ctx.url.searchParams.get('page');
  const changeNumber = ctx.url.searchParams.get('change');
  const page: PageContext =
    pageKind === 'queue' ? { kind: 'queue' } : { kind: 'change', number: Number(changeNumber ?? '0') };

  ctx.response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  ctx.response.write('retry: 1000\n\n');
  const id = addSubscriber(access.repo.id, access.user ? access.user.id : null, page, ctx.response);
  ctx.request.on('close', () => removeSubscriber(id));
}

/** Routes every /api address, answering 404 for the unknown ones. */
export async function handleApi(ctx: Ctx): Promise<void> {
  const [, ...rest] = ctx.segments;
  const method = ctx.method;
  const at = (index: number) => rest[index] ?? '';

  if (rest.length === 1) {
    if (at(0) === 'health' && method === 'GET') return handleHealth(ctx);
    if (at(0) === 'signup' && method === 'POST') return handleSignup(ctx);
    if (at(0) === 'confirm' && method === 'POST') return handleConfirm(ctx);
    if (at(0) === 'login' && method === 'POST') return handleLogin(ctx);
    if (at(0) === 'logout' && method === 'POST') return handleLogout(ctx);
    if (at(0) === 'me' && method === 'GET') return handleMe(ctx);
    if (at(0) === 'orgs' && method === 'POST') return handleCreateOrg(ctx);
    if (at(0) === 'repos' && method === 'GET') return handleListRepos(ctx);
    throw notFound();
  }

  if (at(0) === 'grading') {
    if (at(1) === 'setup' && method === 'POST') return handleGradingSetup(ctx);
    if (at(1) === 'clock' && method === 'POST') return handleGradingClock(ctx);
    throw notFound();
  }

  if (at(0) === 'orgs') {
    const org = at(1);
    if (at(2) === 'teams' && rest.length === 3 && method === 'POST') return handleCreateTeam(ctx, org);
    if (at(2) === 'teams' && at(4) === 'members' && rest.length === 6 && method === 'PUT') {
      return handleAddTeamMember(ctx, org, at(3), at(5));
    }
    if (at(2) === 'repos' && rest.length === 3 && method === 'POST') return handleCreateRepo(ctx, org);
    throw notFound();
  }

  if (at(0) === 'live' && rest.length === 3 && method === 'GET') {
    return handleLive(ctx, at(1), at(2));
  }

  if (at(0) !== 'repos') throw notFound();

  const org = at(1);
  const name = at(2);
  if (org === '' || name === '') throw notFound();
  const tail = rest.slice(3);
  const part = (index: number) => tail[index] ?? '';

  if (tail.length === 0 && method === 'GET') return handleGetRepo(ctx, org, name);
  if (part(0) === 'settings' && tail.length === 1 && method === 'PUT') return handleSettings(ctx, org, name);
  if (part(0) === 'roles' && tail.length === 1 && method === 'PUT') return handleGrantRole(ctx, org, name);
  if (part(0) === 'roles' && tail.length === 2 && method === 'DELETE') {
    return handleRemoveRole(ctx, org, name, decodeURIComponent(part(1)));
  }
  if (part(0) === 'tokens' && tail.length === 1 && method === 'POST') return handleCreateToken(ctx, org, name);
  if (part(0) === 'tokens' && tail.length === 2 && method === 'DELETE') {
    return handleRevokeToken(ctx, org, name, String(number(part(1))));
  }
  if (part(0) === 'branches' && tail.length === 2 && method === 'GET') {
    return handleGetBranch(ctx, org, name, decodeURIComponent(part(1)));
  }
  if (part(0) === 'revisions' && tail.length === 2 && method === 'GET') return handleGetRevision(ctx, org, name, part(1));
  if (part(0) === 'revisions' && part(2) === 'files' && tail.length > 3 && method === 'GET') {
    return handleRevisionFile(ctx, org, name, part(1), tail.slice(3).map(decodeURIComponent).join('/'));
  }
  if (part(0) === 'revisions' && part(2) === 'archive' && tail.length === 3 && method === 'POST') {
    return handleArchive(ctx, org, name, part(1));
  }
  if (part(0) === 'push' && tail.length === 1 && method === 'POST') return handlePush(ctx, org, name);
  if (part(0) === 'checks' && tail.length === 1 && method === 'POST') return handleChecks(ctx, org, name);
  if (part(0) === 'queue' && tail.length === 1 && method === 'GET') return handleGetQueue(ctx, org, name);
  if (part(0) === 'queue' && part(2) === 'position' && tail.length === 3 && method === 'PUT') {
    return handleQueuePosition(ctx, org, name, number(part(1)));
  }
  if (part(0) === 'changes') {
    if (tail.length === 1 && method === 'POST') return handleCreateChange(ctx, org, name);
    if (tail.length === 1 && method === 'GET') return handleListChanges(ctx, org, name);
    if (tail.length === 2 && method === 'GET') return handleGetChange(ctx, org, name, number(part(1)));
    const changeNumber = number(part(1));
    if (part(2) === 'diff' && tail.length === 3 && method === 'GET') {
      return handleChangeDiff(ctx, org, name, changeNumber);
    }
    if (part(2) === 'ready' && tail.length === 3 && method === 'PUT') return handleReady(ctx, org, name, changeNumber);
    if (part(2) === 'review-requests' && tail.length === 3 && method === 'POST') {
      return handleReviewRequest(ctx, org, name, changeNumber);
    }
    if (part(2) === 'threads' && tail.length === 3 && method === 'POST') {
      return handleCreateThread(ctx, org, name, changeNumber);
    }
    if (part(2) === 'threads' && part(4) === 'replies' && tail.length === 5 && method === 'POST') {
      return handleReply(ctx, org, name, changeNumber, number(part(3)));
    }
    if (part(2) === 'threads' && part(4) === 'state' && tail.length === 5 && method === 'PUT') {
      return handleThreadState(ctx, org, name, changeNumber, number(part(3)));
    }
    if (part(2) === 'suggestions' && part(3) === 'apply' && tail.length === 4 && method === 'POST') {
      return handleApplySuggestions(ctx, org, name, changeNumber);
    }
    if (part(2) === 'reviews' && tail.length === 3 && method === 'POST') {
      return handleCreateReview(ctx, org, name, changeNumber);
    }
    if (part(2) === 'reviews' && part(4) === 'dismiss' && tail.length === 5 && method === 'POST') {
      return handleDismissReview(ctx, org, name, changeNumber, number(part(3)));
    }
    if (part(2) === 'viewed' && tail.length === 3 && method === 'PUT') return handleViewed(ctx, org, name, changeNumber);
    if (part(2) === 'merge' && tail.length === 3 && method === 'POST') return handleMerge(ctx, org, name, changeNumber);
    if (part(2) === 'queue' && tail.length === 3 && method === 'POST') {
      return handleQueueChange(ctx, org, name, changeNumber);
    }
    throw notFound();
  }

  throw notFound();
}
