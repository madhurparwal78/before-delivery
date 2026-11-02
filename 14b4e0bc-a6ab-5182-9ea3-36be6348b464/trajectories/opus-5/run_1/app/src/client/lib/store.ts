import type { Role, Tag } from '../../shared/domain.ts';
import {
  type AssetDetail,
  type ColumnBody,
  type LineageBody,
  type SearchBody,
  type ServiceStatusBody,
  type SessionUser,
  type TermBody,
  api,
  columnPath,
} from './api.ts';
import {
  type CanvasModel,
  type SweepProgress,
  type ViewTransform,
  applySweep,
  buildCanvasModel,
  clampZoom,
  edgeId,
  finishedSweep,
  resetDownstream,
  sweepProgress,
  zoomAbout,
} from './canvas.ts';
import { COPY } from './copy.ts';

export type Route = 'signin' | 'catalog' | 'glossary' | 'admin';

export interface CatalogParams {
  q: string;
  tag: string | null;
  owner: string | null;
  state: string | null;
  term: string | null;
  asset: string | null;
  column: string | null;
  asOf: number | null;
}

export type DialogState =
  | {
      kind: 'verify';
      file: File | null;
      note: string;
      error: string;
      fields: Record<string, string>;
      idempotencyKey: string;
      pending: boolean;
    }
  | {
      kind: 'deprecate';
      reason: string;
      error: string;
      fields: Record<string, string>;
      idempotencyKey: string;
      pending: boolean;
    }
  | { kind: 'reinstate'; error: string; pending: boolean }
  | {
      kind: 'suppress';
      tag: Tag;
      justification: string;
      error: string;
      fields: Record<string, string>;
      pending: boolean;
    }
  | {
      kind: 'term';
      termId: string | null;
      name: string;
      definition: string;
      revision: number;
      error: string;
      fields: Record<string, string>;
      pending: boolean;
    }
  | {
      kind: 'adduser';
      name: string;
      email: string;
      role: Role;
      password: string;
      error: string;
      fields: Record<string, string>;
      pending: boolean;
    }
  | {
      kind: 'resetpw';
      userId: string;
      userName: string;
      password: string;
      error: string;
      fields: Record<string, string>;
      pending: boolean;
    };

export interface AppState {
  session: SessionUser | null;
  sessionChecked: boolean;
  route: Route;
  signInStatus: string;
  signInAlert: string;
  motion: 'reduced' | 'full';
  width: number;
  status: ServiceStatusBody | null;
  params: CatalogParams;
  search: SearchBody | null;
  searchStatus: string;
  announcedTotal: number | null;
  asset: AssetDetail | null;
  column: ColumnBody | null;
  upstream: LineageBody | null;
  downstream: LineageBody | null;
  canvas: CanvasModel | null;
  sweepState: 'idle' | 'running' | 'done';
  sweepResponse: LineageBody | null;
  sweepT0: number | null;
  sweepProgress: SweepProgress;
  traceSummary: string;
  lineageStatus: string;
  activity: string;
  selectedNode: string | null;
  focusedNode: string | null;
  view: ViewTransform;
  layout: 'settling' | 'settled';
  filtersOpen: boolean;
  lineageOpen: boolean;
  dialog: DialogState | null;
  selectedColumns: string[];
  bulkTag: Tag;
  undoBatch: string | null;
  syncedSeq: number | null;
  newerChanges: number;
  asOfAt: string | null;
  pointInTimeStatus: string;
  terms: TermBody[];
  glossaryUpdates: string;
  pendingFocus: string | null;
}

const IDLE_PROGRESS: SweepProgress = { litThroughHop: 0, counter: 0, done: false };

/** The field order of each dialog, which decides which 422 message is announced first. */
const DIALOG_FIELDS: Record<DialogState['kind'], readonly string[]> = {
  verify: ['evidence', 'note'],
  deprecate: ['reason'],
  reinstate: [],
  suppress: ['justification'],
  term: ['name', 'definition'],
  adduser: ['name', 'email', 'role', 'password'],
  resetpw: ['password'],
};

function firstInvalidField(
  kind: DialogState['kind'],
  fields: Record<string, string>,
): string | null {
  return DIALOG_FIELDS[kind].find((field) => fields[field] !== undefined) ?? null;
}

function emptyParams(): CatalogParams {
  return { q: '', tag: null, owner: null, state: null, term: null, asset: null, column: null, asOf: null };
}

function initialState(): AppState {
  return {
    session: null,
    sessionChecked: false,
    route: 'catalog',
    signInStatus: '',
    signInAlert: '',
    motion: 'full',
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    status: null,
    params: emptyParams(),
    search: null,
    searchStatus: '',
    announcedTotal: null,
    asset: null,
    column: null,
    upstream: null,
    downstream: null,
    canvas: null,
    sweepState: 'idle',
    sweepResponse: null,
    sweepT0: null,
    sweepProgress: IDLE_PROGRESS,
    traceSummary: '',
    lineageStatus: '',
    activity: '',
    selectedNode: null,
    focusedNode: null,
    view: { zoom: 1, panX: 0, panY: 0 },
    layout: 'settled',
    filtersOpen: false,
    lineageOpen: false,
    dialog: null,
    selectedColumns: [],
    bulkTag: 'PII',
    undoBatch: null,
    syncedSeq: null,
    newerChanges: 0,
    asOfAt: null,
    pointInTimeStatus: '',
    terms: [],
    glossaryUpdates: '',
    pendingFocus: null,
  };
}

export function paramsFromUrl(search: string): CatalogParams {
  const query = new URLSearchParams(search);
  const asOf = query.get('as_of');
  return {
    q: query.get('q') ?? '',
    tag: query.get('tag'),
    owner: query.get('owner'),
    state: query.get('state'),
    term: query.get('term'),
    asset: query.get('asset'),
    column: query.get('column'),
    asOf: asOf === null || !/^\d+$/.test(asOf) ? null : Number(asOf),
  };
}

export function paramsToSearch(params: CatalogParams): string {
  const query = new URLSearchParams();
  if (params.q !== '') query.set('q', params.q);
  for (const key of ['tag', 'owner', 'state', 'term', 'asset', 'column'] as const) {
    const value = params[key];
    if (value !== null && value !== '') query.set(key, value);
  }
  if (params.asOf !== null) query.set('as_of', String(params.asOf));
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}

