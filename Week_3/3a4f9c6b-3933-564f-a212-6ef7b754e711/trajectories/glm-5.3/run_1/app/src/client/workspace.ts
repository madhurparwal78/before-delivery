// The workspace screen: left rail, stage graph, ledger strip, evidence column.

import {
  ApiError, Bundle, Decision, Graph, GraphNode, HealthInfo,
  Promotion, Role, Session, StatusInfo, api, clusterTime, newRequestKey,
} from './api.js';
import { DialogHost, Live, Refresher, every, prefersReducedMotion } from './shell.js';
import { el, esc, glyph, statePill, statusPill } from './ui.js';

const PHASE_LABELS: Record<string, string> = {
  queued: 'Queued',
  window_check: 'Blocked by window',
  applying: 'Applying',
  health_wait: 'Health wait',
  healthy: 'Healthy',
  degraded: 'Degraded',
  stopped: 'Stopped',
  idle: 'Idle',
};

// A tiny transparent SVG used as the img src so the img stays in the
// accessibility tree while the inline SVG draws the rail.
const REST_EDGE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="none"/></svg>';

const ROLE_ACTIONS: Record<string, Role[]> = {
  promote: ['service_developer', 'platform_engineer'],
  start: ['service_developer', 'platform_engineer'],
  retry_window: ['service_developer', 'platform_engineer'],
  approve: ['release_manager'],
  reject: ['release_manager'],
  break_freeze: ['oncall_sre'],
  rollback: ['oncall_sre'],
  download: ['platform_engineer', 'service_developer', 'release_manager', 'oncall_sre'],
};

export class Workspace {
  private graphRefresher: Refresher | null = null;
  private timeRefresher: Refresher | null = null;
  private graph: Graph | null = null;
  private bundles: Bundle[] = [];
  private status: StatusInfo | null = null;
  private stagePromotions: Promotion[] = [];
  private stageHealth: HealthInfo | null = null;
  private selectedStage: string | null = null;
  private selectedPromotionId: string | null = null;
  private lastPhases: Record<string, string> = {};
  private nodeFlash: Record<string, number> = {};
  private root = document.getElementById('root')!;

  constructor(
    private readonly session: Session,
    private readonly slug: string,
    private readonly live: Live,
    private readonly dialogs: DialogHost,
    private readonly onSessionEnded: () => void,
  ) {}

