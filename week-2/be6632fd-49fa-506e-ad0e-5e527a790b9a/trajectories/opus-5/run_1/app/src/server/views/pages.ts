import { readSession, ROLE_HOME, type Session } from '../auth.ts';
import { query, queryOne } from '../db/pool.ts';
import { isPublicStatus } from '../../domain/dropstate.ts';
import { isCurrency, marketCity, type Currency, type Market } from '../../domain/markets.ts';
import { previewLinkState } from '../../domain/previewstate.ts';
import { priceInForce } from '../../domain/pricing.ts';
import { copenhagenToday, formatInstant, formatMarketTime } from '../../domain/time.ts';
import type { Ctx } from '../http/context.ts';
import { Router } from '../http/router.ts';
import { sendText } from '../http/respond.ts';
import { loadLooks } from '../api/publicdrops.ts';
import { loadAllocationById, loadAllocations, loadPriceRows } from '../repo/allocations.ts';
import { loadDropById, loadDropBySlug, loadDrops, type DropRecord } from '../repo/drops.ts';
import { forgotPasswordPage, invitePage, resetPasswordPage, signInPage } from './account.ts';
import { canUseScreen } from './layout.ts';
import {
  calendarPage,
  claimPage,
  deadPreviewPage,
  dropPage,
  notFoundPage,
  optInPage,
  pressPage as publicPressPage,
  withdrawnDropPage,
} from './public.ts';
import { dropsPage, newDropPage, plannerPage } from './studiodrops.ts';
import {
  allocationPage,
  dropAllocationsPage,
  invoicingPage,
  lineSheetPage,
  myStorePage,
  priceListsPage,
  type LineSheetRow,
  type PriceListView,
} from './studiotrade.ts';
import {
  lookbookPage,
  pressPage as studioPressPage,
  previewsPage,
  storyPage,
} from './studiopress.ts';
import {
  membersPage,
  stockistPage,
  stockistsPage,
  type MemberView,
  type StockistDetail,
  type StockistView,
} from './studiodirectory.ts';

function sendHtml(ctx: Ctx, status: number, body: string): void {
  sendText(ctx.response, status, 'text/html; charset=utf-8', body, { 'cache-control': 'no-store' });
}

function redirect(ctx: Ctx, location: string): void {
  ctx.response.writeHead(302, { location, 'cache-control': 'no-store' }).end();
}

/** Staff screens need a session; the sign-in screen then returns to the asked-for path. */
async function staffSession(ctx: Ctx): Promise<Session | null> {
  const outcome = await readSession(ctx);
  if (outcome.kind !== 'ok') {
    redirect(ctx, `/sign-in?next=${encodeURIComponent(ctx.path)}`);
    return null;
  }
  if (!canUseScreen(outcome.session.role, ctx.path)) {
    redirect(ctx, ROLE_HOME[outcome.session.role]);
    return null;
  }
  return outcome.session;
}

async function staffDrop(ctx: Ctx, session: Session): Promise<DropRecord | null> {
  const drop = await loadDropById(ctx.params['id'] as string, session.workspaceId, ctx.nowMs);
  if (drop === null) {
    sendHtml(ctx, 404, notFoundPage());
    return null;
  }
  return drop;
}