function searchQuery(params: CatalogParams): string {
  const query = new URLSearchParams();
  if (params.q !== '') query.set('q', params.q);
  for (const key of ['tag', 'owner', 'state', 'term'] as const) {
    const value = params[key];
    if (value !== null) query.set(key, value);
  }
  if (params.asOf !== null) query.set('as_of_seq', String(params.asOf));
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}

function asOfSuffix(params: CatalogParams, extra: string[] = []): string {
  const parts = [...extra];
  if (params.asOf !== null) parts.push(`as_of_seq=${params.asOf}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export class AppStore {
  private state: AppState = initialState();
  private listeners = new Set<() => void>();
  private searchToken = 0;
  private assetToken = 0;
  private columnToken = 0;
  private lineageToken = 0;
  private sweepToken = 0;
  private typingTimer: number | null = null;
  private writesInFlight = 0;
  private stream: EventSource | null = null;
  private sweepFrame: number | null = null;
  private statusTimer: number | null = null;
  /** Rows the Admin screen is holding behind the Show new audit rows button. */
  auditListener: ((seq: number) => void) | null = null;
  usersListener: (() => void) | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): AppState => this.state;

  private set(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of [...this.listeners]) listener();
  }

  requestFocus(key: string | null): void {
    this.set({ pendingFocus: key });
  }

  clearPendingFocus(): void {
    if (this.state.pendingFocus !== null) this.set({ pendingFocus: null });
  }

  isPointInTime(): boolean {
    return this.state.params.asOf !== null && this.state.session?.role === 'Admin';
  }

  canWrite(): boolean {
    const role = this.state.session?.role;
    return !this.isPointInTime() && (role === 'Steward' || role === 'Admin');
  }

  canTrace(): boolean {
    const role = this.state.session?.role;
    return role === 'Steward' || role === 'Admin';
  }

  // ---------------------------------------------------------------- bootstrap

  async start(): Promise<void> {
    this.observeMotion();
    this.observeWidth();
    window.addEventListener('popstate', () => {
      void this.readLocation(true);
    });
    const session = await api<{ user: SessionUser }>('GET', '/api/session');
    if (session.ok) {
      this.set({ session: session.data.user, sessionChecked: true });
      this.openStream(null);
      this.pollStatus();
    } else {
      this.set({ sessionChecked: true });
    }
    await this.readLocation(false);
  }

  private observeMotion(): void {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = (): void => {
      const motion = media.matches ? 'reduced' : 'full';
      if (motion === this.state.motion) return;
      this.set({ motion });
      if (motion === 'reduced' && this.state.sweepState === 'running' && this.state.sweepResponse) {
        this.finishSweepNow();
      }
      if (motion === 'reduced' && this.state.layout === 'settling') this.set({ layout: 'settled' });
    };
    media.addEventListener('change', apply);
    this.set({ motion: media.matches ? 'reduced' : 'full' });
  }

  private observeWidth(): void {
    window.addEventListener('resize', () => {
      const width = window.innerWidth;
      if (width === this.state.width) return;
      const wasNarrow = this.state.width < 768;
      const nowNarrow = width < 768;
      this.set({ width });
      if (wasNarrow !== nowNarrow) this.crossBreakpoint(nowNarrow);
    });
  }

  private crossBreakpoint(nowNarrow: boolean): void {
    if (nowNarrow) {
      this.set({ lineageOpen: false });
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest('[data-canvas-group]') !== null && active !== null) {
        this.requestFocus('lineage-button');
      }
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const inRail = active?.closest('[data-lineage-rail]') ?? null;
    this.set({ lineageOpen: false });
    if (inRail !== null) {
      const node = active?.getAttribute('data-column');
      if (node !== null && node !== undefined) this.requestFocus(`node:${node}`);
      else this.requestFocus(this.canTrace() ? 'trace-impact' : 'zoom-in');
    }
  }

  // ---------------------------------------------------------------- routing

  private routeOf(pathname: string): Route {
    if (pathname === '/signin') return 'signin';
    if (pathname === '/glossary') return 'glossary';
    if (pathname === '/admin') return 'admin';
    return 'catalog';
  }

  async readLocation(fromHistory: boolean): Promise<void> {
    const route = this.routeOf(window.location.pathname);
    if (window.location.pathname === '/') {
      window.history.replaceState({}, '', `/catalog${window.location.search}`);
    }
    if (route !== 'signin' && this.state.session === null) {
      this.navigate('/signin', { replace: true });
      return;
    }
    const params = paramsFromUrl(window.location.search);
    if (params.asOf !== null && this.state.session?.role !== 'Admin') {
      params.asOf = null;
      window.history.replaceState({}, '', `/catalog${paramsToSearch(params)}`);
    }
    this.set({ route, params, newerChanges: 0 });
    if (route === 'catalog') {
      if (params.asOf !== null) this.set({ syncedSeq: params.asOf });
      await this.loadCatalog(!fromHistory);
      this.reopenStreamForPointInTime();
    }
    if (route === 'glossary') await this.loadTerms();
  }

  navigate(path: string, options: { replace?: boolean } = {}): void {
    if (options.replace === true) window.history.replaceState({}, '', path);
    else window.history.pushState({}, '', path);
    void this.readLocation(false);
  }

  private pushParams(params: CatalogParams, replace = false): void {
    const path = `/catalog${paramsToSearch(params)}`;
    if (replace) window.history.replaceState({}, '', path);
    else window.history.pushState({}, '', path);
    this.set({ params });
  }

  // ---------------------------------------------------------------- sign in

  async signIn(email: string, password: string): Promise<void> {
    this.set({ signInStatus: COPY.signingIn, signInAlert: '' });
    const result = await api<{ user: SessionUser }>('POST', '/api/session', {
      body: { email, password },
    });
    if (!result.ok) {
      this.set({ signInStatus: '', signInAlert: result.error.message });
      return;
    }
    this.set({ session: result.data.user, signInStatus: '', signInAlert: '' });
    this.openStream(null);
    this.pollStatus();
    this.navigate('/catalog');
  }

  async signOut(): Promise<void> {
    await api('DELETE', '/api/session');
    this.closeStream();
    this.set({ session: null, signInAlert: '' });
    this.navigate('/signin');
  }

  private endSession(message: string): void {
    this.closeStream();
    this.set({ session: null, signInAlert: message, search: null, asset: null, column: null });
    this.navigate('/signin', { replace: false });
  }

  // ---------------------------------------------------------------- status

  private pollStatus(): void {
    if (this.statusTimer !== null) return;
    const read = async (): Promise<void> => {
      const sentAt = Date.now();
      const result = await api<ServiceStatusBody>('GET', '/api/status');
      if (result.ok && sentAt >= this.statusBaseline) this.set({ status: result.data });
    };
    void read();
    this.statusTimer = window.setInterval(() => void read(), 5000);
  }

  private statusBaseline = 0;

  /** A status poll sent before the latest certification reply is ignored. */
  private ignoreStatusPollsBefore(): void {
    this.statusBaseline = Date.now();
  }

  markEvidenceOutage(queued: number): void {
    const status = this.state.status;
    this.set({
      status: { evidence: 'down', mail: status?.mail ?? 'up', queued_notices: queued },
    });
  }

  setQueuedNotices(queued: number): void {
    const status = this.state.status;
    this.set({
      status: {
        evidence: status?.evidence ?? 'up',
        mail: status?.mail ?? 'up',
        queued_notices: queued,
      },
    });
  }

  // ---------------------------------------------------------------- catalog reads

  private async fetchSearch(params: CatalogParams): Promise<SearchBody | null> {
    const result = await api<SearchBody>('GET', `/api/search${searchQuery(params)}`);
    if (result.ok) return result.data;
    if (result.status === 401) this.endSession(COPY.sessionEnded);
    return null;
  }

  private async fetchAsset(params: CatalogParams): Promise<AssetDetail | null> {
    if (params.asset === null) return null;
    const path = `/api/assets/${encodeURIComponent(params.asset)}${asOfSuffix(params)}`;
    const result = await api<AssetDetail | { asset: AssetDetail }>('GET', path);
    if (!result.ok) return null;
    return 'asset' in result.data ? result.data.asset : result.data;
  }

  private async fetchColumn(params: CatalogParams): Promise<ColumnBody | null> {
    if (params.column === null) return null;
    const path = `/api/columns/${columnPath(params.column)}${asOfSuffix(params)}`;
    const result = await api<ColumnBody | { column: ColumnBody }>('GET', path);
    if (!result.ok) return null;
    return 'column' in result.data ? result.data.column : result.data;
  }

  private async fetchLineage(
    params: CatalogParams,
    columnId: string,
    direction: 'upstream' | 'downstream',
  ): Promise<LineageBody | null> {
    const path = `/api/columns/${columnPath(columnId)}/lineage${asOfSuffix(params, [
      `direction=${direction}`,
    ])}`;
    const result = await api<LineageBody>('GET', path);
    return result.ok ? result.data : null;
  }

  private announceCount(total: number, triggered: boolean): Partial<AppState> {
    if (triggered || this.state.announcedTotal !== total) {
      return { searchStatus: COPY.matching(total), announcedTotal: total };
    }
    return {};
  }

  /** Loads everything the current catalog URL names, painting the answers together. */
  async loadCatalog(triggered: boolean): Promise<void> {
    const params = this.state.params;
    const token = ++this.searchToken;
    const assetToken = ++this.assetToken;
    const columnToken = ++this.columnToken;
    const lineageToken = ++this.lineageToken;
    if (triggered) this.set({ searchStatus: COPY.searching });
    const [search, asset, column] = await Promise.all([
      this.fetchSearch(params),
      this.fetchAsset(params),
      this.fetchColumn(params),
    ]);
    const lineage =
      params.column === null
        ? [null, null]
        : await Promise.all([
            this.fetchLineage(params, params.column, 'upstream'),
            this.fetchLineage(params, params.column, 'downstream'),
          ]);
    if (token !== this.searchToken || assetToken !== this.assetToken) return;
    if (columnToken !== this.columnToken || lineageToken !== this.lineageToken) return;
    const canvas =
      params.column === null ? null : buildCanvasModel(params.column, lineage[0], lineage[1]);
    this.set({
      search: search ?? this.state.search,
      ...(search === null
        ? { searchStatus: COPY.searchUnavailable }
        : this.announceCount(search.total, triggered)),
      asset,
      column,
      upstream: lineage[0],
      downstream: lineage[1],
      canvas,
      sweepState: 'idle',
      sweepResponse: null,
      sweepT0: null,
      sweepProgress: IDLE_PROGRESS,
      traceSummary: '',
      lineageStatus: '',
      selectedNode: params.column,
      focusedNode: params.column,
      selectedColumns: [],
      layout: 'settled',
      asOfAt: search?.as_of_at ?? null,
    });
  }

  /** Re-reads the three surfaces in place, yielding to any newer state. */
  private async refreshSurfaces(triggered: boolean): Promise<void> {
    const params = this.state.params;
    const token = ++this.searchToken;
    const assetToken = ++this.assetToken;
    const columnToken = ++this.columnToken;
    if (triggered) this.set({ searchStatus: COPY.searching });
    const [search, asset, column] = await Promise.all([
      this.fetchSearch(params),
      this.fetchAsset(params),
      this.fetchColumn(params),
    ]);
    if (token !== this.searchToken || assetToken !== this.assetToken) return;
    if (columnToken !== this.columnToken) return;
    this.set({
      search: search ?? this.state.search,
      ...(search === null ? {} : this.announceCount(search.total, triggered)),
      asset,
      column,
    });
  }

  // ---------------------------------------------------------------- search and facets

  setQuery(q: string): void {
    this.set({ params: { ...this.state.params, q } });
    if (this.typingTimer !== null) window.clearTimeout(this.typingTimer);
    this.typingTimer = window.setTimeout(() => {
      this.pushParams({ ...this.state.params, q }, true);
      void this.loadCatalog(true);
    }, 300);
  }

  setFacet(group: 'tag' | 'owner' | 'state' | 'term', value: string | null): void {
    const params = { ...this.state.params, [group]: value === '' ? null : value } as CatalogParams;
    this.pushParams(params);
    void this.loadCatalog(true);
  }

  clearFilters(): void {
    const params: CatalogParams = {
      ...emptyParams(),
      asset: this.state.params.asset,
      column: this.state.params.column,
      asOf: this.state.params.asOf,
    };
    this.pushParams(params);
    void this.loadCatalog(true);
  }

  openAsset(assetId: string): void {
    const params = { ...this.state.params, asset: assetId, column: null };
    this.pushParams(params);
    void this.loadCatalog(false);
  }

  closeAsset(): void {
    const params = { ...this.state.params, asset: null, column: null };
    this.pushParams(params);
    void this.loadCatalog(false);
  }

  openColumn(columnId: string, focusHeading = false): void {
    const assetId = columnId.slice(0, columnId.lastIndexOf('.'));
    const params = { ...this.state.params, asset: assetId, column: columnId };
    this.pushParams(params);
    if (focusHeading) this.requestFocus('column-heading');
    void this.loadCatalog(false);
  }

  setFiltersOpen(open: boolean): void {
    this.set({ filtersOpen: open });
    if (open) this.requestFocus('tag-radio-checked');
    else this.requestFocus('filters-button');
  }

  setLineageOpen(open: boolean): void {
    this.set({ lineageOpen: open });
    if (!open) {
      this.requestFocus('lineage-button');
      return;
    }
    const target = this.state.focusedNode ?? this.state.selectedNode;
    const drawn = this.state.canvas?.nodes.some((node) => node.column === target) ?? false;
    this.requestFocus(drawn && target !== null ? `node:${target}` : 'close-lineage');
  }

  setBulkTag(tag: Tag): void {
    this.set({ bulkTag: tag });
  }

  toggleColumnSelection(columnId: string): void {
    const selected = this.state.selectedColumns.includes(columnId)
      ? this.state.selectedColumns.filter((id) => id !== columnId)
      : [...this.state.selectedColumns, columnId];
    this.set({ selectedColumns: selected });
  }

  // ---------------------------------------------------------------- canvas

  chooseNode(columnId: string): void {
    const node = this.state.canvas?.nodes.find((entry) => entry.column === columnId);
    if (node === undefined) return;
    this.set({
      selectedNode: columnId,
      focusedNode: columnId,
      lineageStatus: COPY.nodeChosen(columnId, node.hop),
    });
  }

  setFocusedNode(columnId: string): void {
    this.set({ focusedNode: columnId });
  }

  zoomBy(direction: 1 | -1, width: number, height: number): void {
    this.set({
      view: zoomAbout(this.state.view, this.state.view.zoom + direction * 0.25, width / 2, height / 2),
    });
  }

  resetView(): void {
    this.set({ view: { zoom: 1, panX: 0, panY: 0 } });
  }

  panBy(deltaX: number, deltaY: number): void {
    const view = this.state.view;
    this.set({ view: { ...view, panX: view.panX + deltaX, panY: view.panY + deltaY } });
  }

  setView(view: ViewTransform): void {
    this.set({ view: { ...view, zoom: clampZoom(view.zoom) } });
  }

  // ---------------------------------------------------------------- sweep

  async traceImpact(): Promise<void> {
    const params = this.state.params;
    const focus = params.column;
    if (focus === null || !this.canTrace()) return;
    const token = ++this.sweepToken;
    this.cancelSweepFrame();
    this.set({
      canvas: this.state.canvas === null ? null : resetDownstream(this.state.canvas),
      sweepState: 'idle',
      sweepResponse: null,
      sweepT0: null,
      sweepProgress: IDLE_PROGRESS,
      traceSummary: COPY.tracing,
      lineageStatus: '',
    });
    const response = await this.fetchLineage(params, focus, 'downstream');
    if (token !== this.sweepToken || this.state.params.column !== focus) return;
    if (response === null) {
      this.set({ traceSummary: COPY.traceUnavailable });
      return;
    }
    const base = buildCanvasModel(focus, this.state.upstream, response);
    if (this.state.motion === 'reduced') {
      const progress = finishedSweep(response);
      this.set({
        downstream: response,
        canvas: applySweep(base, response, progress),
        sweepResponse: response,
        sweepT0: performance.now(),
        sweepState: 'done',
        sweepProgress: progress,
        traceSummary: response.summary,
      });
      return;
    }
    const t0 = performance.now();
    const progress = sweepProgress(response, 0);
    this.set({
      downstream: response,
      canvas: applySweep(base, response, progress),
      sweepResponse: response,
      sweepT0: t0,
      sweepState: 'running',
      sweepProgress: progress,
    });
    this.tickSweep(token);
  }

  private tickSweep(token: number): void {
    const step = (): void => {
      if (token !== this.sweepToken) return;
      const response = this.state.sweepResponse;
      const t0 = this.state.sweepT0;
      if (response === null || t0 === null) return;
      const progress = sweepProgress(response, performance.now() - t0);
      const previous = this.state.sweepProgress;
      if (
        progress.litThroughHop !== previous.litThroughHop ||
        progress.counter !== previous.counter ||
        progress.done !== previous.done
      ) {
        const canvas =
          this.state.canvas === null ? null : applySweep(this.state.canvas, response, progress);
        this.set({
          canvas,
          sweepProgress: progress,
          sweepState: progress.done ? 'done' : 'running',
          ...(progress.done ? { traceSummary: response.summary } : {}),
        });
      }
      if (!progress.done) this.sweepFrame = window.requestAnimationFrame(step);
      else this.sweepFrame = null;
    };
    this.sweepFrame = window.requestAnimationFrame(step);
  }

  private cancelSweepFrame(): void {
    if (this.sweepFrame !== null) {
      window.cancelAnimationFrame(this.sweepFrame);
      this.sweepFrame = null;
    }
  }

  private finishSweepNow(): void {
    const response = this.state.sweepResponse;
    if (response === null) return;
    this.cancelSweepFrame();
    const progress = finishedSweep(response);
    this.set({
      canvas: this.state.canvas === null ? null : applySweep(this.state.canvas, response, progress),
      sweepProgress: progress,
      sweepState: 'done',
      traceSummary: response.summary,
    });
  }

  private cancelSweep(): void {
    this.sweepToken += 1;
    this.cancelSweepFrame();
    this.set({
      sweepState: 'idle',
      sweepResponse: null,
      sweepT0: null,
      sweepProgress: IDLE_PROGRESS,
      traceSummary: '',
    });
  }

  // ---------------------------------------------------------------- tag actions

  /** The replacement control for a tag, in the published order. */
  private tagFocusKey(column: ColumnBody | null, tag: Tag): string {
    if (column === null) return 'column-heading';
    if (column.direct_tags.includes(tag)) return `tag:Withdraw ${tag}`;
    if (!column.effective_tags.includes(tag) && !column.suppressed_tags.includes(tag)) {
      return `tag:Tag ${tag}`;
    }
    if (column.effective_tags.includes(tag)) return `tag:Suppress ${tag}`;
    if (column.suppressed_tags.includes(tag)) return `tag:Lift ${tag} suppression`;
    return 'column-heading';
  }

  /**
   * Repaints the column, the asset, the results and the canvas together, once every read
   * has answered.
   */
  private async repaintAfterWrite(activity: string, focusFor: Tag | null): Promise<void> {
    this.writesInFlight += 1;
    try {
      await this.repaintNow(activity, focusFor);
    } finally {
      this.writesInFlight -= 1;
    }
  }

  private async repaintNow(activity: string, focusFor: Tag | null): Promise<void> {
    const params = this.state.params;
    const token = ++this.searchToken;
    const assetToken = ++this.assetToken;
    const columnToken = ++this.columnToken;
    const lineageToken = ++this.lineageToken;
    this.sweepToken += 1;
    this.cancelSweepFrame();
    const [search, asset, column] = await Promise.all([
      this.fetchSearch(params),
      this.fetchAsset(params),
      this.fetchColumn(params),
    ]);
    const lineage =
      params.column === null
        ? [null, null]
        : await Promise.all([
            this.fetchLineage(params, params.column, 'upstream'),
            this.fetchLineage(params, params.column, 'downstream'),
          ]);
    if (token !== this.searchToken || assetToken !== this.assetToken) return;
    if (columnToken !== this.columnToken || lineageToken !== this.lineageToken) return;
    this.set({
      search: search ?? this.state.search,
      ...(search === null ? {} : this.announceCount(search.total, false)),
      asset,
      column,
      upstream: lineage[0],
      downstream: lineage[1],
      canvas:
        params.column === null ? null : buildCanvasModel(params.column, lineage[0], lineage[1]),
      sweepState: 'idle',
      sweepResponse: null,
      sweepT0: null,
      sweepProgress: IDLE_PROGRESS,
      traceSummary: '',
      activity,
      ...(focusFor === null ? {} : { pendingFocus: this.tagFocusKey(column, focusFor) }),
    });
  }

  async addTag(columnId: string, tag: Tag): Promise<void> {
    this.set({ activity: COPY.saving });
    const result = await api('POST', `/api/columns/${columnPath(columnId)}/tags`, { body: { tag } });
    if (!result.ok) {
      await this.repaintAfterWrite(result.error.message, tag);
      return;
    }
    await this.repaintAfterWrite(COPY.tagAdded(tag, columnId), tag);
  }

  async withdrawTag(columnId: string, tag: Tag): Promise<void> {
    this.set({ activity: COPY.saving });
    const result = await api<{ still_reaching: number }>(
      'DELETE',
      `/api/columns/${columnPath(columnId)}/tags/${tag}`,
    );
    if (!result.ok) {
      await this.repaintAfterWrite(result.error.message, tag);
      return;
    }
    await this.repaintAfterWrite(
      COPY.tagWithdrawn(tag, columnId, result.data.still_reaching),
      tag,
    );
  }

  async liftSuppression(columnId: string, tag: Tag): Promise<void> {
    this.set({ activity: COPY.saving });
    const result = await api('DELETE', `/api/columns/${columnPath(columnId)}/suppressions/${tag}`);
    if (!result.ok) {
      await this.repaintAfterWrite(result.error.message, tag);
      return;
    }
    await this.repaintAfterWrite(COPY.suppressionLifted(tag, columnId), tag);
  }

  async applyBulkTag(): Promise<void> {
    const asset = this.state.asset;
    const columns = this.state.selectedColumns;
    if (asset === null || columns.length === 0) return;
    const tag = this.state.bulkTag;
    this.set({ activity: COPY.saving });
    const result = await api<{ batch_id: string | null; applied: number; requested: number }>(
      'POST',
      `/api/assets/${encodeURIComponent(asset.id)}/tags/bulk`,
      { body: { tag, columns }, headers: { 'Idempotency-Key': newIdempotencyKey() } },
    );
    if (!result.ok) {
      this.set({ activity: result.error.message });
      return;
    }
    const { applied, requested, batch_id } = result.data;
    this.set({ selectedColumns: [], undoBatch: applied > 0 ? batch_id : null });
    await this.repaintAfterWrite(COPY.bulkApplied(tag, applied, requested), null);
  }

  async undoBulkTag(): Promise<void> {
    const batchId = this.state.undoBatch;
    if (batchId === null) return;
    this.set({ activity: COPY.saving });
    const result = await api<{ restored: number }>('POST', `/api/tag-batches/${batchId}/undo`, {
      body: {},
    });
    this.set({ undoBatch: null });
    this.requestFocus('apply-bulk');
    if (!result.ok) {
      await this.repaintAfterWrite(result.error.message, null);
      this.requestFocus('apply-bulk');
      return;
    }
    await this.repaintAfterWrite(COPY.bulkUndone(result.data.restored), null);
    this.requestFocus('apply-bulk');
  }

  // ---------------------------------------------------------------- dialogs

  /** A 422 announces the first invalid field's own message and focuses that field. */
  private showDialogError(
    kind: DialogState['kind'],
    status: number,
    message: string,
    fields: Record<string, string>,
  ): void {
    const invalid = status === 422 ? firstInvalidField(kind, fields) : null;
    this.updateDialog({
      pending: false,
      error: invalid === null ? message : fields[invalid],
      fields,
    });
    if (invalid !== null) this.requestFocus(`field:${invalid}`);
  }

  openDialog(dialog: DialogState): void {
    this.set({ dialog });
  }

  updateDialog(partial: Record<string, unknown>): void {
    if (this.state.dialog === null) return;
    this.set({ dialog: { ...this.state.dialog, ...partial } as DialogState });
  }

  closeDialog(focusKey: string | null): void {
    this.set({ dialog: null });
    if (focusKey !== null) this.requestFocus(focusKey);
  }

  openVerifyDialog(): void {
    this.openDialog({
      kind: 'verify',
      file: null,
      note: '',
      error: '',
      fields: {},
      idempotencyKey: newIdempotencyKey(),
      pending: false,
    });
  }

  openDeprecateDialog(): void {
    this.openDialog({
      kind: 'deprecate',
      reason: '',
      error: '',
      fields: {},
      idempotencyKey: newIdempotencyKey(),
      pending: false,
    });
  }

  openReinstateDialog(): void {
    this.openDialog({ kind: 'reinstate', error: '', pending: false });
  }

  openSuppressDialog(tag: Tag): void {
    this.openDialog({ kind: 'suppress', tag, justification: '', error: '', fields: {}, pending: false });
  }

  /** The first certification control now shown, else the Asset detail heading. */
  private certificationFocusKey(asset: AssetDetail | null): string {
    if (asset === null) return 'asset-heading';
    const role = this.state.session?.role;
    if (asset.state === 'draft') return 'verify-button';
    if (asset.state === 'verified') return 'deprecate-button';
    if (asset.state === 'deprecated' && role === 'Admin') return 'reinstate-button';
    return 'asset-heading';
  }

  async submitVerify(): Promise<void> {
    const dialog = this.state.dialog;
    const asset = this.state.asset;
    if (dialog === null || dialog.kind !== 'verify' || asset === null) return;
    const form = new FormData();
    if (dialog.file !== null) form.append('evidence', dialog.file, dialog.file.name);
    form.append('note', dialog.note);
    this.updateDialog({ pending: true, error: COPY.uploadingEvidence, fields: {} });
    const result = await api<AssetDetail>(
      'POST',
      `/api/assets/${encodeURIComponent(asset.id)}/verify`,
      { formData: form, headers: { 'Idempotency-Key': dialog.idempotencyKey } },
    );
    this.ignoreStatusPollsBefore();
    const latest = this.state.dialog;
    if (latest === null || latest.kind !== 'verify') return;
    if (!result.ok) {
      const fields = result.error.fields ?? {};
      const invalid = result.status === 422 ? firstInvalidField('verify', fields) : null;
      this.updateDialog({
        pending: false,
        error: invalid === null ? result.error.message : fields[invalid],
        fields,
      });
      if (result.status === 503) this.markEvidenceOutage(this.state.status?.queued_notices ?? 0);
      this.requestFocus(invalid === null ? 'verify-submit' : `field:${invalid}`);
      return;
    }
    const filename = result.data.evidence?.filename ?? '';
    this.set({ dialog: null });
    await this.repaintAfterWrite(COPY.verified(filename), null);
    this.requestFocus(this.certificationFocusKey(result.data));
  }

  async submitDeprecate(): Promise<void> {
    const dialog = this.state.dialog;
    const asset = this.state.asset;
    if (dialog === null || dialog.kind !== 'deprecate' || asset === null) return;
    this.updateDialog({ pending: true, error: COPY.saving, fields: {} });
    const result = await api<{
      asset: AssetDetail;
      notices_queued: number;
      queued_notices: number;
    }>('POST', `/api/assets/${encodeURIComponent(asset.id)}/deprecate`, {
      body: { reason: dialog.reason },
      headers: { 'Idempotency-Key': dialog.idempotencyKey },
    });
    this.ignoreStatusPollsBefore();
    if (!result.ok) {
      this.showDialogError('deprecate', result.status, result.error.message, result.error.fields ?? {});
      return;
    }
    this.set({ dialog: null });
    this.setQueuedNotices(result.data.queued_notices);
    await this.repaintAfterWrite(COPY.deprecated(result.data.notices_queued), null);
    this.requestFocus(this.certificationFocusKey(result.data.asset));
  }

  async submitReinstate(): Promise<void> {
    const asset = this.state.asset;
    if (asset === null) return;
    this.updateDialog({ pending: true, error: COPY.saving });
    const result = await api<{
      asset: AssetDetail;
      notices_cancelled: number;
      queued_notices: number;
    }>('POST', `/api/assets/${encodeURIComponent(asset.id)}/reinstate`, { body: {} });
    this.ignoreStatusPollsBefore();
    if (!result.ok) {
      this.updateDialog({ pending: false, error: result.error.message });
      return;
    }
    this.set({ dialog: null });
    this.setQueuedNotices(result.data.queued_notices);
    await this.repaintAfterWrite(COPY.reinstated(result.data.notices_cancelled), null);
    this.requestFocus(this.certificationFocusKey(result.data.asset));
  }

  async submitSuppression(): Promise<void> {
    const dialog = this.state.dialog;
    const columnId = this.state.params.column;
    if (dialog === null || dialog.kind !== 'suppress' || columnId === null) return;
    this.updateDialog({ pending: true, error: COPY.saving, fields: {} });
    const result = await api('POST', `/api/columns/${columnPath(columnId)}/suppressions`, {
      body: { tag: dialog.tag, justification: dialog.justification },
    });
    if (!result.ok) {
      this.showDialogError('suppress', result.status, result.error.message, result.error.fields ?? {});
      if (result.status === 409) await this.repaintAfterWrite(result.error.message, dialog.tag);
      return;
    }
    const tag = dialog.tag;
    this.set({ dialog: null });
    await this.repaintAfterWrite(COPY.suppressed(tag, columnId), tag);
  }

  // ---------------------------------------------------------------- glossary

  async loadTerms(): Promise<void> {
    const result = await api<{ terms: TermBody[] }>('GET', '/api/terms');
    if (result.ok) this.set({ terms: result.data.terms });
  }

  private async refreshTermsFromEvent(): Promise<void> {
    const previous = new Map(this.state.terms.map((term) => [term.id, term.name]));
    const result = await api<{ terms: TermBody[] }>('GET', '/api/terms');
    if (!result.ok) return;
    let announcement: string | null = null;
    for (const term of result.data.terms) {
      const before = previous.get(term.id);
      if (before !== undefined && before !== term.name) announcement = COPY.termRenamed(before, term.name);
    }
    this.set({
      terms: result.data.terms,
      ...(announcement === null ? {} : { glossaryUpdates: announcement }),
    });
  }

  openTermDialog(term: TermBody | null): void {
    this.openDialog({
      kind: 'term',
      termId: term?.id ?? null,
      name: term?.name ?? '',
      definition: term?.definition ?? '',
      revision: term?.revision ?? 0,
      error: '',
      fields: {},
      pending: false,
    });
  }

  async submitTerm(): Promise<void> {
    const dialog = this.state.dialog;
    if (dialog === null || dialog.kind !== 'term') return;
    this.updateDialog({ pending: true, error: COPY.saving, fields: {} });
    const result =
      dialog.termId === null
        ? await api<{ term: TermBody }>('POST', '/api/terms', {
            body: { name: dialog.name, definition: dialog.definition },
          })
        : await api<{ term: TermBody }>('PATCH', `/api/terms/${encodeURIComponent(dialog.termId)}`, {
            body: { revision: dialog.revision, name: dialog.name, definition: dialog.definition },
          });
    if (!result.ok) {
      this.showDialogError('term', result.status, result.error.message, result.error.fields ?? {});
      return;
    }
    this.set({ dialog: null, activity: COPY.termSaved });
    await this.loadTerms();
    this.requestFocus(`term-edit:${result.data.term.id}`);
  }

  // ---------------------------------------------------------------- admin actions

  openAddUserDialog(): void {
    this.openDialog({
      kind: 'adduser',
      name: '',
      email: '',
      role: 'Analyst',
      password: '',
      error: '',
      fields: {},
      pending: false,
    });
  }

  openResetPasswordDialog(userId: string, userName: string): void {
    this.openDialog({
      kind: 'resetpw',
      userId,
      userName,
      password: '',
      error: '',
      fields: {},
      pending: false,
    });
  }

  async submitAddUser(): Promise<void> {
    const dialog = this.state.dialog;
    if (dialog === null || dialog.kind !== 'adduser') return;
    this.updateDialog({ pending: true, error: COPY.saving, fields: {} });
    const result = await api<{ user: SessionUser }>('POST', '/api/users', {
      body: {
        name: dialog.name,
        email: dialog.email,
        role: dialog.role,
        password: dialog.password,
      },
    });
    if (!result.ok) {
      this.showDialogError('adduser', result.status, result.error.message, result.error.fields ?? {});
      return;
    }
    this.set({ dialog: null, activity: COPY.userCreated(result.data.user.name) });
    this.usersListener?.();
    this.requestFocus('add-user');
  }

  async submitResetPassword(): Promise<void> {
    const dialog = this.state.dialog;
    if (dialog === null || dialog.kind !== 'resetpw') return;
    this.updateDialog({ pending: true, error: COPY.saving, fields: {} });
    const result = await api<{ sessions_ended: number }>(
      'PATCH',
      `/api/users/${encodeURIComponent(dialog.userId)}`,
      { body: { password: dialog.password } },
    );
    if (!result.ok) {
      this.showDialogError('resetpw', result.status, result.error.message, result.error.fields ?? {});
      return;
    }
    this.set({
      dialog: null,
      activity: COPY.passwordReset(dialog.userName, result.data.sessions_ended),
    });
    this.requestFocus(`reset-password:${dialog.userId}`);
  }

  async changeRole(userId: string, userName: string, role: Role): Promise<void> {
    this.set({ activity: COPY.saving });
    const result = await api<{ user: SessionUser }>('PATCH', `/api/users/${encodeURIComponent(userId)}`, {
      body: { role },
    });
    if (!result.ok) {
      this.set({ activity: result.error.message });
      this.usersListener?.();
      return;
    }
    this.set({ activity: COPY.roleUpdated(userName, role) });
    this.usersListener?.();
  }

  setPointInTimeStatus(status: string): void {
    this.set({ pointInTimeStatus: status });
  }

  // ---------------------------------------------------------------- activity stream

  private openStream(after: number | null): void {
    this.closeStream();
    const stream = new EventSource(after === null ? '/api/events' : `/api/events?after_seq=${after}`);
    stream.addEventListener('change', (event) => {
      void this.applyEvent(JSON.parse((event as MessageEvent<string>).data) as ActivityEvent);
    });
    stream.addEventListener('error', () => {
      void this.checkSession();
    });
    this.stream = stream;
  }

  private closeStream(): void {
    this.stream?.close();
    this.stream = null;
  }

  private reopenStreamForPointInTime(): void {
    if (this.state.session === null) return;
    this.openStream(this.isPointInTime() ? this.state.params.asOf : null);
  }

  private async checkSession(): Promise<void> {
    if (this.state.session === null) return;
    const result = await api<{ user: SessionUser }>('GET', '/api/session');
    if (!result.ok && result.status === 401) this.endSession(COPY.sessionEnded);
  }

  private async applyEvent(row: ActivityEvent): Promise<void> {
    const session = this.state.session;
    if (session === null) return;
    if (row.action === 'user.role_change' && row.target.id === session.id) {
      await this.ownRoleChanged(row.seq);
      return;
    }
    if (this.isPointInTime()) {
      const count = this.state.newerChanges + 1;
      this.set({
        newerChanges: count,
        ...(count === 1
          ? { activity: COPY.pointInTimeNewer(count, this.state.params.asOf as number) }
          : {}),
      });
      return;
    }
    if (this.state.route === 'admin') {
      this.auditListener?.(row.seq);
      if (row.action.startsWith('user.')) this.usersListener?.();
      this.set({ syncedSeq: row.seq });
      return;
    }
    if (this.state.route === 'glossary') {
      if (row.action.startsWith('term.')) await this.refreshTermsFromEvent();
      this.set({ syncedSeq: row.seq });
      return;
    }
    if (row.action.startsWith('user.') || row.action === 'evidence.download') {
      this.set({ syncedSeq: row.seq });
      return;
    }
    // The person's own write repaints every surface itself; its reply owns the paint.
    if (this.writesInFlight === 0) {
      await this.refreshSurfaces(false);
      if (row.action.startsWith('tag.') || row.action.startsWith('certification.')) {
        await this.canvasFollowTags();
      }
      if (row.action.startsWith('lineage.')) await this.canvasFollowLineage();
    }
    this.set({ syncedSeq: row.seq });
  }

  private async waitForSettledSweep(): Promise<void> {
    for (let attempt = 0; attempt < 40 && this.state.sweepState === 'running'; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }

  /** Another person's tag or certification change, applied to the drawing in place. */
  private async canvasFollowTags(): Promise<void> {
    const params = this.state.params;
    const focus = params.column;
    const canvas = this.state.canvas;
    if (focus === null || canvas === null) return;
    const [upstream, downstream] = await Promise.all([
      this.fetchLineage(params, focus, 'upstream'),
      this.fetchLineage(params, focus, 'downstream'),
    ]);
    if (this.state.params.column !== focus || this.state.canvas === null) return;
    await this.waitForSettledSweep();
    const current = this.state.canvas;
    if (current === null) return;
    const upstreamEntries = new Map((upstream?.reached ?? []).map((entry) => [entry.column, entry]));
    const downstreamEntries = new Map(
      (downstream?.reached ?? []).map((entry) => [entry.column, entry]),
    );
    const assets = { ...(upstream?.assets ?? {}), ...(downstream?.assets ?? {}) };
    const nodes = current.nodes.map((node) => {
      const assetEntry = assets[node.asset];
      const deprecation =
        assetEntry === undefined
          ? {}
          : {
              deprecated: assetEntry.state === 'deprecated',
              deprecatedUpstream: assetEntry.deprecated_upstream ?? '',
            };
      if (node.hop === 0) {
        const source = upstream ?? downstream;
        return source === null
          ? { ...node, ...deprecation }
          : {
              ...node,
              ...deprecation,
              tags: source.focus_tags,
              sources: source.focus_tag_sources,
            };
      }
      if (node.hop < 0) {
        const entry = upstreamEntries.get(node.column);
        return entry === undefined
          ? { ...node, ...deprecation }
          : {
              ...node,
              ...deprecation,
              tags: entry.carried_tags,
              sealedTags: entry.sealed_tags,
              sources: entry.tag_sources,
            };
      }
      const entry = downstreamEntries.get(node.column);
      if (entry === undefined || !node.lit) return { ...node, ...deprecation };
      return {
        ...node,
        ...deprecation,
        tags: entry.carried_tags,
        sealedTags: entry.sealed_tags,
        sources: entry.tag_sources,
      };
    });
    this.set({ canvas: { ...current, nodes }, upstream, downstream });
  }

  /** Another person's lineage write, added to the drawing in place. */
  private async canvasFollowLineage(): Promise<void> {
    const params = this.state.params;
    const focus = params.column;
    const canvas = this.state.canvas;
    if (focus === null || canvas === null) return;
    const [upstream, downstream] = await Promise.all([
      this.fetchLineage(params, focus, 'upstream'),
      this.fetchLineage(params, focus, 'downstream'),
    ]);
    if (this.state.params.column !== focus || this.state.canvas === null) return;
    await this.waitForSettledSweep();
    const current = this.state.canvas;
    if (current === null || upstream === null || downstream === null) return;
    const listed = new Map<string, { kind: CanvasEdgeKind; hop: number }>();
    const nodeHops = new Map<string, number>();
    const assets = { ...upstream.assets, ...downstream.assets };
    for (const entry of upstream.reached) nodeHops.set(entry.column, -entry.hop);
    for (const entry of downstream.reached) nodeHops.set(entry.column, entry.hop);
    nodeHops.set(focus, 0);
    for (const edge of [...upstream.edges, ...downstream.edges]) {
      listed.set(edgeId(edge.from, edge.to), { kind: edge.kind, hop: 0 });
    }
    const carried = new Map(upstream.reached.map((entry) => [entry.column, entry]));

    const nodes = [...current.nodes];
    const known = new Set(nodes.map((node) => node.column));
    const edges = current.edges.filter((edge) => listed.has(edge.id));
    let changed = current.edges.length !== edges.length;
    for (const [id, info] of listed) {
      if (edges.some((edge) => edge.id === id)) continue;
      const [from, to] = id.split('\u0000');
      edges.push({ id, from, to, kind: info.kind, drawn: true, state: 'new' });
      changed = true;
      for (const end of [from, to]) {
        if (known.has(end)) continue;
        known.add(end);
        const hop = nodeHops.get(end);
        if (hop === undefined) continue;
        const assetId = end.slice(0, end.lastIndexOf('.'));
        const entry = carried.get(end);
        nodes.push({
          column: end,
          asset: assetId,
          hop,
          lit: false,
          tags: hop < 0 ? (entry?.carried_tags ?? []) : [],
          sealedTags: entry?.sealed_tags ?? [],
          sources: hop < 0 ? (entry?.tag_sources ?? {}) : {},
          deprecated: assets[assetId]?.state === 'deprecated',
          deprecatedUpstream: assets[assetId]?.deprecated_upstream ?? '',
        });
      }
    }
    if (!changed) {
      this.set({ upstream, downstream });
      return;
    }
    this.set({
      canvas: { ...current, nodes, edges },
      upstream,
      downstream,
      lineageStatus: COPY.lineageChanged,
      layout: this.state.motion === 'reduced' ? 'settled' : 'settling',
    });
    if (this.state.motion !== 'reduced') {
      window.setTimeout(() => this.set({ layout: 'settled' }), 250);
    }
  }

  // ---------------------------------------------------------------- role changes

  private async ownRoleChanged(seq: number): Promise<void> {
    const result = await api<{ user: SessionUser }>('GET', '/api/session');
    if (!result.ok) {
      if (result.status === 401) this.endSession(COPY.sessionEnded);
      return;
    }
    const user = result.data.user;
    const activeKey = (document.activeElement as HTMLElement | null)?.dataset.focusKey ?? null;
    const dialog = this.state.dialog;
    const mayWrite = user.role === 'Steward' || user.role === 'Admin';
    const mayAdmin = user.role === 'Admin';
    const closesDialog =
      dialog !== null &&
      ((!mayWrite &&
        ['verify', 'deprecate', 'suppress', 'term'].includes(dialog.kind)) ||
        (!mayAdmin && ['reinstate', 'adduser', 'resetpw'].includes(dialog.kind)));
    const tracePending = this.state.sweepState !== 'done' && this.state.traceSummary !== '';
    const cancelTrace = !(user.role === 'Steward' || user.role === 'Admin');

    this.set({
      session: user,
      ...(closesDialog ? { dialog: null } : {}),
      activity: COPY.ownRoleChanged(user.role),
    });
    if (cancelTrace && (tracePending || this.state.sweepState === 'running')) {
      this.cancelSweep();
      const params = this.state.params;
      if (params.column !== null) {
        this.set({
          canvas: buildCanvasModel(params.column, this.state.upstream, this.state.downstream),
        });
      }
    }
    if (this.state.params.asOf !== null && !mayAdmin) {
      const params = { ...this.state.params, asOf: null };
      window.history.replaceState({}, '', `/catalog${paramsToSearch(params)}`);
      this.set({ params, newerChanges: 0 });
    }
    await this.refreshSurfaces(false);
    if (activeKey !== null && document.activeElement === document.body) {
      this.requestFocus(this.roleChangeFocusKey(activeKey, cancelTrace));
    }
    this.set({ syncedSeq: seq });
  }

  private roleChangeFocusKey(activeKey: string, tracingBlocked: boolean): string {
    if (activeKey.startsWith('tag:')) {
      const tag = activeKey.includes('PII') ? 'PII' : 'Confidential';
      return this.tagFocusKey(this.state.column, tag as Tag);
    }
    if (activeKey === 'apply-bulk' || activeKey === 'undo-bulk') return 'asset-heading';
    if (['verify-button', 'deprecate-button', 'reinstate-button'].includes(activeKey)) {
      return this.certificationFocusKey(this.state.asset);
    }
    if (activeKey === 'trace-impact') {
      return tracingBlocked && this.state.width < 768 ? 'close-lineage' : 'zoom-in';
    }
    if (activeKey.startsWith('term-edit') || activeKey === 'new-term') return 'glossary-heading';
    if (activeKey.startsWith('reset-password') || activeKey === 'add-user' || activeKey.startsWith('role-')) {
      return 'admin-only-heading';
    }
    return activeKey;
  }
}

type CanvasEdgeKind = CanvasModel['edges'][number]['kind'];

interface ActivityEvent {
  seq: number;
  action: string;
  target: { type: string; id: string };
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export const store = new AppStore();
