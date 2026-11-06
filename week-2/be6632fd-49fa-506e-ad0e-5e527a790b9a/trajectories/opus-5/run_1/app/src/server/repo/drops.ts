import { query, type Transaction } from '../db/pool.ts';
import {
  marketCity,
  MARKETS,
  type Market,
} from '../../domain/markets.ts';
import {
  marketStatusOf,
  piecesLeftOf,
  publicStatusOf,
  type DropStatus,
  type MarketStatus,
  type PublicDropStatus,
} from '../../domain/dropstate.ts';
import type { DropType } from '../../domain/golive.ts';
import {
  copenhagenWall,
  formatInstant,
  formatLocalDateTime,
  isoWeekOfInstant,
  weekLabel,
  weekValue,
} from '../../domain/time.ts';

export interface DropMarketRecord {
  market: Market;
  city: string;
  goLiveAtMs: number | null;
  storePieces: number;
  claimed: number;
  held: number;
  piecesLeft: number;
  status: MarketStatus;
}

export interface DropStyleRecord {
  styleNumber: string;
  name: string;
  colour: string;
  wholesaleEdition: number;
  rrpDkkMinor: number;
  position: number;
}

export interface DropRecord {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  type: DropType;
  status: DropStatus;
  holdSeconds: number;
  palette: string[];
  internalNote: string;
  goLiveAtMs: number | null;
  copenhagenGoLive: string | null;
  localGoLive: string | null;
  createdAtMs: number;
  withdrawnAtMs: number | null;
  markets: DropMarketRecord[];
  styles: DropStyleRecord[];
}

interface DropRow {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  type: DropType;
  status: DropStatus;
  hold_seconds: number;
  palette: string[];
  internal_note: string;
  go_live_at_ms: number | null;
  copenhagen_go_live: string | null;
  local_go_live: string | null;
  created_at_ms: number;
  withdrawn_at_ms: number | null;
}

interface MarketRow {
  drop_id: string;
  market: Market;
  go_live_at_ms: number | null;
  store_pieces: number;
  claimed: number;
  held: number;
}

interface StyleRow {
  drop_id: string;
  style_number: string;
  name: string;
  colour: string;
  wholesale_edition: number;
  rrp_dkk_minor: number;
  position: number;
}

const MARKET_ORDER = new Map(MARKETS.map((market, index) => [market, index]));

/**
 * Loads drops with each market's claims and live holds counted in Postgres, so pieces left are
 * exact on every surface and in every app copy.
 */
export async function loadDrops(
  where: string,
  values: readonly unknown[],
  nowMs: number,
): Promise<DropRecord[]> {
  const drops = await query<DropRow>(`select * from drops where ${where} order by created_at_ms`, values);
  if (drops.length === 0) return [];
  const ids = drops.map((drop) => drop.id);

  const markets = await query<MarketRow>(
    `select dm.drop_id, dm.market, dm.go_live_at_ms, dm.store_pieces,
            (select count(*) from claims c where c.drop_id = dm.drop_id and c.market = dm.market) as claimed,
            (select count(*) from holds h
              where h.drop_id = dm.drop_id and h.market = dm.market
                and h.status = 'offered' and h.expires_at_ms > $2) as held
       from drop_markets dm
      where dm.drop_id = any($1)`,
    [ids, nowMs],
  );
  const styles = await query<StyleRow>(
    `select * from drop_styles where drop_id = any($1) order by position`,
    [ids],
  );

  return drops.map((row) => {
    const marketRows = markets
      .filter((market) => market.drop_id === row.id)
      .sort(
        (a, b) => (MARKET_ORDER.get(a.market) ?? 0) - (MARKET_ORDER.get(b.market) ?? 0),
      );
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      slug: row.slug,
      name: row.name,
      type: row.type,
      status: row.status,
      holdSeconds: row.hold_seconds,
      palette: row.palette,
      internalNote: row.internal_note,
      goLiveAtMs: row.go_live_at_ms === null ? null : Number(row.go_live_at_ms),
      copenhagenGoLive: row.copenhagen_go_live,
      localGoLive: row.local_go_live,
      createdAtMs: Number(row.created_at_ms),
      withdrawnAtMs: row.withdrawn_at_ms === null ? null : Number(row.withdrawn_at_ms),
      markets: marketRows.map((market): DropMarketRecord => {
        const goLiveAtMs = market.go_live_at_ms === null ? null : Number(market.go_live_at_ms);
        const claimed = Number(market.claimed);
        const held = Number(market.held);
        return {
          market: market.market,
          city: marketCity(market.market),
          goLiveAtMs,
          storePieces: market.store_pieces,
          claimed,
          held,
          piecesLeft: piecesLeftOf(market.store_pieces, claimed, held),
          status: marketStatusOf({ goLiveAtMs, nowMs, storePieces: market.store_pieces, claimed }),
        };
      }),
      styles: styles
        .filter((style) => style.drop_id === row.id)
        .map((style) => ({
          styleNumber: style.style_number,
          name: style.name,
          colour: style.colour,
          wholesaleEdition: style.wholesale_edition,
          rrpDkkMinor: Number(style.rrp_dkk_minor),
          position: style.position,
        })),
    };
  });
}

