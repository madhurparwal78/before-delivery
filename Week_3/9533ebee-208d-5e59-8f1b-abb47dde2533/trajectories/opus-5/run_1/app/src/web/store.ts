/**
 * The shared data every view shows, refreshed every 5 seconds and after every
 * action. Every value on screen is the last server value: the browser never
 * decides state, debt, health factor, grace, staleness or expiry from its own
 * clock.
 */

import { request } from './api.ts';
import type { MemberDto, PoolDto, PoolsDto, WalletDto } from './types.ts';
import type { Asset } from '../domain/assets.ts';

export const REFRESH_MS = 5000;

type Listener = () => void;

export class Store {
  member: MemberDto | null = null;
  token: string | null = null;
  actors: readonly MemberDto[] = [];
  pools: PoolsDto | null = null;
  wallet: WalletDto | null = null;
  /** The size of the liquidation queue, shown in the navigation badge. */
  queueSize = 0;

  private readonly listeners = new Set<Listener>();
  private timer: number | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  poolFor(asset: Asset): PoolDto | null {
    return this.pools?.pools.find((pool) => pool.asset === asset) ?? null;
  }

  decimalsOf(asset: Asset): number {
    return this.poolFor(asset)?.decimals ?? 0;
  }

  get deskTimeZone(): string {
    return this.pools?.desk_time_zone ?? 'UTC';
  }

  /** True while any market is stale, which is when the banner is shown. */
  get anyMarketStale(): boolean {
    return this.pools?.pools.some((pool) => pool.market_state === 'stale_feed') ?? false;
  }

  get staleAssets(): readonly PoolDto[] {
    return this.pools?.pools.filter((pool) => pool.market_state === 'stale_feed') ?? [];
  }

  async loadActors(): Promise<void> {
    const reply = await request<{ actors: MemberDto[] }>('GET', '/api/actors');
    this.actors = reply.actors;
    this.notify();
  }

  /** Refetches the shared data and tells every view to update in place. */
  async refresh(): Promise<void> {
    if (this.token === null) return;
    const [pools, wallet] = await Promise.all([
      request<PoolsDto>('GET', '/api/pools', { token: this.token }),
      request<WalletDto>('GET', '/api/wallet', { token: this.token }),
    ]);
    this.pools = pools;
    this.wallet = wallet;
    if (this.member?.role === 'liquidator' || this.member?.role === 'risk_steward') {
      try {
        const queue = await request<{ positions: unknown[] }>(
          'GET',
          '/api/liquidations/queue',
          {
            token: this.token,
          },
        );
        this.queueSize = queue.positions.length;
      } catch {
        // the badge keeps its last known size
      }
    }
    this.notify();
  }

  startPolling(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      void this.refresh().catch(() => undefined);
    }, REFRESH_MS);
  }

  stopPolling(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }
}

export const store = new Store();