  mount(): void {
    document.title = `${this.graph?.project?.name ?? this.slug} · Keelson`;
    this.root.innerHTML = '';
    const shell = el('div', { class: 'app-shell' });
    shell.appendChild(this.renderRail());
    const main = el('div', { class: 'main' });
    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !this.dialogs.isOpen && this.selectedStage) {
        e.preventDefault();
        this.closeEvidence();
      }
    };
    document.addEventListener('keydown', this.escapeHandler);
    const topbar = el('div', { class: 'topbar' });
    topbar.innerHTML = `<button class="btn" aria-label="Menu" data-menu>Menu</button>
      <span class="brand-lite">${esc(this.slug)}</span>`;
    topbar.querySelector('[data-menu]')!.addEventListener('click', () => {
      const rail = shell.querySelector<HTMLElement>('.rail')!;
      rail.classList.toggle('open');
      (rail.querySelector<HTMLElement>('a, button') as HTMLElement).focus();
    });
    main.appendChild(topbar);
    const body = el('div', { class: 'workspace-body' });
    const graphColumn = el('div', { class: 'graph-column' });
    graphColumn.appendChild(this.renderGraphRegion());
    graphColumn.appendChild(this.renderLedger());
    body.appendChild(graphColumn);
    body.appendChild(this.renderEvidence());
    main.appendChild(body);
    shell.appendChild(main);
    this.root.appendChild(shell);

    this.graphRefresher = every(2000, () => this.refresh());
    this.timeRefresher = every(30000, () => this.refreshTimes());
    void this.refresh(true);
  }

  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  unmount(): void {
    if (this.escapeHandler) document.removeEventListener('keydown', this.escapeHandler);
    this.escapeHandler = null;
    this.graphRefresher?.stop();
    this.timeRefresher?.stop();
    this.root.innerHTML = '';
  }

  // ---------------------------------------------------------------- rail

  private renderRail(): HTMLElement {
    const rail = el('aside', { class: 'rail' });
    const projects = this.session.memberships.map((m) => m.project);
    const roles: Record<string, string> = {};
    for (const m of this.session.memberships) roles[m.project] = m.role;
    rail.innerHTML = `
      <div class="brand">Keelson</div>
      <nav aria-label="Projects">
        ${projects.map((p) => `<a href="/projects/${esc(p)}" ${p === this.slug ? 'aria-current="true"' : ''}>${esc(p)}</a>`).join('')}
      </nav>
      <nav aria-label="Stages" id="rail-stages"></nav>
      <a href="/projects/${esc(this.slug)}/windows">Windows and freezes</a>
      <div class="who">
        <div class="name">${esc(this.session.user.name)}</div>
        <div class="role">${esc(this.roleName(this.graph?.role ?? roles[this.slug] ?? ''))}</div>
        <button class="btn" data-sign-out>Sign out</button>
      </div>`;
    rail.querySelector('[data-sign-out]')!.addEventListener('click', async () => {
      try { await api.signOut(); } catch { /* session already gone */ }
      window.location.href = '/sign-in';
    });
    return rail;
  }

  private roleName(role: string): string {
    const names: Record<string, string> = {
      platform_engineer: 'Platform engineer',
      service_developer: 'Service developer',
      release_manager: 'Release manager',
      oncall_sre: 'On-call SRE',
    };
    return names[role] ?? role;
  }

  private renderStagesInRail(stages: GraphNode[]): void {
    const nav = document.getElementById('rail-stages');
    if (!nav) return;
    nav.innerHTML = stages.map((n) =>
      `<a href="#" data-stage="${esc(n.stage)}" ${n.stage === this.selectedStage ? 'aria-current="true"' : ''}>${esc(n.stage)}</a>`,
    ).join('');
    nav.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const stage = (a as HTMLElement).dataset.stage!;
        this.selectStage(stage);
      });
    });
  }

  // --------------------------------------------------------------- graph

  private renderGraphRegion(): HTMLElement {
    const wrap = el('div', { class: 'graph-wrap' });
    wrap.innerHTML = `<div class="graph" id="graph" role="region" aria-label="Stage graph"></div>`;
    return wrap;
  }

  private pipeline(stages: GraphNode[]): { roots: GraphNode[]; byName: Map<string, GraphNode> } {
    const byName = new Map(stages.map((s) => [s.stage, s]));
    const roots = stages.filter((s) => s.upstream === null);
    return { roots, byName };
  }

  private renderGraph(): void {
    if (!this.graph) return;
    const graphEl = document.getElementById('graph');
    if (!graphEl) return;
    const stages = this.graph.nodes;
    const { byName } = this.pipeline(stages);
    // Rebuild only when the stage set changes; otherwise update in place so
    // motion and focus survive the refresh.
    const currentStages = Array.from(graphEl.querySelectorAll('.node')).map((n) => (n as HTMLElement).dataset.stage).join(',');
    const wantedStages = stages.map((s) => s.stage).join(',');
    if (currentStages !== wantedStages || graphEl.children.length === 0) {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(this.bundlesNode());
      const dev = byName.get('dev');
      const staging = byName.get('staging');
      if (dev) {
        fragment.appendChild(this.edge('bundles', 'dev'));
        fragment.appendChild(this.stageNode(dev));
      }
      if (staging) {
        fragment.appendChild(this.edge('dev', 'staging'));
        fragment.appendChild(this.stageNode(staging));
      }
      const fanouts = stages.filter((s) => s.upstream === 'staging');
      if (fanouts.length > 0) {
        const fan = el('div', { class: 'fanout' });
        fanouts.forEach((s) => {
          fan.appendChild(this.edge('staging', s.stage));
          fan.appendChild(this.stageNode(s));
        });
        fragment.appendChild(fan);
      }
      graphEl.innerHTML = '';
      graphEl.appendChild(fragment);
    } else {
      // Update existing nodes in place.
      for (const stage of stages) {
        const existing = graphEl.querySelector<HTMLElement>(`[data-stage="${stage.stage}"].node`);
        if (existing) this.updateStageNode(existing, stage);
      }
    }
    this.renderStagesInRail(stages);
    this.updateCapsules();
    this.announcePhases();
  }

  private updateStageNode(btn: HTMLElement, n: GraphNode): void {
    btn.setAttribute('data-status', n.status);
    if (n.stage === this.selectedStage) btn.classList.add('selected');
    else btn.classList.remove('selected');
    const selectedTag = btn.querySelector<HTMLElement>('.selected-tag');
    if (n.stage === this.selectedStage && !selectedTag) {
      const tag = el('span', { class: 'selected-tag' });
      tag.textContent = 'Selected';
      btn.prepend(tag);
    } else if (n.stage !== this.selectedStage && selectedTag) {
      selectedTag.remove();
    }
    const statusLine = btn.querySelector<HTMLElement>('.status-line')!;
    statusLine.innerHTML = statusPill(n.status);
    const current = btn.querySelector<HTMLElement>('.current-tag')!;
    current.textContent = n.current ? `current ${n.current.short_digest}` : 'current —';
    const counter = btn.querySelector<HTMLElement>('.counter')!;
    counter.textContent = n.counter ? `in sync ${n.counter.in_sync}/${n.counter.total}` : 'in sync —';
  }

  private bundlesNode(): HTMLElement {
    const node = el('div', { class: 'bundles-node' });
    node.innerHTML = `
      <span class="glyph">${glyph('bundles')}</span>
      <span class="title">Bundles</span>
      <span class="meta">intake</span>`;
    return node;
  }

  private stageNode(n: GraphNode): HTMLElement {
    const btn = el('button', {
      class: 'node' + (n.stage === this.selectedStage ? ' selected' : ''),
      'data-stage': n.stage,
      'data-status': n.status,
      'aria-label': `Stage ${n.stage}`,
    });
    const current = n.current ? `current ${n.current.short_digest}` : 'current —';
    const counter = n.counter ? `in sync ${n.counter.in_sync}/${n.counter.total}` : 'in sync —';
    btn.innerHTML = `
      ${n.stage === this.selectedStage ? '<span class="selected-tag">Selected</span>' : ''}
      <span class="stage-name">${esc(n.stage)}</span>
      <span class="meta">${esc(n.cluster)} · ${esc(n.time_zone)}</span>
      <span class="status-line">${statusPill(n.status)}</span>
      <span class="current-tag">${esc(current)}</span>
      <span class="counter">${esc(counter)}</span>`;
    btn.addEventListener('click', () => this.selectStage(n.stage));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.selectStage(n.stage); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.moveSelection(n.stage, e.key);
      }
    });
    return btn;
  }

  private moveSelection(from: string, key: string): void {
    if (!this.graph) return;
    const order = this.graph.nodes.map((n) => n.stage);
    const idx = order.indexOf(from);
    const delta = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
    const next = order[(idx + delta + order.length) % order.length];
    const node = document.querySelector<HTMLElement>(`[data-stage="${next}"].node`);
    node?.focus();
  }

  private edge(from: string, to: string): HTMLElement {
    if (!this.graph) return el('div');
    const edge = this.graph.edges.find((e) => e.from === from && e.to === to);
    const phase = edge?.phase ?? 'idle';
    const progress = edge?.progress ?? 0;
    const wrap = el('div', {
      class: 'edge' + (prefersReducedMotion() ? ' reduced' : ''),
      'data-from': from,
      'data-to': to,
    });
    // The rail is one inline SVG image: a rest line plus a drawn line that
    // grows, plus the capsule. The img carries the role and the attributes.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `
      <line class="rest" x1="0" y1="50" x2="100" y2="50" vector-effect="non-scaling-stroke" />
      <line class="rest rest-v" x1="50" y1="0" x2="50" y2="100" vector-effect="non-scaling-stroke" />
      <rect class="drawn" x="0" y="49" width="0" height="2" />
      <rect class="drawn drawn-v" x="49" y="0" width="2" height="0" />`;
    const img = el('img', {
      alt: `Promotion rail ${from === 'bundles' ? 'Bundles' : from} to ${to}`,
      'data-phase': phase,
      'data-progress': String(progress),
      src: `data:image/svg+xml,${encodeURIComponent(REST_EDGE_SVG)}`,
    });
    img.className = 'rail-img';
    img.appendChild(svg);
    wrap.appendChild(img);
    const segments = el('div');
    segments.innerHTML = `
      <div class="segments" aria-hidden="true">
        <span data-seg="queued">Queued</span><span data-seg="window_check">Window check</span><span data-seg="applying">Applying</span><span data-seg="health_wait">Health wait</span><span data-seg="healthy">Healthy</span>
      </div>`;
    while (segments.firstChild) wrap.appendChild(segments.firstChild);
    this.applyEdgeProgress(wrap, phase, progress, to);
    return wrap;
  }

  // The one place the DOM edge is updated from the server's phase and progress.
  private applyEdgeProgress(wrap: HTMLElement, phase: string, progress: number, to: string): void {
    const img = wrap.querySelector<HTMLElement>('img')!;
    img.setAttribute('data-phase', phase);
    img.setAttribute('data-progress', String(progress));
    const pct = Math.max(0, Math.min(1, progress)) * 100;
    const svg = img.querySelector<SVGElement>('svg')!;
    const hDrawn = svg.querySelector<SVGRectElement>('.drawn:not(.drawn-v)')!;
    const vDrawn = svg.querySelector<SVGRectElement>('.drawn-v')!;
    const hRest = svg.querySelector<SVGLineElement>('.rest:not(.rest-v)')!;
    const vRest = svg.querySelector<SVGLineElement>('.rest-v')!;
    const vertical = window.matchMedia('(max-width: 767px)').matches;
    const isDegraded = phase === 'degraded';
    const drawn = vertical ? vDrawn : hDrawn;
    const rest = vertical ? vRest : hRest;
    (vertical ? hRest : vRest).style.display = 'none';
    rest.style.display = '';
    drawn.style.fill = isDegraded ? 'var(--coral)' : 'var(--amber)';
    if (prefersReducedMotion()) {
      drawn.style.transition = 'none';
    } else {
      drawn.style.transition = 'width var(--medium) var(--ease), height var(--medium) var(--ease)';
    }
    if (vertical) {
      drawn.setAttribute('width', '2');
      drawn.setAttribute('height', String(pct));
    } else {
      drawn.setAttribute('width', String(pct));
      drawn.setAttribute('height', '2');
    }
    if (prefersReducedMotion()) {
      // Segments fill at once.
      const order = ['queued', 'window_check', 'applying', 'health_wait', 'healthy'];
      const reached = phase === 'degraded'
        ? ['queued', 'window_check', 'applying', 'health_wait']
        : order.slice(0, Math.max(1, order.indexOf(phase) + 1));
      wrap.querySelectorAll('[data-seg]').forEach((seg) => {
        const el2 = seg as HTMLElement;
        const hit = reached.includes(el2.dataset.seg!);
        el2.setAttribute('data-reached', hit ? 'true' : 'false');
        el2.classList.toggle('degraded', isDegraded && hit);
      });
    }
    // Capsule: only while the phase is active, at the tip of the drawn part.
    const capsuleActive = ['queued', 'window_check', 'applying', 'health_wait', 'degraded'].includes(phase);
    let capsule = wrap.querySelector<HTMLElement>('.capsule');
    const promo = this.graph?.nodes.find((n) => n.stage === to)?.active_promotion;
    const digest = promo?.bundle.short_digest;
    if (capsuleActive && digest) {
      if (!capsule) {
        capsule = el('span', { class: 'capsule', 'aria-hidden': 'true' });
        wrap.appendChild(capsule);
      }
      capsule.setAttribute('aria-label', `Bundle ${digest}`);
      capsule.textContent = digest;
      const pos = Math.max(0, Math.min(1, progress));
      if (prefersReducedMotion()) {
        capsule.style.transition = 'none';
      } else {
        capsule.style.transition = `left var(--medium) var(--ease), top var(--medium) var(--ease)`;
      }
      if (vertical) {
        capsule.style.left = '50%';
        capsule.style.top = `${pos * 100}%`;
      } else {
        capsule.style.top = '50%';
        capsule.style.left = `${pos * 100}%`;
      }
    } else if (capsule) {
      capsule.remove();
    }
  }

  private updateCapsules(): void {
    if (!this.graph) return;
    const vertical = window.matchMedia('(max-width: 767px)').matches;
    document.querySelectorAll<HTMLElement>('.edge').forEach((wrap) => {
      const from = wrap.dataset.from!;
      const to = wrap.dataset.to!;
      const edge = this.graph!.edges.find((e) => e.from === from && e.to === to);
      this.applyEdgeProgress(wrap, edge?.phase ?? 'idle', edge?.progress ?? 0, to);
      void vertical;
    });
  }

  // Announce each phase change once in the Promotion progress live region.
  private announcePhases(): void {
    if (!this.graph) return;
    for (const edge of this.graph.edges) {
      const key = `${edge.from}->${edge.to}`;
      const prev = this.lastPhases[key];
      const node = this.graph.nodes.find((n) => n.stage === edge.to);
      const version = node?.active_promotion?.bundle.version ?? node?.current?.version ?? '';
      if (edge.phase !== prev) {
        this.lastPhases[key] = edge.phase;
        if (edge.phase === 'idle' || !version) continue;
        const label = PHASE_LABELS[edge.phase] ?? edge.phase;
        this.setPromotionProgress(`${version} to ${edge.to}: ${label}`);
        if (edge.phase === 'healthy') this.flashNode(edge.to);
      }
    }
  }

  private progressEl(): HTMLElement | null {
    return document.getElementById('promotion-progress');
  }

  private setPromotionProgress(text: string): void {
    const el2 = this.progressEl();
    if (el2) el2.textContent = text;
  }

  private flashNode(stage: string): void {
    if (prefersReducedMotion()) {
      const node = document.querySelector<HTMLElement>(`[data-stage="${stage}"]`);
      if (node) {
        node.classList.add('flash');
        setTimeout(() => node.classList.remove('flash'), 2000);
      }
      return;
    }
    const now = Date.now();
    if ((this.nodeFlash[stage] ?? 0) > now - 1000) return;
    this.nodeFlash[stage] = now;
    const node = document.querySelector<HTMLElement>(`[data-stage="${stage}"]`);
    if (!node) return;
    node.classList.add('flash');
    setTimeout(() => node.classList.remove('flash'), 420);
  }

  // -------------------------------------------------------------- ledger

  private renderLedger(): HTMLElement {
    const ledger = el('div', { class: 'ledger', role: 'region', 'aria-label': 'Ledger' });
    ledger.innerHTML = `
      <div id="promotion-progress" role="status" aria-live="polite" aria-label="Promotion progress" class="visually-hidden"></div>
      <table><tbody id="ledger-body"></tbody></table>
      <div class="queue-row">
        <span id="queue-uploads"></span>
        <span id="queue-notices"></span>
        <span id="queue-reach" role="status" aria-live="polite" aria-label="Delivery queue"></span>
      </div>`;
    return ledger;
  }

  private renderLedgerRows(stages: GraphNode[], status: StatusInfo | null): void {
    const body = document.getElementById('ledger-body');
    if (!body) return;
    body.innerHTML = stages.map((n) => `
      <tr>
        <th scope="row">${esc(n.stage)}</th>
        <td>${esc(n.current?.version ?? '—')}</td>
        <td class="mono">${esc(n.current?.short_digest ?? '—')}</td>
        <td class="mono">${esc(this.lastHealthyAt(n))}</td>
        <td class="mono">${n.counter ? `in sync ${n.counter.in_sync}/${n.counter.total}` : 'in sync —'}</td>
      </tr>`).join('');
    const uploads = document.getElementById('queue-uploads');
    const notices = document.getElementById('queue-notices');
    const reach = document.getElementById('queue-reach');
    if (uploads) uploads.textContent = `Evidence uploads queued: ${status?.queued_uploads ?? 0}`;
    if (notices) notices.textContent = `Notices queued: ${status?.queued_notices ?? 0}`;
    const reachTexts: string[] = [];
    if (status?.storage === 'down') reachTexts.push('Evidence storage is unreachable. Snapshots are queued and will be stored when it returns.');
    if (status?.mail === 'down') reachTexts.push('Mail is unreachable. Notices are queued and will be sent when it returns.');
    if (reach) reach.textContent = reachTexts.join(' ');
  }

  private lastHealthyAt(n: GraphNode): string {
    const promo = n.active_promotion;
    if (promo && promo.state === 'healthy') return clusterTime(n.time_zone, promo.history.find((h) => h.to === 'healthy')?.at ?? null);
    return n.current ? clusterTime(n.time_zone, null) || '' : '';
  }

  // ------------------------------------------------------------ evidence

  private renderEvidence(): HTMLElement {
    const evidence = el('aside', {
      class: 'evidence',
      role: 'complementary',
      'aria-label': 'Evidence',
      id: 'evidence',
    });
    evidence.style.display = 'none';
    evidence.innerHTML = `
      <div class="close-bar" style="display:none"><button class="btn" data-close-evidence aria-label="Close">Close</button></div>
      <div id="evidence-body"></div>`;
    evidence.querySelector('[data-close-evidence]')!.addEventListener('click', () => this.closeEvidence());
    return evidence;
  }

  private closeEvidence(): void {
    const stage = this.selectedStage;
    this.selectedStage = null;
    this.selectedPromotionId = null;
    const col = document.getElementById('evidence');
    if (col) col.style.display = 'none';
    if (this.graph) {
      for (const node of this.graph.nodes) {
        const existing = document.querySelector<HTMLElement>(`[data-stage="${node.stage}"].node`);
        if (existing) this.updateStageNode(existing, node);
      }
    }
    if (stage) {
      const node = document.querySelector<HTMLElement>(`[data-stage="${stage}"].node`);
      node?.focus();
    }
  }

  selectStage(stage: string): void {
    this.selectedStage = stage;
    this.selectedPromotionId = null;
    void this.loadStageDetail(stage);
    if (this.graph) {
      for (const node of this.graph.nodes) {
        const existing = document.querySelector<HTMLElement>(`[data-stage="${node.stage}"].node`);
        if (existing) this.updateStageNode(existing, node);
      }
    }
    const col = document.getElementById('evidence');
    if (col) {
      col.style.display = 'flex';
      const narrow = window.matchMedia('(max-width: 767px)').matches;
      const bar = col.querySelector<HTMLElement>('.close-bar')!;
      bar.style.display = narrow ? 'flex' : 'none';
      this.focusEvidence();
    }
  }

  private focusEvidence(): void {
    const heading = document.querySelector<HTMLElement>('#evidence h2');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
  }

  selectPromotion(id: string): void {
    this.selectedPromotionId = id;
    void this.loadPromotionDetail(id);
  }

  private async loadStageDetail(stage: string): Promise<void> {
    try {
      const [promotions, health] = await Promise.all([
        api.promotions(this.slug, stage, 50) as Promise<{ promotions: Promotion[] }>,
        api.health(this.slug, stage) as Promise<HealthInfo>,
      ]);
      this.stagePromotions = promotions.promotions;
      this.stageHealth = health;
      const node = this.graph?.nodes.find((n) => n.stage === stage);
      const active = node?.active_promotion ?? null;
      const target = this.selectedPromotionId
        ? this.stagePromotions.find((p) => p.id === this.selectedPromotionId) ?? active ?? this.stagePromotions[0] ?? null
        : active ?? this.stagePromotions[0] ?? null;
      this.renderEvidenceBody(stage, node ?? null, target);
    } catch (err) {
      this.handleLoadError(err);
    }
  }

  private async loadPromotionDetail(id: string): Promise<void> {
    const stage = this.selectedStage;
    try {
      const promo = await api.promotion(id) as Promotion;
      const node = this.graph?.nodes.find((n) => n.stage === stage) ?? null;
      this.renderEvidenceBody(stage, node, promo);
    } catch (err) {
      this.handleLoadError(err);
    }
  }

  private renderEvidenceBody(stage: string | null, node: GraphNode | null, promotion: Promotion | null): void {
    const body = document.getElementById('evidence-body');
    if (!body) return;
    if (!stage || !node) {
      body.innerHTML = `<p class="note">Select a stage to read its evidence.</p>`;
      return;
    }
    const col = document.getElementById('evidence');
    if (col) col.setAttribute('aria-label', `Evidence for ${stage}`);
    const zone = node.time_zone;
    const header = promotion
      ? `
        <h2 tabindex="-1">${esc(promotion.bundle.version)} · ${esc(promotion.bundle.short_digest)}</h2>
        <div class="sub">${statePill(promotion.state)} <span>requested by ${esc(promotion.requested_by.name)}</span></div>`
      : `<h2 tabindex="-1">${esc(stage)}</h2><div class="sub">No promotion yet.</div>`;
    const actions = this.renderActions(node, promotion);
    const diff = promotion
      ? promotion.diff.length
        ? promotion.diff.map((d) => `<tr><td>${esc(d.resource)}</td><td><code>${esc(d.path || '—')}</code></td><td>${esc(d.change)}</td><td><code>${esc(d.before ?? '')}</code></td><td><code>${esc(d.after ?? '')}</code></td></tr>`).join('')
        : `<tr><td colspan="5" class="note">No changes.</td></tr>`
      : '';
    const approvals = promotion?.approval
      ? `<dl class="kv">
          <dt>Decision</dt><dd>${esc(promotion.approval.state)}</dd>
          <dt>By</dt><dd>${esc(promotion.approval.decided_by ?? '—')}</dd>
          <dt>When</dt><dd>${esc(clusterTime(zone, promotion.approval.decided_at))}</dd>
          <dt>Expiry</dt><dd>${esc(clusterTime(zone, promotion.approval.expires_at ?? promotion.approval.request_expires_at))}</dd>
        </dl>`
      : `<p class="note">This stage does not require approval.</p>`;
    const windowBlock = promotion
      ? (promotion.window_decision
        ? `<dl class="kv">
            <dt>Open</dt><dd>${promotion.window_decision.open ? 'Open' : 'Closed'}</dd>
            <dt>Reason</dt><dd>${esc(this.windowReason(promotion.window_decision, node))}</dd>
            <dt>Local time</dt><dd class="mono">${esc(promotion.window_decision.local_time)} ${esc(zone)}</dd>
            <dt>Policy version</dt><dd class="mono">${promotion.policy_version}</dd>
          </dl>`
        : `<p class="note">Not checked yet. The window is checked when the promotion starts.</p><p class="sub mono">Policy version ${promotion.policy_version}</p>`)
      : '';
    const healthRows = this.stageHealth && this.stageHealth.resources.length
      ? this.stageHealth.resources.map((r) => `<tr><td>${esc(r.ref)}</td><td>${statusPill(r.sync)}</td><td>${statusPill(r.health)}</td></tr>`).join('')
      : `<tr><td colspan="3" class="note">Nothing deployed yet.</td></tr>`;
    const healthCaption = promotion && ['applying', 'health_wait', 'healthy', 'degraded'].includes(promotion.state) && this.stageHealth?.revision === promotion.id
      ? `Health`
      : this.stageHealth?.revision
        ? `Live revision ${esc(this.graph?.nodes.find((n) => n.stage === stage)?.current?.short_digest ?? '')}`
        : '';
    const history = promotion
      ? promotion.history.map((h) => `<div class="history-row"><span class="mono">${esc(h.at.slice(0, 16).replace('T', ' '))}</span><span>${esc(h.from ?? '∅')} → ${esc(h.to)}</span><span>${esc(h.by)}</span></div>`).join('')
      : '';
    const list = this.stagePromotions.map((p) => `
      <button data-promo="${esc(p.id)}" class="${p.id === promotion?.id ? 'selected' : ''}">
        <span>${esc(p.bundle.version)} · ${esc(p.bundle.short_digest)}</span>
        <span class="mono">${esc(p.state.replace(/_/g, ' '))}</span>
      </button>`).join('');

    body.innerHTML = `
      ${header}
      <div class="actions">${actions}</div>
      <section>
        <h4>Diff</h4>
        <table><thead><tr><th>Resource</th><th>Path</th><th>Change</th><th>Before</th><th>After</th></tr></thead><tbody>${diff}</tbody></table>
      </section>
      <section>
        <h4>Approvals</h4>
        ${approvals}
      </section>
      <section>
        <h4>Window decision</h4>
        ${windowBlock}
      </section>
      <section>
        <h4>Health</h4>
        ${healthCaption ? `<p class="sub">${healthCaption}</p>` : ''}
        <table aria-label="Resource health"><thead><tr><th>Resource</th><th>Sync</th><th>Health</th></tr></thead><tbody>${healthRows}</tbody></table>
      </section>
      <section>
        <h4>History</h4>
        ${history}
      </section>
      <section>
        <h4>Promotions</h4>
        <div class="promotion-list">${list}</div>
      </section>`;
    body.querySelectorAll('[data-promo]').forEach((b) => {
      b.addEventListener('click', () => this.selectPromotion((b as HTMLElement).dataset.promo!));
    });
    this.wireActions(body, node, promotion);
  }

  private windowReason(d: Decision, node: GraphNode): string {
    if (d.open) return d.window ? `open (${d.window.label})` : 'open';
    if (d.reason === 'freeze' && d.freeze) return `freeze "${d.freeze.name}" is in force`;
    return `outside the sync window for ${node.cluster} (${node.time_zone})`;
  }

  // ------------------------------------------------------------ actions

  private can(kind: string): boolean {
    const role = this.graph?.role;
    if (!role) return false;
    return (ROLE_ACTIONS[kind] ?? []).includes(role);
  }

  private renderActions(node: GraphNode, promo: Promotion | null): string {
    const buttons: string[] = [];
    if (this.can('promote') && !node.active_promotion) {
      buttons.push('<button class="btn primary" data-act="promote">Promote</button>');
    }
    if (this.can('approve') && promo?.state === 'awaiting_approval') {
      buttons.push('<button class="btn primary" data-act="approve">Approve</button>');
      buttons.push('<button class="btn danger" data-act="reject">Reject</button>');
    }
    if (this.can('start') && promo?.state === 'approved') {
      buttons.push('<button class="btn primary" data-act="start">Start promotion</button>');
    }
    if (this.can('retry_window') && promo?.state === 'window_blocked') {
      buttons.push('<button class="btn" data-act="retry-window">Re-check window</button>');
    }
    if (this.can('break_freeze') && promo?.state === 'window_blocked') {
      buttons.push('<button class="btn" data-act="break-freeze">Break freeze</button>');
    }
    if (this.can('rollback') && !node.active_promotion && node.current) {
      buttons.push('<button class="btn" data-act="rollback">Roll back</button>');
    }
    if (this.can('download') && promo) {
      buttons.push('<button class="btn" data-act="download">Download evidence</button>');
    }
    buttons.push('<button class="btn" data-act="close">Close</button>');
    return buttons.join('');
  }

  private wireActions(body: HTMLElement, node: GraphNode, promo: Promotion | null): void {
    body.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = (btn as HTMLElement).dataset.act;
        switch (act) {
          case 'promote': void this.openPromoteDialog(node); break;
          case 'approve': void this.openApproveDialog(node, promo!); break;
          case 'reject': void this.openRejectDialog(node, promo!); break;
          case 'start': void this.doStart(promo!); break;
          case 'retry-window': void this.doRetryWindow(promo!); break;
          case 'break-freeze': void this.openBreakFreezeDialog(node, promo!); break;
          case 'rollback': void this.openRollbackDialog(node); break;
          case 'download': void this.doDownload(promo!); break;
          case 'close': this.closeEvidence(); break;
        }
      });
    });
  }

  private async verifiedBundleOptions(stage: GraphNode): Promise<{ value: string; label: string }[]> {
    const bundles = await api.bundles(this.slug) as { bundles: Bundle[] };
    this.bundles = bundles.bundles;
    if (!stage.upstream) {
      return this.bundles.map((b) => ({ value: b.version, label: `${b.version} · ${b.short_digest}` }));
    }
    return this.bundles
      .filter((b) => b.verified_in.includes(stage.upstream!))
      .map((b) => ({ value: b.version, label: `${b.version} · ${b.short_digest}` }));
  }

  private async openPromoteDialog(node: GraphNode): Promise<void> {
    const options = await this.verifiedBundleOptions(node);
    if (options.length === 0) {
      this.live.problem(`No bundle has reached Healthy in ${node.upstream ?? 'any stage'} yet.`);
      return;
    }
    const defaults = this.stageDefaults(node);
    this.dialogs.open({
      title: `Promote to ${node.stage}`,
      select: { name: 'bundle_version', label: 'Release bundle', options },
      showSummary: {
        label: 'Overrides frozen into this promotion',
        rows: [
          ...Object.entries(defaults.parameters).map(([k, v]) => `${k}=${v}`),
          ...Object.entries(defaults.replicas).map(([k, v]) => `${k}=${v}`),
        ],
      },
      confirmLabel: 'Request promotion',
      onSubmit: async (values) => {
        this.live.activity(`Requesting promotion…`);
        const key = newRequestKey();
        try {
          const result = await api.requestPromotion(this.slug, node.stage, { bundle_version: values.bundle_version }, key) as Promotion;
          this.afterPromotion(result, node);
        } catch (err) {
          throw err;
        }
      },
    });
  }

  private stageDefaults(node: GraphNode): { parameters: Record<string, string>; replicas: Record<string, number> } {
    // The server merges defaults; the dialog shows the current stage defaults as
    // the frozen overrides summary. Read from the graph's active/current promotion
    // or fall back to an empty set; the server is authoritative.
    const promo = node.active_promotion;
    if (promo) return promo.overrides;
    return { parameters: {}, replicas: {} };
  }

  private afterPromotion(result: Promotion, node: GraphNode): void {
    if (result.state === 'awaiting_approval') {
      this.live.activity(`Promotion of ${result.bundle.version} to ${node.stage} is waiting for approval.`);
    } else if (result.state === 'applying') {
      this.live.activity(`Promotion of ${result.bundle.version} to ${node.stage} started.`);
    } else if (result.state === 'window_blocked') {
      const reason = result.window_decision?.reason === 'freeze' && result.window_decision.freeze
        ? `freeze "${result.window_decision.freeze.name}" is in force`
        : `outside the sync window for ${node.cluster} (${node.time_zone})`;
      this.live.activity(`Promotion of ${result.bundle.version} to ${node.stage} is blocked: ${reason}.`);
    }
    this.graphRefresher?.wake();
    void this.loadStageDetail(node.stage);
  }

  private openApproveDialog(node: GraphNode, promo: Promotion): void {
    this.dialogs.open({
      title: `Approve ${promo.bundle.version} to ${node.stage}`,
      fields: [{ name: 'comment', label: 'Comment', type: 'textarea' }],
      confirmLabel: 'Approve promotion',
      onSubmit: async (values) => {
        this.live.activity('Recording approval…');
        await api.approve(promo.id, values.comment, newRequestKey());
        const fresh = await api.promotion(promo.id) as Promotion;
        const expiry = clusterTime(node.time_zone, fresh.approval?.expires_at ?? null);
        this.live.activity(`Approved until ${expiry}. The requester will be notified.`);
        void this.loadStageDetail(node.stage);
        this.graphRefresher?.wake();
      },
    });
  }

  private openRejectDialog(node: GraphNode, promo: Promotion): void {
    this.dialogs.open({
      title: `Reject ${promo.bundle.version} to ${node.stage}`,
      fields: [{ name: 'reason', label: 'Reason', type: 'textarea' }],
      confirmLabel: 'Reject promotion',
      confirmClass: 'danger',
      onSubmit: async (values) => {
        this.live.activity('Recording rejection…');
        await api.reject(promo.id, values.reason, newRequestKey());
        this.live.activity('Rejected. The requester will be notified.');
        void this.loadStageDetail(node.stage);
        this.graphRefresher?.wake();
      },
    });
  }

  private async doStart(promo: Promotion): Promise<void> {
    this.live.activity('Starting…');
    try {
      const fresh = await api.start(promo.id, newRequestKey()) as Promotion;
      const node = this.graph?.nodes.find((n) => n.stage === fresh.stage);
      if (fresh.state === 'applying') {
        this.live.activity(`Started. Applying ${fresh.bundle.version} to ${fresh.stage}.`);
      } else if (fresh.state === 'window_blocked' && node) {
        this.live.activity(this.blockedCopy(fresh, node));
      }
      void this.loadStageDetail(fresh.stage);
      this.graphRefresher?.wake();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'approval_expired') {
        const zone = this.graph?.nodes.find((n) => n.stage === promo.stage)?.time_zone ?? 'UTC';
        this.live.problem(`This approval expired at ${clusterTime(zone, promo.approval?.expires_at ?? null)}. Request a new promotion.`);
      } else {
        throw err;
      }
    }
  }

  private blockedCopy(promo: Promotion, node: GraphNode): string {
    const reason = promo.window_decision?.reason === 'freeze' && promo.window_decision.freeze
      ? `freeze "${promo.window_decision.freeze.name}" is in force`
      : `outside the sync window for ${node.cluster} (${node.time_zone})`;
    return `Promotion of ${promo.bundle.version} to ${node.stage} is blocked: ${reason}.`;
  }

  private async doRetryWindow(promo: Promotion): Promise<void> {
    this.live.activity('Checking the window…');
    try {
      const fresh = await api.retryWindow(promo.id, newRequestKey()) as Promotion;
      const node = this.graph?.nodes.find((n) => n.stage === fresh.stage);
      if (fresh.state === 'applying') {
        this.live.activity(`Started. Applying ${fresh.bundle.version} to ${fresh.stage}.`);
      } else if (node) {
        this.live.activity(this.blockedCopy(fresh, node));
      }
      void this.loadStageDetail(fresh.stage);
      this.graphRefresher?.wake();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'approval_expired') {
        const zone = this.graph?.nodes.find((n) => n.stage === promo.stage)?.time_zone ?? 'UTC';
        this.live.problem(`This approval expired at ${clusterTime(zone, promo.approval?.expires_at ?? null)}. Request a new promotion.`);
      } else {
        throw err;
      }
    }
  }

  private openBreakFreezeDialog(node: GraphNode, promo: Promotion): void {
    this.dialogs.open({
      title: `Break freeze on ${node.stage}`,
      fields: [{ name: 'reason', label: 'Incident reason', type: 'textarea' }],
      confirmLabel: 'Break freeze and start',
      confirmClass: 'danger',
      onSubmit: async (values) => {
        this.live.activity('Breaking the freeze…');
        await api.breakFreeze(promo.id, values.reason, newRequestKey());
        this.live.activity(`Freeze broken. Applying ${promo.bundle.version} to ${node.stage}. Release managers will be notified.`);
        void this.loadStageDetail(node.stage);
        this.graphRefresher?.wake();
      },
    });
  }

  private openRollbackDialog(node: GraphNode): void {
    const lastHealthy = this.stagePromotions.find((p) => p.state === 'healthy' && p.id !== node.current?.promotion_id);
    if (!lastHealthy) {
      this.live.problem(`${node.stage} has no earlier healthy revision to roll back to.`);
      return;
    }
    this.dialogs.open({
      title: `Roll back ${node.stage}`,
      body: `Restores ${lastHealthy.bundle.version} (${lastHealthy.bundle.short_digest})`,
      fields: [{ name: 'reason', label: 'Incident reason', type: 'textarea' }],
      confirmLabel: `Roll back to ${lastHealthy.bundle.version}`,
      confirmClass: 'danger',
      onSubmit: async (values) => {
        this.live.activity('Starting rollback…');
        const fresh = await api.rollback(this.slug, node.stage, values.reason, newRequestKey()) as Promotion;
        if (fresh.state === 'applying') {
          this.live.activity(`Rolling ${node.stage} back to ${fresh.bundle.version} (${fresh.bundle.short_digest}).`);
        } else {
          this.live.activity(`Promotion of ${fresh.bundle.version} to ${node.stage} is blocked: ${this.blockedCopyFresh(fresh, node)}.`);
        }
        void this.loadStageDetail(node.stage);
        this.graphRefresher?.wake();
      },
    });
  }

  private blockedCopyFresh(promo: Promotion, node: GraphNode): string {
    const reason = promo.window_decision?.reason === 'freeze' && promo.window_decision.freeze
      ? `freeze "${promo.window_decision.freeze.name}" is in force`
      : `outside the sync window for ${node.cluster} (${node.time_zone})`;
    return reason;
  }

  private async doDownload(promo: Promotion): Promise<void> {
    this.live.activity('Preparing evidence…');
    try {
      const res = await fetch(`/api/promotions/${promo.id}/evidence`, { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        if (body?.error === 'evidence_pending') {
          this.live.problem('No evidence snapshot is stored yet. It will be saved when storage returns.');
        } else if (body?.error === 'storage_unavailable') {
          this.live.problem('Evidence storage is unreachable. Try the download again when it returns.');
        } else {
          this.live.problem('Keelson could not reach the server. Your last action was not confirmed.');
        }
        return;
      }
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `keelson-evidence-${promo.id}.json`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      this.live.activity('Evidence downloaded.');
    } catch {
      this.live.problem('Keelson could not reach the server. Your last action was not confirmed.');
    }
  }

  // ------------------------------------------------------------ refresh

  private async refresh(first = false): Promise<void> {
    try {
      const [graph, status] = await Promise.all([
        api.graph(this.slug) as Promise<Graph>,
        api.status() as Promise<StatusInfo>,
      ]);
      this.graph = graph;
      this.status = status;
      document.title = `${graph.project.name} · Keelson`;
      this.renderGraph();
      this.renderLedgerRows(graph.nodes, status);
      if (this.selectedStage && first) {
        void this.loadStageDetail(this.selectedStage);
      }
    } catch (err) {
      this.handleLoadError(err);
    }
  }

  private refreshTimes(): void {
    if (this.graph) this.renderLedgerRows(this.graph.nodes, this.status);
  }

  private handleLoadError(err: unknown): void {
    if (err instanceof ApiError && err.code === 'unauthenticated') {
      this.onSessionEnded();
      return;
    }
    if (err instanceof Error) this.live.problem(err.message);
  }
}