const pageRouter = new Router()
  .add('/', { get: async (ctx) => sendHtml(ctx, 200, await calendarPage(ctx)) })
  .add('/drops/:slug', {
    get: async (ctx) => {
      const drop = await loadDropBySlug(ctx.params['slug'] as string, ctx.nowMs);
      if (drop === null) {
        sendHtml(ctx, 404, notFoundPage());
        return;
      }
      if (drop.status === 'withdrawn') {
        sendHtml(ctx, 410, withdrawnDropPage());
        return;
      }
      if (!isPublicStatus(drop.status)) {
        sendHtml(ctx, 404, notFoundPage());
        return;
      }
      sendHtml(ctx, 200, await dropPage(ctx, drop));
    },
  })
  .add('/claim/:holdToken', {
    get: async (ctx) => {
      const token = ctx.params['holdToken'] as string;
      const hold = await queryOne<{
        market: Market;
        expires_at_ms: number;
        status: string;
        drop_name: string;
      }>(
        `select h.market, h.expires_at_ms, h.status, d.name as drop_name
           from holds h join drops d on d.id = h.drop_id
          where h.token = $1`,
        [token],
      );
      if (hold === null) {
        sendHtml(ctx, 404, notFoundPage());
        return;
      }
      sendHtml(
        ctx,
        200,
        claimPage({
          token,
          dropName: hold.drop_name,
          market: hold.market,
          city: marketCity(hold.market),
          status: hold.status,
          expiresAtMs: Number(hold.expires_at_ms),
        }),
      );
    },
  })
  .add('/waitlist/confirm/:token', {
    get: async (ctx) => sendHtml(ctx, 200, optInPage(ctx.params['token'] as string)),
  })
  .add('/press/:token', { get: pressPreviewScreen })
  .add('/sign-in', {
    get: async (ctx) => {
      const outcome = await readSession(ctx);
      if (outcome.kind === 'ok') {
        redirect(ctx, ROLE_HOME[outcome.session.role]);
        return;
      }
      sendHtml(ctx, 200, signInPage(ctx.query('next')));
    },
  })
  .add('/forgot-password', { get: async (ctx) => sendHtml(ctx, 200, forgotPasswordPage()) })
  .add('/reset-password/:token', {
    get: async (ctx) => sendHtml(ctx, 200, resetPasswordPage(ctx.params['token'] as string)),
  })
  .add('/invite/:token', {
    get: async (ctx) => sendHtml(ctx, 200, invitePage(ctx.params['token'] as string)),
  })

  .add('/studio/drops', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const drops = await loadDrops('workspace_id = $1', [session.workspaceId], ctx.nowMs);
      sendHtml(ctx, 200, dropsPage(session, drops));
    },
  })
  .add('/studio/drops/new', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      sendHtml(ctx, 200, newDropPage(session));
    },
  })
  .add('/studio/drops/:id', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const drop = await staffDrop(ctx, session);
      if (drop === null) return;
      sendHtml(ctx, 200, await plannerPage(session, drop, ctx.nowMs));
    },
  })
  .add('/studio/drops/:id/allocations', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const drop = await staffDrop(ctx, session);
      if (drop === null) return;
      const allocations = await loadAllocations('a.drop_id = $1 and a.workspace_id = $2', [
        drop.id,
        session.workspaceId,
      ]);
      const stockists = await query<{ id: string; name: string }>(
        `select id, name from stockists where workspace_id = $1 and status = 'active' order by sort_key collate "C", id`,
        [session.workspaceId],
      );
      sendHtml(ctx, 200, dropAllocationsPage(session, drop, allocations, stockists));
    },
  })
  .add('/studio/allocations/:id', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const allocation = await loadAllocationById(ctx.params['id'] as string, session.workspaceId);
      if (
        allocation === null ||
        (session.role === 'stockist_buyer' && allocation.stockistId !== session.stockistId)
      ) {
        sendHtml(ctx, 404, notFoundPage());
        return;
      }
      sendHtml(ctx, 200, allocationPage(session, allocation));
    },
  })
  .add('/studio/invoicing', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const all = await loadAllocations('a.workspace_id = $1', [session.workspaceId]);
      sendHtml(
        ctx,
        200,
        invoicingPage(
          session,
          all.filter((allocation) => allocation.status === 'split'),
          all.filter((allocation) => allocation.status === 'confirmed'),
        ),
      );
    },
  })
  .add('/studio/price-lists', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const rows = await loadPriceRows(session.workspaceId);
      const lists = await query<{ id: string; name: string; effective_date: string }>(
        'select id, name, effective_date from price_lists where workspace_id = $1 order by effective_date, created_at_ms',
        [session.workspaceId],
      );
      const today = copenhagenToday(ctx.nowMs);
      const inForceIds = new Set(
        rows
          .map((row) => priceInForce(rows, row.styleNumber, row.currency, today))
          .filter((row): row is NonNullable<typeof row> => row !== null)
          .map((row) => row.listId),
      );
      const views: PriceListView[] = lists.map((list) => ({
        id: list.id,
        name: list.name,
        effectiveDate: list.effective_date,
        priceCount: rows.filter((row) => row.listId === list.id).length,
        inForce: inForceIds.has(list.id),
      }));
      sendHtml(ctx, 200, priceListsPage(session, views, ctx.nowMs));
    },
  })
  .add('/studio/drops/:id/line-sheet', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const drop = await staffDrop(ctx, session);
      if (drop === null) return;
      const currencyParam = ctx.query('currency');
      const currency: Currency = isCurrency(currencyParam) ? currencyParam : 'DKK';
      const rows = await loadPriceRows(session.workspaceId);
      const today = copenhagenToday(ctx.nowMs);
      const lines: LineSheetRow[] = drop.styles.map((style) => {
        const price = priceInForce(rows, style.styleNumber, currency, today);
        return {
          styleNumber: style.styleNumber,
          name: style.name,
          colour: style.colour,
          wholesaleEdition: style.wholesaleEdition,
          rrpDkkMinor: style.rrpDkkMinor,
          unitPriceMinor: price?.unitPriceMinor ?? null,
          priceListFrom: price?.effectiveDate ?? null,
        };
      });
      sendHtml(ctx, 200, lineSheetPage(session, drop, lines, currency));
    },
  })
  .add('/studio/drops/:id/lookbook', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const drop = await staffDrop(ctx, session);
      if (drop === null) return;
      const looks = await loadLooks(drop.id);
      const order = await queryOne<{ order_version: number }>(
        'select order_version from look_orders where drop_id = $1',
        [drop.id],
      );
      sendHtml(
        ctx,
        200,
        lookbookPage(
          session,
          drop,
          looks.map((look) => ({
            id: look.id,
            position: look.position + 1,
            title: look.title,
            altText: look.alt_text,
            width: look.width,
            height: look.height,
          })),
          Number(order?.order_version ?? 1),
        ),
      );
    },
  })
  .add('/studio/drops/:id/story', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const drop = await staffDrop(ctx, session);
      if (drop === null) return;
      const story = await queryOne<{ html: string; version: number; published_at_ms: number | null }>(
        'select html, version, published_at_ms from stories where drop_id = $1',
        [drop.id],
      );
      sendHtml(
        ctx,
        200,
        storyPage(session, drop, {
          html: story?.html ?? '',
          version: Number(story?.version ?? 1),
          publishedAt:
            story?.published_at_ms === null || story?.published_at_ms === undefined
              ? null
              : formatInstant(Number(story.published_at_ms)),
        }),
      );
    },
  })
  .add('/studio/press', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const drops = await loadDrops('workspace_id = $1', [session.workspaceId], ctx.nowMs);
      sendHtml(ctx, 200, studioPressPage(session, drops));
    },
  })
  .add('/studio/drops/:id/previews', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const drop = await staffDrop(ctx, session);
      if (drop === null) return;
      const rows = await query<{
        id: string;
        editor_name: string;
        outlet: string;
        expires_at_ms: number;
        revoked_at_ms: number | null;
        replaced_at_ms: number | null;
      }>(
        'select id, editor_name, outlet, expires_at_ms, revoked_at_ms, replaced_at_ms from previews where drop_id = $1 order by issued_at_ms desc',
        [drop.id],
      );
      sendHtml(
        ctx,
        200,
        previewsPage(
          session,
          drop,
          rows.map((row) => {
            const state = previewLinkState({
              revokedAtMs: row.revoked_at_ms === null ? null : Number(row.revoked_at_ms),
              replacedAtMs: row.replaced_at_ms === null ? null : Number(row.replaced_at_ms),
              expiresAtMs: Number(row.expires_at_ms),
              dropWithdrawn: drop.status === 'withdrawn',
              nowMs: ctx.nowMs,
            });
            return {
              id: row.id,
              editorName: row.editor_name,
              outlet: row.outlet,
              status: state === 'active' ? 'active' : state === 'revoked' ? 'revoked' : 'expired',
              expiresAtMs: Number(row.expires_at_ms),
            };
          }),
        ),
      );
    },
  })
  .add('/studio/stockists', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const active = await query<StockistRow>(
        `select * from stockists where workspace_id = $1 and status = 'active' order by sort_key collate "C", id limit 51`,
        [session.workspaceId],
      );
      const archived = await query<StockistRow>(
        `select * from stockists where workspace_id = $1 and status = 'archived' order by sort_key collate "C", id limit 50`,
        [session.workspaceId],
      );
      const page = active.slice(0, 25);
      const last = page[page.length - 1];
      const nextCursor =
        active.length > 25 && last !== undefined
          ? Buffer.from(JSON.stringify([last.sort_key, last.id]), 'utf8').toString('base64url')
          : null;
      sendHtml(
        ctx,
        200,
        stockistsPage(session, page.map(stockistView), archived.map(stockistView), nextCursor),
      );
    },
  })
  .add('/studio/stockists/:id', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const row = await queryOne<StockistRow>(
        `select * from stockists where id = $1 and workspace_id = $2 and status = 'active'`,
        [ctx.params['id'] as string, session.workspaceId],
      );
      if (row === null) {
        sendHtml(ctx, 404, notFoundPage());
        return;
      }
      const allocations = await loadAllocations('a.stockist_id = $1 and a.workspace_id = $2', [
        row.id,
        session.workspaceId,
      ]);
      sendHtml(ctx, 200, stockistPage(session, stockistDetail(row), allocations));
    },
  })
  .add('/studio/members', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const members = await query<MemberView>(
        `select id, name, email, role from members
          where workspace_id = $1 and removed_at_ms is null order by created_at_ms`,
        [session.workspaceId],
      );
      const stockists = await query<{ id: string; name: string }>(
        `select id, name from stockists where workspace_id = $1 and status = 'active' order by sort_key collate "C", id`,
        [session.workspaceId],
      );
      sendHtml(ctx, 200, membersPage(session, members, stockists));
    },
  })
  .add('/studio/my-store', {
    get: async (ctx) => {
      const session = await staffSession(ctx);
      if (session === null) return;
      const stockist = await queryOne<StockistRow>('select * from stockists where id = $1', [
        session.stockistId,
      ]);
      if (stockist === null) {
        sendHtml(ctx, 404, notFoundPage());
        return;
      }
      const drops = (await loadDrops('workspace_id = $1', [session.workspaceId], ctx.nowMs)).filter(
        (drop) => isPublicStatus(drop.status),
      );
      const allocations = await loadAllocations('a.stockist_id = $1', [stockist.id]);
      sendHtml(
        ctx,
        200,
        myStorePage(session, {
          stockistName: stockist.name,
          openDrops: drops.map((drop) => ({
            id: drop.id,
            name: drop.name,
            styles: drop.styles.map((style) => ({
              styleNumber: style.styleNumber,
              edition: style.wholesaleEdition,
            })),
          })),
          allocations,
        }),
      );
    },
  });

