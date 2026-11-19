// The client store: one place for the finder's live state — filters, results,
// tower cells, the open home, the lens, and the pollers that keep them current.
import { api, type PublicUnit, type SearchReply, ApiError } from './shared.js';

export interface Filters {
  q: string;
  bedrooms: string[];
  band: string[];
  facing: string[];
  view: string[];
  status: string[];
  priceMin: string;
  priceMax: string;
}

export const emptyFilters = (): Filters => ({
  q: '',
  bedrooms: [],
  band: [],
  facing: [],
  view: [],
  status: [],
  priceMin: '',
  priceMax: '',
});

export interface TowerCell {
  code: string;
  floor: number;
  stack: string;
  status: 'available' | 'held' | 'reserved' | 'withdrawn' | 'unreleased';
  syncing: boolean;
}

export interface Hold {
  id: string;
  unitCode: string;
  status: 'active' | 'released' | 'lapsed' | 'converted';
  endedBy: 'buyer' | 'withdrawal' | 'lapse' | 'conversion' | null;
  quotedPrice: number;
  priceVersion: number;
  createdAt: string;
  endsAt: string;
  endedAt: string | null;
  shareUrl: string | null;
}

export class FinderStore {
  filters: Filters = emptyFilters();
  results: PublicUnit[] = [];
  total = 0;
  facets: Record<string, Record<string, number>> = {};
  matchingCodes: string[] = [];
  hasSearchReply = false;
  nextCursor: string | null = null;
  busy = false;
  tower: TowerCell[] = [];
  towerAt = 0;
  account: { email: string; name: string; role: string } | null = null;
  holds: Hold[] = [];
  openUnit: string | null = null;
  notices: string[] = [];
  searchEpoch = 0;
  fieldErrors: Record<string, string> = {};
  rateLimitSeconds = 0;
  outage = false;
  searchDown = false;

  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of this.listeners) listener();
  }

  notify(message: string): void {
    this.notices = [...this.notices, message];
    this.emit();
  }

  clearNotice(message: string): void {
    this.notices = this.notices.filter((n) => n !== message);
    this.emit();
  }

  query(): string {
    const params = new URLSearchParams();
    if (this.filters.q) params.set('q', this.filters.q);
    for (const value of this.filters.bedrooms) params.append('bedrooms', value);
    for (const value of this.filters.band) params.append('band', value);
    for (const value of this.filters.facing) params.append('facing', value);
    for (const value of this.filters.view) params.append('view', value);
    for (const value of this.filters.status) params.append('status', value);
    if (this.filters.priceMin) params.set('priceMin', this.filters.priceMin);
    if (this.filters.priceMax) params.set('priceMax', this.filters.priceMax);
    return params.toString();
  }

  loadFromQuery(search: string): void {
    const params = new URLSearchParams(search);
    const filters = emptyFilters();
    filters.q = params.get('q') ?? '';
    filters.bedrooms = params.getAll('bedrooms');
    filters.band = params.getAll('band');
    filters.facing = params.getAll('facing');
    filters.view = params.getAll('view');
    filters.status = params.getAll('status');
    filters.priceMin = params.get('priceMin') ?? '';
    filters.priceMax = params.get('priceMax') ?? '';
    this.filters = filters;
    this.openUnit = params.get('unit');
  }

  async refreshSession(): Promise<void> {
    try {
      const reply = await api<{ account: { email: string; name: string; role: string } }>('/api/session');
      this.account = reply.account;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.account = null;
    }
    this.emit();
  }

  async refreshTower(): Promise<void> {
    try {
      const reply = await api<{ units: TowerCell[] }>('/api/tower');
      this.tower = reply.units;
      this.towerAt = Date.now();
      this.emit();
    } catch {
      // The tower read keeps its previous cells on failure.
    }
  }

  async refreshHolds(): Promise<void> {
    if (!this.account || this.account.role !== 'buyer') {
      this.holds = [];
      return;
    }
    try {
      const reply = await api<{ holds: Hold[] }>('/api/holds');
      this.holds = reply.holds;
      this.emit();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.account = null;
        this.holds = [];
        this.emit();
      }
    }
  }

  activeHold(): Hold | null {
    return this.holds.find((h) => h.status === 'active') ?? null;
  }

  async search(): Promise<void> {
    const epoch = ++this.searchEpoch;
    this.busy = true;
    this.emit();
    try {
      const query = this.query();
      const reply = await api<SearchReply>(`/api/search${query.length > 0 ? `?${query}` : ''}`);
      if (epoch !== this.searchEpoch) return;
      this.applySearchReply(reply);
    } catch (error) {
      if (epoch !== this.searchEpoch) return;
      this.busy = false;
      this.emit();
      throw error;
    }
  }

  applySearchReply(reply: SearchReply): void {
    this.results = reply.hits;
    this.total = reply.total;
    this.facets = reply.facets;
    this.matchingCodes = reply.matchingCodes;
    this.nextCursor = reply.nextCursor;
    this.busy = false;
    this.hasSearchReply = true;
    this.emit();
  }

  async loadMore(): Promise<SearchReply> {
    const query = this.query();
    const cursor = this.nextCursor ?? '';
    const pageQuery = query.length > 0 ? `${query}&` : '';
    const reply = await api<SearchReply>(`/api/search?${pageQuery}after=${encodeURIComponent(cursor)}`);
    return reply;
  }
}
