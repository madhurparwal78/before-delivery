import { db, one, transaction, type Db } from '../db';
import { fail } from '../errors';
import { emit } from '../events';
import { endpoint, reply, type Signed } from '../http';
import { Fields } from '../input';
import { addGroup, addTab, loadNavigation, loadRedirects, lockVersion, moveGroup, movePage } from '../domain/navigation';
import { insertPage, loadPages, pageJson, removePage, requirePage, savedBy, writePage, type PageRow } from '../domain/pages';
import { planManualRedirect, planRename, rewriteLinks } from '../domain/redirects';
import { versionOfGroup, versionOfPage, versionScope, type VersionScope } from '../domain/scopes';
import { copy } from '../../shared/copy';
import { isPagePath, limits } from '../../shared/rules';
import type { NavigationJson, PageJson, RenameResult } from '../../shared/types';

async function announceNavigation(source: Db, versionId: string): Promise<NavigationJson> {
  const navigation = await loadNavigation(source, versionId);
  emit('navigation', navigation, { versionId });
  return navigation;
}

function announcePage(page: PageJson): void {
  emit('page', page, { versionId: page.versionId, pageId: page.id });
}

interface PageScope {
  version: VersionScope;
  page: PageRow;
}

async function pageScope(ctx: Signed): Promise<PageScope> {
  const id = ctx.params.pageId ?? '';
  const version = await versionOfPage(ctx.principal, id);
  return { version, page: await requirePage(db, id) };
}