export async function loadDropById(
  dropId: string,
  workspaceId: string,
  nowMs: number,
): Promise<DropRecord | null> {
  const drops = await loadDrops('id = $1 and workspace_id = $2', [dropId, workspaceId], nowMs);
  return drops[0] ?? null;
}

export async function loadDropBySlug(slug: string, nowMs: number): Promise<DropRecord | null> {
  const drops = await loadDrops('slug = $1', [slug], nowMs);
  return drops[0] ?? null;
}

export function staffDropShape(drop: DropRecord): Record<string, unknown> {
  return {
    id: drop.id,
    slug: drop.slug,
    name: drop.name,
    type: drop.type,
    status: drop.status,
    holdSeconds: drop.holdSeconds,
    palette: drop.palette,
    internalNote: drop.internalNote,
    goLiveAt: drop.goLiveAtMs === null ? null : formatInstant(drop.goLiveAtMs),
    copenhagenGoLive:
      drop.type === 'simultaneous' && drop.goLiveAtMs !== null
        ? formatLocalDateTime(copenhagenWall(drop.goLiveAtMs))
        : null,
    localGoLive: drop.type === 'rolling' ? drop.localGoLive : null,
    markets: drop.markets.map((market) => ({
      market: market.market,
      city: market.city,
      goLiveAt: market.goLiveAtMs === null ? null : formatInstant(market.goLiveAtMs),
      storePieces: market.storePieces,
      claimed: market.claimed,
      held: market.held,
      piecesLeft: market.piecesLeft,
      status: market.status,
    })),
    styles: drop.styles.map((style) => ({
      styleNumber: style.styleNumber,
      name: style.name,
      colour: style.colour,
      wholesaleEdition: style.wholesaleEdition,
      rrpDkkMinor: style.rrpDkkMinor,
    })),
    createdAt: formatInstant(drop.createdAtMs),
    withdrawnAt: drop.withdrawnAtMs === null ? null : formatInstant(drop.withdrawnAtMs),
  };
}

export function buyerDropShape(drop: DropRecord): Record<string, unknown> {
  return {
    id: drop.id,
    name: drop.name,
    status: drop.status,
    styles: drop.styles.map((style) => ({
      styleNumber: style.styleNumber,
      name: style.name,
      colour: style.colour,
    })),
  };
}

/** The drop's own earliest market instant, used for ordering and week grouping. */
export function earliestInstant(drop: DropRecord): number | null {
  const instants = drop.markets
    .map((market) => market.goLiveAtMs)
    .filter((instant): instant is number => instant !== null);
  return instants.length === 0 ? null : Math.min(...instants);
}

export function dropWeek(drop: DropRecord, market: Market | null): { value: string; label: string } | null {
  const instant =
    market === null
      ? earliestInstant(drop)
      : (drop.markets.find((entry) => entry.market === market)?.goLiveAtMs ?? null);
  if (instant === null) return null;
  const week = isoWeekOfInstant(instant);
  return { value: weekValue(week), label: weekLabel(week) };
}

export function dropPublicStatus(drop: DropRecord): PublicDropStatus {
  return publicStatusOf(drop.status);
}

export async function slugFor(name: string, tx: Transaction): Promise<string> {
  const base =
    name
      .normalize('NFD')
      .replace(/\p{Mn}+/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'drop';
  for (let suffix = 0; ; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const taken = await tx.queryOne('select 1 from drops where slug = $1', [candidate]);
    if (taken === null) return candidate;
  }
}
