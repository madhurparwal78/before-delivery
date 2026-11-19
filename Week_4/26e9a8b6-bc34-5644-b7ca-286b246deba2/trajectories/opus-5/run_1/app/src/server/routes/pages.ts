import { config } from '../config.js';
import { redirect, sendHtml } from '../http/respond.js';
import { viewerOf } from '../http/context.js';
import type { Exchange, Route } from '../http/router.js';
import { accountStatus, pageText } from '../../shared/copy.js';
import { confirmWithToken } from '../domain/accounts.js';
import { renderDocument, type PageBootstrap } from '../render/layout.js';
import { renderReaderBody, type ReaderView } from '../render/reader.js';
import { renderEditorBody } from '../render/editor.js';
import {
  renderAuthBody,
  renderCollectionBody,
  renderDashboardBody,
  renderHomeBody,
  renderNoticeBody,
  renderSearchBody,
  type AuthKind,
} from '../render/screens.js';
import {
  coauthors,
  likedBy,
  loadGuide,
  maySee,
  mayEdit,
  readableSnapshot,
  readingJson,
  workingJson,
} from '../domain/guides.js';
import { loadCollection, loadDashboard, questionsForGuide } from '../domain/engagement.js';
import { searchGuides } from '../domain/search.js';
import { storageIsAnswering } from '../storage/health.js';
import { HOME_GUIDE_SLUG } from '../seed-data.js';
import type { SessionUser } from '../../shared/types.js';

export class PageNotFound extends Error {}
export class PageWithdrawn extends Error {}

/** A `next` that is not a local path lands on the dashboard after sign-in. */
export function localPathOrDashboard(next: string | null): string {
  if (next === null || next.length === 0) return '/dashboard';
  if (!next.startsWith('/')) return '/dashboard';
  if (next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(next)) return '/dashboard';
  return next;
}

function notFoundPage(exchange: Exchange): void {
  sendHtml(
    exchange.res,
    exchange.isEmbed,
    404,
    renderDocument({
      title: 'Not found',
      page: 'notice',
      body: renderNoticeBody(pageText.notFound),
      bootstrap: { page: 'notice' },
    }),
  );
}

function withdrawnPage(exchange: Exchange): void {
  sendHtml(
    exchange.res,
    exchange.isEmbed,
    410,
    renderDocument({
      title: 'Withdrawn',
      page: 'notice',
      body: renderNoticeBody(pageText.withdrawn),
      bootstrap: { page: 'notice' },
    }),
  );
}

async function readerView(
  exchange: Exchange,
  viewer: SessionUser | null,
  mode: 'reader' | 'embed',
): Promise<ReaderView> {
  const guide = await loadGuide(exchange.params['slug'] ?? '');
  if (guide === null) throw new PageNotFound();
  const editor = await mayEdit(guide, viewer);
  if (!(await maySee(guide, viewer))) throw new PageNotFound();
  if (mode === 'embed' && (guide.visibility === 'private' || guide.state === 'draft')) {
    throw new PageNotFound();
  }
  if (guide.state === 'withdrawn') throw new PageWithdrawn();
  if (guide.state === 'draft' && mode === 'reader' && !editor) throw new PageNotFound();

  const readable = await readableSnapshot(
    guide,
    mode === 'embed' ? null : viewer,
  );
  if (readable === null || readable.snapshot.steps.length === 0) throw new PageNotFound();

  const reading = await readingJson(guide, readable.snapshot);
  const asked = exchange.url.searchParams.get('step');
  const total = reading.step_count;
  const requested = asked === null ? null : Number(asked);
  const settled = requested !== null && Number.isFinite(requested);
  const step = settled ? Math.min(Math.max(Math.trunc(requested), 1), total) : 1;
  const pastTheEnd = settled && Math.trunc(requested) > total;

  const questions = await questionsForGuide(guide.id, null, config.limits.page_size_max);
  return {
    guide: reading,
    questions: questions.items,
    viewer: mode === 'embed' ? null : viewer,
    step,
    pastTheEnd,
    settled,
    liked: mode === 'embed' ? false : await likedBy(guide.id, viewer?.id ?? null),
    soundHidden: exchange.url.searchParams.get('sound') === 'off',
    storageOut: !storageIsAnswering(),
    mode,
  };
}