export function pageRoutes(): void {
  endpoint('GET', '/api/pages/:pageId', {
    access: 'member',
    prepare: pageScope,
    handle: async (_ctx, { page }) => reply.json(200, pageJson(page)),
  });

  endpoint('POST', '/api/versions/:versionId/pages', {
    access: 'editor',
    body: 'json',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (ctx, version) => {
      const fields = new Fields(ctx.json);
      const title = fields.text('title', 200);
      const path = fields.text('path', 330, copy.badPath);
      const groupId = fields.text('groupId', 100);
      const id = await transaction(async (tx) => {
        await lockVersion(tx, version.id);
        if (path !== '' && (await one(tx, 'select 1 as x from pages where version_id = $1 and path = $2 and not removed', [version.id, path])) !== null) {
          throw fail.pathTaken(`/${path}`);
        }
        if (path !== '' && !isPagePath(path)) {
          fields.problems.path = copy.badPath;
        }
        if (groupId !== '' && (await one(tx, 'select 1 as x from groups where id = $1 and version_id = $2', [groupId, version.id])) === null) {
          fields.problems.groupId = 'Choose a group of this version.';
        }
        fields.check();
        return insertPage(tx, { versionId: version.id, groupId, path, title, source: '', userId: ctx.principal.user.id });
      });
      await announceNavigation(db, version.id);
      const created = pageJson(await requirePage(db, id));
      announcePage(created);
      return reply.json(201, created);
    },
  });

  endpoint('PUT', '/api/pages/:pageId', {
    access: 'editor',
    body: 'json',
    prepare: pageScope,
    handle: async (ctx, { page }) => {
      const fields = new Fields(ctx.json);
      const title = fields.text('title', 200);
      const source = fields.raw('source');
      const revision = fields.integer('revision', 1);
      if (Buffer.byteLength(source, 'utf8') > limits.source) {
        throw fail.tooLarge('A page source can have at most 200,000 bytes.');
      }
      if (page.removed) {
        throw fail.pageRemoved();
      }
      if (page.kind === 'reference' && source !== page.source) {
        throw fail.referencePage();
      }
      if (page.revision !== revision) {
        throw fail.revisionConflict(savedBy(page));
      }
      fields.check();
      if (!(await writePage(db, page.id, { path: page.path, title, source, userId: ctx.principal.user.id, revision }))) {
        throw fail.revisionConflict(savedBy(await requirePage(db, page.id)));
      }
      const saved = pageJson(await requirePage(db, page.id));
      announcePage(saved);
      return reply.json(200, saved);
    },
  });

  endpoint('POST', '/api/pages/:pageId/rename', {
    access: 'editor',
    body: 'json',
    prepare: pageScope,
    handle: async (ctx, scope) => {
      const fields = new Fields(ctx.json);
      const path = fields.text('path', 330, copy.badPath);
      const revision = fields.integer('revision', 1);
      const { page: seen, version } = scope;
      const outcome = await transaction(async (tx) => {
        await lockVersion(tx, version.id);
        await tx.query('select id from pages where version_id = $1 for update', [version.id]);
        const page = await requirePage(tx, seen.id);
        if (page.removed) {
          throw fail.pageRemoved();
        }
        if (page.revision !== revision) {
          throw fail.revisionConflict(savedBy(page));
        }
        if (path !== '' && path !== page.path && (await one(tx, 'select 1 as x from pages where version_id = $1 and path = $2 and not removed', [version.id, path])) !== null) {
          throw fail.pathTaken(`/${path}`);
        }
        if (path !== '' && !isPagePath(path)) {
          fields.problems.path = copy.badPath;
        }
        fields.check();
        const plan = planRename(await loadRedirects(tx, version.id), `/${page.path}`, `/${path}`);
        await tx.query('delete from redirects where version_id = $1', [version.id]);
        for (const redirect of plan.redirects) {
          await tx.query('insert into redirects (version_id, from_path, to_path, kind) values ($1, $2, $3, $4)', [version.id, redirect.from, redirect.to, redirect.kind]);
        }
        let linksRewritten = 0;
        const rewritten: string[] = [];
        for (const other of await loadPages(tx, version.id)) {
          const links = rewriteLinks(other.source, `/${page.path}`, `/${path}`);
          if (links.count > 0 || other.id === page.id) {
            linksRewritten += links.count;
            await writePage(tx, other.id, { path: other.id === page.id ? path : other.path, title: other.title, source: links.source, userId: ctx.principal.user.id });
            rewritten.push(other.id);
          }
        }
        return { plan, linksRewritten, rewritten };
      });
      const navigation = await announceNavigation(db, version.id);
      for (const id of outcome.rewritten) {
        announcePage(pageJson(await requirePage(db, id)));
      }
      const result: RenameResult = {
        page: pageJson(await requirePage(db, seen.id)),
        navigation,
        linksRewritten: outcome.linksRewritten,
        redirectAdded: outcome.plan.added,
        redirectRemoved: outcome.plan.removed,
      };
      return reply.json(200, result);
    },
  });

  endpoint('DELETE', '/api/pages/:pageId', {
    access: 'editor',
    prepare: pageScope,
    handle: async (_ctx, { page, version }) => {
      if (page.removed) {
        throw fail.pageRemoved();
      }
      await transaction(async (tx) => {
        await lockVersion(tx, version.id);
        await removePage(tx, page);
      });
      await announceNavigation(db, version.id);
      const removed = pageJson(await requirePage(db, page.id));
      announcePage(removed);
      return reply.json(200, removed);
    },
  });

  endpoint('GET', '/api/versions/:versionId/navigation', {
    access: 'member',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (_ctx, version) => reply.json(200, await loadNavigation(db, version.id)),
  });

  endpoint('POST', '/api/versions/:versionId/tabs', {
    access: 'editor',
    body: 'json',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (ctx, version) => {
      const fields = new Fields(ctx.json);
      const title = fields.text('title', 100);
      fields.check();
      await transaction(async (tx) => {
        await lockVersion(tx, version.id);
        await addTab(tx, version.id, title);
      });
      return reply.json(201, await announceNavigation(db, version.id));
    },
  });

  endpoint('POST', '/api/versions/:versionId/groups', {
    access: 'editor',
    body: 'json',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (ctx, version) => {
      const fields = new Fields(ctx.json);
      const title = fields.text('title', 100);
      const tabId = fields.text('tabId', 100);
      if (tabId !== '' && (await one(db, 'select 1 as x from tabs where id = $1 and version_id = $2', [tabId, version.id])) === null) {
        fields.problems.tabId = 'Choose a tab of this version.';
      }
      fields.check();
      await transaction(async (tx) => {
        await lockVersion(tx, version.id);
        await addGroup(tx, version.id, tabId, title);
      });
      return reply.json(201, await announceNavigation(db, version.id));
    },
  });

  endpoint('POST', '/api/pages/:pageId/move', {
    access: 'editor',
    body: 'json',
    prepare: pageScope,
    handle: async (ctx, { page, version }) => {
      if (page.removed) {
        throw fail.pageRemoved();
      }
      const fields = new Fields(ctx.json);
      const groupId = fields.text('groupId', 100);
      const index = fields.integer('index');
      fields.check();
      await transaction(async (tx) => {
        await lockVersion(tx, version.id);
        await movePage(tx, version.id, page.id, groupId, index);
      });
      return reply.json(200, await announceNavigation(db, version.id));
    },
  });

  endpoint('POST', '/api/groups/:groupId/move', {
    access: 'editor',
    body: 'json',
    prepare: (ctx) => versionOfGroup(ctx.principal, ctx.params.groupId ?? ''),
    handle: async (ctx, version) => {
      const fields = new Fields(ctx.json);
      const tabId = fields.text('tabId', 100);
      const index = fields.integer('index');
      fields.check();
      await transaction(async (tx) => {
        await lockVersion(tx, version.id);
        await moveGroup(tx, version.id, ctx.params.groupId ?? '', tabId, index);
      });
      return reply.json(200, await announceNavigation(db, version.id));
    },
  });

  endpoint('POST', '/api/versions/:versionId/redirects', {
    access: 'editor',
    body: 'json',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (ctx, version) => {
      const fields = new Fields(ctx.json);
      const from = fields.text('from', 400, copy.badPath);
      const to = fields.text('to', 400, copy.badPath);
      fields.check();
      await transaction(async (tx) => {
        await lockVersion(tx, version.id);
        const live = new Set((await loadPages(tx, version.id)).map((page) => page.path));
        const redirect = planManualRedirect(await loadRedirects(tx, version.id), live, from, to);
        await tx.query("insert into redirects (version_id, from_path, to_path, kind) values ($1, $2, $3, 'manual')", [version.id, redirect.from, redirect.to]);
      });
      return reply.json(201, await announceNavigation(db, version.id));
    },
  });

  endpoint('DELETE', '/api/versions/:versionId/redirects', {
    access: 'editor',
    prepare: (ctx) => versionScope(ctx.principal, ctx.params.versionId ?? ''),
    handle: async (ctx, version) => {
      const removed = await db.query('delete from redirects where version_id = $1 and from_path = $2 returning id', [version.id, ctx.url.searchParams.get('from') ?? '']);
      if (removed.length === 0) {
        throw fail.notFound();
      }
      return reply.json(200, await announceNavigation(db, version.id));
    },
  });
}