interface StockistRow {
  id: string;
  name: string;
  market: Market;
  currency: Currency;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_erased: boolean;
  notes: string;
  status: 'active' | 'archived';
  sort_key: string;
}

function stockistView(row: StockistRow): StockistView {
  return {
    id: row.id,
    name: row.name,
    market: row.market,
    contactName: row.contact_name,
    contactErased: row.contact_erased,
    status: row.status,
  };
}

function stockistDetail(row: StockistRow): StockistDetail {
  return {
    id: row.id,
    name: row.name,
    market: row.market,
    currency: row.currency,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    contactErased: row.contact_erased,
    notes: row.notes,
  };
}

async function pressPreviewScreen(ctx: Ctx): Promise<void> {
  const token = ctx.params['token'] as string;
  const preview = await queryOne<{
    id: string;
    drop_id: string;
    token: string;
    expires_at_ms: number;
    revoked_at_ms: number | null;
    replaced_at_ms: number | null;
  }>('select * from previews where token = $1', [token]);
  if (preview === null) {
    sendHtml(ctx, 404, notFoundPage());
    return;
  }
  const drops = await loadDrops('id = $1', [preview.drop_id], ctx.nowMs);
  const drop = drops[0];
  if (drop === undefined) {
    sendHtml(ctx, 404, notFoundPage());
    return;
  }
  const state = previewLinkState({
    revokedAtMs: preview.revoked_at_ms === null ? null : Number(preview.revoked_at_ms),
    replacedAtMs: preview.replaced_at_ms === null ? null : Number(preview.replaced_at_ms),
    expiresAtMs: Number(preview.expires_at_ms),
    dropWithdrawn: drop.status === 'withdrawn',
    nowMs: ctx.nowMs,
  });
  if (state !== 'active') {
    sendHtml(ctx, 410, deadPreviewPage(state));
    return;
  }

  const brand = await queryOne<{ name: string }>('select name from workspaces where id = $1', [
    drop.workspaceId,
  ]);
  const story = await queryOne<{ published_html: string | null }>(
    'select published_html from stories where drop_id = $1',
    [drop.id],
  );
  const looks = await loadLooks(drop.id);
  sendHtml(
    ctx,
    200,
    publicPressPage({
      token,
      brand: brand?.name ?? '',
      dropName: drop.name,
      embargoLine:
        drop.goLiveAtMs === null
          ? 'Embargoed until the drop opens'
          : `Embargoed until ${formatMarketTime(drop.goLiveAtMs, 'copenhagen')}`,
      markets: drop.markets.map((market) => ({
        city: market.city,
        opens: market.goLiveAtMs === null ? '—' : formatMarketTime(market.goLiveAtMs, market.market),
      })),
      storyHtml: story?.published_html ?? '',
      looks: looks.map((look) => ({
        id: look.id,
        position: look.position + 1,
        title: look.title,
        altText: look.alt_text,
        width: look.width,
        height: look.height,
      })),
    }),
  );
}

export async function renderPage(ctx: Ctx): Promise<void> {
  const match = pageRouter.match(ctx.path, 'GET');
  if (match === null || match.handler === null) {
    sendHtml(ctx, 404, notFoundPage());
    return;
  }
  ctx.params = match.params;
  await match.handler(ctx);
}