function readerBootstrap(view: ReaderView): PageBootstrap {
  return {
    page: view.mode,
    guide: view.guide,
    questions: view.questions,
    step: view.step,
    settled: view.settled,
    liked: view.liked,
    soundHidden: view.soundHidden,
    viewer: view.viewer,
    storageOut: view.storageOut,
    limits: config.limits,
  };
}

export const pageRoutes: Route[] = [
  {
    method: 'GET',
    path: '/',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const guide = await loadGuide(HOME_GUIDE_SLUG);
      const readable = guide === null ? null : await readableSnapshot(guide, viewer);
      const reading =
        guide === null || readable === null ? null : await readingJson(guide, readable.snapshot);
      sendHtml(
        exchange.res,
        exchange.isEmbed,
        200,
        renderDocument({
          title: 'Pennywasher',
          page: 'home',
          body: renderHomeBody(reading),
          bootstrap: { page: 'home', guide: reading, limits: config.limits },
          viewer,
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/g/:slug',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      try {
        const view = await readerView(exchange, viewer, 'reader');
        sendHtml(
          exchange.res,
          exchange.isEmbed,
          200,
          renderDocument({
            title: view.guide.title,
            page: 'reader',
            body: renderReaderBody(view),
            bootstrap: readerBootstrap(view),
            viewer,
          }),
        );
      } catch (error) {
        if (error instanceof PageWithdrawn) withdrawnPage(exchange);
        else if (error instanceof PageNotFound) notFoundPage(exchange);
        else throw error;
      }
    },
  },
  {
    method: 'GET',
    path: '/embed/:slug',
    body: 'none',
    handle: async (exchange) => {
      try {
        const view = await readerView(exchange, null, 'embed');
        sendHtml(
          exchange.res,
          exchange.isEmbed,
          200,
          renderDocument({
            title: view.guide.title,
            page: 'embed',
            body: renderReaderBody(view),
            bootstrap: readerBootstrap(view),
            wordmark: false,
          }),
        );
      } catch (error) {
        if (error instanceof PageWithdrawn) withdrawnPage(exchange);
        else if (error instanceof PageNotFound) notFoundPage(exchange);
        else throw error;
      }
    },
  },
  {
    method: 'GET',
    path: '/edit/:slug',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const guide = await loadGuide(exchange.params['slug'] ?? '');
      if (guide === null || !(await mayEdit(guide, viewer)) || viewer === null) {
        if (viewer === null && guide !== null) {
          redirect(
            exchange.res,
            exchange.isEmbed,
            `/signin?next=${encodeURIComponent(exchange.url.pathname)}`,
          );
          return;
        }
        notFoundPage(exchange);
        return;
      }
      const working = await workingJson(guide);
      const body = renderEditorBody({
        working,
        viewer,
        owner: guide.owner_id === viewer.id,
        coauthors: await coauthors(guide.id),
        storageOut: !storageIsAnswering(),
      });
      sendHtml(
        exchange.res,
        exchange.isEmbed,
        200,
        renderDocument({
          title: working.title,
          page: 'editor',
          body,
          bootstrap: {
            page: 'editor',
            working,
            viewer,
            owner: guide.owner_id === viewer.id,
            storageOut: !storageIsAnswering(),
            limits: config.limits,
          },
          viewer,
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/dashboard',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      if (viewer === null) {
        redirect(exchange.res, exchange.isEmbed, '/signin?next=/dashboard');
        return;
      }
      const dashboard = await loadDashboard(viewer.id);
      const titles = new Map<string, string>();
      for (const question of dashboard.questions) {
        const guide = await loadGuide(question.guide_id);
        if (guide !== null) titles.set(question.guide_id, guide.title);
      }
      sendHtml(
        exchange.res,
        exchange.isEmbed,
        200,
        renderDocument({
          title: 'Dashboard',
          page: 'dashboard',
          body: renderDashboardBody(dashboard, titles),
          bootstrap: {
            page: 'dashboard',
            dashboard,
            viewer,
            titles: Object.fromEntries(titles),
            openStart: exchange.url.searchParams.get('start') === '1',
            limits: config.limits,
          },
          viewer,
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/search',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const q = exchange.url.searchParams.get('q') ?? '';
      const tags = exchange.url.searchParams.getAll('tag');
      const page = await searchGuides({
        q,
        tags,
        cursor: null,
        limit: config.limits.page_size_default,
      });
      sendHtml(
        exchange.res,
        exchange.isEmbed,
        200,
        renderDocument({
          title: 'Find a guide',
          page: 'search',
          body: renderSearchBody(page, q, tags),
          bootstrap: { page: 'search', results: page, q, tags, limits: config.limits },
          viewer,
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/c/:slug',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const collection = await loadCollection(exchange.params['slug'] ?? '', viewer?.id ?? null);
      if (collection === null) {
        notFoundPage(exchange);
        return;
      }
      const owner = collection.owner_id === viewer?.id;
      sendHtml(
        exchange.res,
        exchange.isEmbed,
        200,
        renderDocument({
          title: collection.title,
          page: 'collection',
          body: renderCollectionBody({
            title: collection.title,
            slug: collection.slug,
            owner,
            items: collection.items,
          }),
          bootstrap: {
            page: 'collection',
            collection: { id: collection.id, slug: collection.slug, items: collection.items },
            owner,
            viewer,
            limits: config.limits,
          },
          viewer,
        }),
      );
    },
  },
  ...(['signin', 'signup', 'confirm'] as AuthKind[]).map<Route>((kind) => ({
    method: 'GET',
    path: `/${kind}`,
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const token = exchange.url.searchParams.get('token');
      if (kind === 'confirm' && viewer === null && token === null) {
        redirect(exchange.res, exchange.isEmbed, '/signin?next=/confirm');
        return;
      }
      /*
       * Opening the link from the message needs no session: it confirms the
       * account without starting or ending one, and the token never reaches
       * the page beyond the address it was opened from.
       */
      let status = '';
      if (kind === 'confirm' && token !== null) {
        const outcome = await confirmWithToken(token);
        status = outcome === 'confirmed' ? accountStatus.confirmed : accountStatus.badToken;
      } else if (kind === 'confirm' && viewer !== null) {
        if (viewer.confirmed) status = accountStatus.confirmed;
        else if (exchange.url.searchParams.get('mail') === 'failed') status = accountStatus.mailFailed;
        else if (exchange.url.searchParams.get('sent') === '1') status = accountStatus.waiting(viewer.email);
      }
      sendHtml(
        exchange.res,
        exchange.isEmbed,
        200,
        renderDocument({
          title: kind === 'signup' ? 'Create an account' : kind === 'signin' ? 'Sign in' : 'Confirm your email',
          page: kind,
          body: renderAuthBody({
            kind,
            next: localPathOrDashboard(exchange.url.searchParams.get('next')),
            status,
            viewer,
          }),
          bootstrap: {
            page: kind,
            next: localPathOrDashboard(exchange.url.searchParams.get('next')),
            viewer,
            limits: config.limits,
          },
          viewer,
        }),
      );
    },
  })),
];

export function renderNotFoundHtml(): string {
  return renderDocument({
    title: 'Not found',
    page: 'notice',
    body: renderNoticeBody(pageText.notFound),
    bootstrap: { page: 'notice' },
  });
}

export function isPagePath(pathname: string): boolean {
  return !pathname.startsWith('/api/') && !pathname.startsWith('/assets/') && !pathname.startsWith('/samples/');
}
