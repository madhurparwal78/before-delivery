import type {
  Bundle,
  GraphEdge,
  GraphNode,
  GraphResponse,
  Promotion,
  SessionResponse,
  StageHealthResponse,
  StatusResponse,
} from '../../shared/types.js';
import { clusterTime } from '../../shared/zone.js';
import { get } from '../api.js';
import { PHASE_LABEL, copy } from '../copy.js';
import { topDialog } from '../dialog.js';
import { clear, el, mount, prefersReducedMotion, svgIcon } from '../dom.js';
import { icons, statusChip } from '../icons.js';
import { isSessionGone, problem, progress } from '../live.js';
import { countUp, createEdge, type EdgeView } from '../rail.js';
import { navigate } from '../router.js';
import { refreshPromoteOptions, renderEvidence, type EvidenceContext } from './evidence.js';

const REFRESH_MS = 2000;

interface NodeView {
  button: HTMLButtonElement;
  statusSlot: HTMLElement;
  currentSlot: HTMLElement;
  desiredSlot: HTMLElement;
  counterSlot: HTMLElement;
  lastStatus: string | null;
  lastCounter: number | null;
  lastPhase: string | null;
}

interface LedgerRow {
  version: HTMLElement;
  digest: HTMLElement;
  healthyAt: HTMLElement;
  counter: HTMLElement;
  card: HTMLElement;
}

/** Depth 0 is the Bundles intake, depth 1 the first stage, and so on down the pipeline. */
function depthOf(node: GraphNode, nodes: GraphNode[]): number {
  let depth = 1;
  let cursor = node;
  for (;;) {
    const upstream = cursor.upstream;
    if (!upstream) return depth;
    const parent = nodes.find((candidate) => candidate.stage === upstream);
    if (!parent) return depth;
    cursor = parent;
    depth += 1;
  }
}

export async function renderWorkspace(
  slug: string,
  session: SessionResponse,
  initial: { stage: string | null; promotion: string | null },
): Promise<void> {
  let graph = await get<GraphResponse>(`/api/projects/${slug}/graph`);
  let status = await get<StatusResponse>('/api/status');
  let bundles: Bundle[] = [];
  let projectPromotions: Promotion[] = [];
  let stagePromotions: Promotion[] = [];
  let stageHealth: StageHealthResponse | null = null;

  let selectedStage: string | null =
    initial.stage && graph.nodes.some((node) => node.stage === initial.stage) ? initial.stage : null;
  let selectedPromotionId: string | null = initial.promotion;
  let evidenceSignature = '';
  let announcedPhases = new Map<string, string>();

  const nodeViews = new Map<string, NodeView>();
  const edgeViews = new Map<string, EdgeView>();
  const ledgerRows = new Map<string, LedgerRow>();

  // ---------- shell ----------

  const projectNav = el('nav', { 'aria-label': 'Projects' });
  const stageNav = el('nav', { 'aria-label': 'Stages' });
  const signOut = el('button', { type: 'button', class: 'btn btn--quiet' }, ['Sign out']);
  const railPanel = el('div', { class: 'rail', 'data-open': 'false' }, [
    el('div', { class: 'rail__brand' }, ['Keelson']),
    el('div', {}, [el('div', { class: 'rail__group-title' }, ['Projects']), projectNav]),
    el('div', {}, [el('div', { class: 'rail__group-title' }, ['Stages']), stageNav]),
    el('a', { class: 'rail__link', href: `/projects/${slug}/windows` }, [
      svgIcon(icons.clock),
      'Windows and freezes',
    ]),
    el('div', { class: 'rail__spacer' }),
    el('div', { class: 'rail__person' }, [
      el('strong', {}, [session.user.name]),
      el('span', {}, [graph.role.replace(/_/g, ' ')]),
    ]),
    signOut,
  ]);

  const menuButton = el('button', { type: 'button', class: 'btn btn--quiet' }, [
    svgIcon(icons.menu),
    'Menu',
  ]);
  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = railPanel.getAttribute('data-open') === 'true';
    railPanel.setAttribute('data-open', open ? 'false' : 'true');
  });
  // The narrow-screen drawer sits over the graph, so a press anywhere else puts it away.
  document.addEventListener('click', (event) => {
    if (railPanel.getAttribute('data-open') !== 'true') return;
    if (railPanel.contains(event.target as Node)) return;
    railPanel.setAttribute('data-open', 'false');
  });
  const topbar = el('div', { class: 'topbar' }, [
    menuButton,
    el('span', { class: 'topbar__brand' }, ['Keelson']),
    el('span', {}, [graph.project.name]),
  ]);

  signOut.addEventListener('click', () => {
    void fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' }).then(() =>
      navigate('/sign-in'),
    );
  });

  const graphGrid = el('div', { class: 'graph__grid' });
  const graphRegion = el('section', { class: 'graph', 'aria-label': 'Stage graph' }, [graphGrid]);
  const ledgerBody = el('tbody');
  const ledgerCards = el('div', { class: 'ledger__cards' });
  const queueUploads = el('span', { class: 'mono' });
  const queueNotices = el('span', { class: 'mono' });
  const queueMessages = el('div', {
    id: 'queue-notices',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Delivery queue',
  });
  const ledger = el('section', { class: 'ledger', 'aria-label': 'Ledger' }, [
    el('div', { class: 'ledger__title' }, ['Ledger']),
    el('table', {}, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Stage']),
          el('th', {}, ['Version']),
          el('th', {}, ['Digest']),
          el('th', {}, ['Last healthy']),
          el('th', {}, ['In sync']),
        ]),
      ]),
      ledgerBody,
    ]),
    ledgerCards,
    el('div', { class: 'ledger__queue' }, [queueUploads, queueNotices]),
    queueMessages,
  ]);

  const fieldArea = el('div', { class: 'field-area' }, [graphRegion, ledger]);
  const shell = el('div', { class: 'workspace', 'data-evidence': 'closed' }, [
    topbar,
    railPanel,
    fieldArea,
  ]);
  let evidenceColumn: HTMLElement | null = null;

  // ---------- rail navigation ----------

  function renderProjectNav(): void {
    clear(projectNav);
    projectNav.append(
      el(
        'ul',
        {},
        session.memberships.map((membership) =>
          el('li', {}, [
            el(
              'a',
              {
                href: `/projects/${membership.project}`,
                'aria-current': membership.project === slug ? 'true' : null,
              },
              [membership.project === slug ? graph.project.name : membership.project],
            ),
          ]),
        ),
      ),
    );
  }

  function renderStageNav(): void {
    clear(stageNav);
    stageNav.append(
      el(
        'ul',
        {},
        graph.nodes.map((node) => {
          const link = el('a', { href: `#${node.stage}`, 'aria-current': node.stage === selectedStage ? 'true' : null }, [
            node.stage,
          ]);
          link.addEventListener('click', (event) => {
            event.preventDefault();
            selectStage(node.stage, { focusColumn: true });
          });
          return el('li', {}, [link]);
        }),
      ),
    );
  }

  // ---------- graph ----------

  function buildGraph(): void {
    clear(graphGrid);
    nodeViews.clear();
    edgeViews.clear();

    const byDepth = new Map<number, GraphNode[]>();
    for (const node of graph.nodes) {
      const depth = depthOf(node, graph.nodes);
      const bucket = byDepth.get(depth);
      if (bucket) bucket.push(node);
      else byDepth.set(depth, [node]);
    }
    const maxDepth = Math.max(...byDepth.keys());
    const rows = Math.max(...[...byDepth.values()].map((bucket) => bucket.length));
    graphGrid.style.gridTemplateColumns = `repeat(${maxDepth}, auto minmax(28px, 1fr)) auto`;
    graphGrid.style.gridTemplateRows = `repeat(${rows}, auto)`;

    const intake = el('div', { class: 'intake' }, [
      svgIcon(icons.package),
      el('span', { class: 'intake__title' }, ['Bundles']),
      el('span', { class: 'intake__meta' }, [`${bundles.length} ingested`]),
    ]);
    intake.style.gridColumn = '1';
    intake.style.gridRow = `1 / span ${rows}`;
    graphGrid.append(intake);

    for (const [depth, bucket] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
      bucket.forEach((node, index) => {
        // The edge is appended before its target, so the vertical stack reads source, edge,
        // target. The wide layout places both explicitly, so document order does not matter.
        const edge = createEdge(node.upstream ?? 'Bundles', node.stage);
        edge.root.style.gridColumn = String(depth * 2);
        edge.root.style.gridRow = bucket.length === 1 ? `1 / span ${rows}` : String(index + 1);
        graphGrid.append(edge.root);
        edgeViews.set(node.stage, edge);

        const view = buildNode(node);
        view.button.style.gridColumn = String(depth * 2 + 1);
        view.button.style.gridRow =
          bucket.length === 1 ? `1 / span ${rows}` : String(index + 1);
        graphGrid.append(view.button);
        nodeViews.set(node.stage, view);
      });
    }
  }

  function buildNode(node: GraphNode): NodeView {
    const statusSlot = el('span', {});
    const currentSlot = el('span', { class: 'node__tag' });
    const desiredSlot = el('span', { class: 'node__tag node__tag--desired' });
    const counterSlot = el('span', { class: 'node__counter' });
    const button = el(
      'button',
      {
        type: 'button',
        class: 'node',
        'aria-label': `Stage ${node.stage}`,
        'aria-pressed': 'false',
        'data-stage': node.stage,
        'data-status': node.status,
      },
      [
        el('span', { class: 'node__name' }, [node.stage]),
        el('span', { class: 'node__cluster' }, [`${node.cluster} · ${node.time_zone}`]),
        statusSlot,
        currentSlot,
        desiredSlot,
        counterSlot,
        el('span', { class: 'node__selected' }, ['Selected']),
      ],
    );
    button.addEventListener('click', () => selectStage(node.stage, { focusColumn: true }));
    button.addEventListener('keydown', (event) => {
      const order = graph.nodes.map((candidate) => candidate.stage);
      const at = order.indexOf(node.stage);
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = order[Math.min(order.length - 1, at + 1)];
        if (next) nodeViews.get(next)?.button.focus();
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        const previous = order[Math.max(0, at - 1)];
        if (previous) nodeViews.get(previous)?.button.focus();
      }
    });
    return {
      button,
      statusSlot,
      currentSlot,
      desiredSlot,
      counterSlot,
      lastStatus: null,
      lastCounter: null,
      lastPhase: null,
    };
  }

  function paintNode(node: GraphNode, edge: GraphEdge): void {
    const view = nodeViews.get(node.stage);
    if (!view) return;

    view.button.setAttribute('data-status', node.status);
    if (view.lastStatus !== node.status) {
      view.statusSlot.replaceChildren(statusChip(node.status));
      view.lastStatus = node.status;
    }

    const currentText = node.current ? `current ${node.current.short_digest}` : 'current —';
    if (view.currentSlot.textContent !== currentText) view.currentSlot.textContent = currentText;

    const desired = node.active_promotion;
    const desiredText = desired ? `desired ${desired.bundle.short_digest}` : '';
    if (view.desiredSlot.textContent !== desiredText) view.desiredSlot.textContent = desiredText;

    const counter = node.counter;
    if (!counter) {
      view.counterSlot.textContent = 'in sync 0/0';
      view.lastCounter = null;
    } else if (view.lastCounter === null) {
      view.counterSlot.textContent = `in sync ${counter.in_sync}/${counter.total}`;
      view.lastCounter = counter.in_sync;
    } else if (view.lastCounter !== counter.in_sync) {
      countUp(view.counterSlot, view.lastCounter, counter.in_sync, counter.total);
      view.lastCounter = counter.in_sync;
    } else {
      view.counterSlot.textContent = `in sync ${counter.in_sync}/${counter.total}`;
    }

    if (view.lastPhase !== edge.phase) {
      if (edge.phase === 'healthy' && view.lastPhase !== null) flashNode(view.button);
      view.lastPhase = edge.phase;
    }
  }

  function flashNode(button: HTMLElement): void {
    button.setAttribute('data-flash', 'healthy');
    window.setTimeout(() => button.removeAttribute('data-flash'), prefersReducedMotion() ? 2000 : 460);
  }

  function announcePhases(): void {
    for (const edge of graph.edges) {
      if (!edge.promotion_id) continue;
      const node = graph.nodes.find((candidate) => candidate.stage === edge.to);
      const promotion =
        node?.active_promotion ??
        projectPromotions.find((candidate) => candidate.id === edge.promotion_id);
      if (!promotion) continue;
      const key = `${edge.promotion_id}`;
      if (announcedPhases.get(key) === edge.phase) continue;
      announcedPhases.set(key, edge.phase);
      if (edge.phase === 'idle') continue;
      progress(`${promotion.bundle.version} to ${edge.to}: ${PHASE_LABEL[edge.phase]}`);
    }
  }

  // ---------- ledger ----------

  function buildLedger(): void {
    clear(ledgerBody);
    clear(ledgerCards);
    ledgerRows.clear();
    for (const node of graph.nodes) {
      const version = el('td', { class: 'mono' }, ['—']);
      const digest = el('td', { class: 'mono' }, ['—']);
      const healthyAt = el('td', { class: 'mono' }, ['—']);
      const counter = el('td', { class: 'mono' }, ['in sync 0/0']);
      ledgerBody.append(
        el('tr', { 'data-stage': node.stage }, [
          el('td', { class: 'mono' }, [node.stage]),
          version,
          digest,
          healthyAt,
          counter,
        ]),
      );
      const card = el('div', { class: 'ledger__card', 'data-stage': node.stage });
      ledgerCards.append(card);
      ledgerRows.set(node.stage, { version, digest, healthyAt, counter, card });
    }
  }

  function paintLedger(): void {
    for (const node of graph.nodes) {
      const row = ledgerRows.get(node.stage);
      if (!row) continue;
      const current = node.current
        ? projectPromotions.find((candidate) => candidate.id === node.current?.promotion_id)
        : undefined;
      const healthyEntry = current?.history.filter((entry) => entry.to === 'healthy').at(-1);
      const versionText = node.current?.version ?? '—';
      const digestText = node.current?.short_digest ?? '—';
      const healthyText = healthyEntry ? clusterTime(healthyEntry.at, node.time_zone) : '—';
      const counterText = node.counter
        ? `in sync ${node.counter.in_sync}/${node.counter.total}`
        : 'in sync 0/0';

      row.version.textContent = versionText;
      row.digest.textContent = digestText;
      row.healthyAt.textContent = healthyText;
      row.counter.textContent = counterText;
      row.card.replaceChildren(
        el('dl', {}, [
          el('dt', {}, ['Stage']),
          el('dd', {}, [node.stage]),
          el('dt', {}, ['Version']),
          el('dd', {}, [versionText]),
          el('dt', {}, ['Digest']),
          el('dd', {}, [digestText]),
          el('dt', {}, ['Last healthy']),
          el('dd', {}, [healthyText]),
          el('dt', {}, ['In sync']),
          el('dd', {}, [counterText]),
        ]),
      );
    }
    queueUploads.textContent = `Evidence uploads queued: ${status.queued_uploads}`;
    queueNotices.textContent = `Notices queued: ${status.queued_notices}`;

    const notices: string[] = [];
    if (status.storage === 'down') notices.push(copy.storageDownNotice);
    if (status.mail === 'down') notices.push(copy.mailDownNotice);
    const existing = [...queueMessages.children].map((child) => child.textContent ?? '');
    if (existing.join('|') !== notices.join('|')) {
      queueMessages.replaceChildren(...notices.map((text) => el('p', {}, [text])));
    }
  }

  // ---------- evidence column ----------

  function shownPromotion(node: GraphNode): Promotion | null {
    if (selectedPromotionId) {
      const picked = stagePromotions.find((candidate) => candidate.id === selectedPromotionId);
      if (picked) return picked;
    }
    if (node.active_promotion) return node.active_promotion;
    if (node.current) {
      return stagePromotions.find((candidate) => candidate.id === node.current?.promotion_id) ?? null;
    }
    return null;
  }

  function paintEvidence(focusColumn: boolean): void {
    if (!selectedStage) {
      shell.setAttribute('data-evidence', 'closed');
      evidenceColumn?.remove();
      evidenceColumn = null;
      evidenceSignature = '';
      return;
    }
    const node = graph.nodes.find((candidate) => candidate.stage === selectedStage);
    if (!node) return;

    const promotion = shownPromotion(node);
    const signature = JSON.stringify([
      node.stage,
      node.status,
      node.current,
      node.counter,
      promotion?.id,
      promotion?.state,
      promotion?.phase,
      promotion?.window_decision,
      promotion?.approval,
      promotion?.evidence,
      promotion?.history.length,
      stageHealth?.resources,
      stagePromotions.map((candidate) => `${candidate.id}:${candidate.state}`),
      bundles.map((bundle) => bundle.version),
      selectedPromotionId,
    ]);
    if (signature === evidenceSignature && evidenceColumn) return;
    evidenceSignature = signature;

    const context: EvidenceContext = {
      slug,
      node,
      role: graph.role,
      shown: promotion,
      health: stageHealth,
      promotions: stagePromotions,
      bundles,
      selectedPromotionId,
      selectPromotion(id) {
        selectedPromotionId = id;
        evidenceSignature = '';
        paintEvidence(false);
      },
      close() {
        closeEvidence();
      },
      refresh() {
        void poll();
      },
    };

    const column = renderEvidence(context);
    if (evidenceColumn) evidenceColumn.replaceWith(column);
    else shell.append(column);
    evidenceColumn = column;
    shell.setAttribute('data-evidence', 'open');
    if (focusColumn) column.querySelector<HTMLElement>('#evidence-heading')?.focus();
  }

  function selectStage(stage: string, options: { focusColumn: boolean }): void {
    if (selectedStage !== stage) selectedPromotionId = null;
    selectedStage = stage;
    stageHealth = null;
    stagePromotions = [];
    evidenceSignature = '';
    for (const [name, view] of nodeViews) {
      view.button.setAttribute('aria-pressed', name === stage ? 'true' : 'false');
    }
    renderStageNav();
    railPanel.setAttribute('data-open', 'false');
    window.history.replaceState(null, '', `/projects/${slug}?stage=${encodeURIComponent(stage)}`);
    paintEvidence(options.focusColumn);
    void poll();
  }

  function closeEvidence(): void {
    const stage = selectedStage;
    selectedStage = null;
    selectedPromotionId = null;
    for (const view of nodeViews.values()) view.button.setAttribute('aria-pressed', 'false');
    renderStageNav();
    window.history.replaceState(null, '', `/projects/${slug}`);
    paintEvidence(false);
    if (stage) nodeViews.get(stage)?.button.focus();
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || topDialog() !== null) return;
    if (selectedStage) closeEvidence();
  });

  // ---------- polling ----------

  let polling = false;

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const [nextGraph, nextStatus, bundleList] = await Promise.all([
        get<GraphResponse>(`/api/projects/${slug}/graph`),
        get<StatusResponse>('/api/status'),
        get<{ bundles: Bundle[] }>(`/api/projects/${slug}/bundles`),
      ]);
      graph = nextGraph;
      status = nextStatus;
      bundles = bundleList.bundles;
      projectPromotions = (
        await get<{ promotions: Promotion[] }>(`/api/projects/${slug}/promotions?limit=100`)
      ).promotions;

      if (selectedStage) {
        const path = `/api/projects/${slug}`;
        const stage = encodeURIComponent(selectedStage);
        const [stageList, health] = await Promise.all([
          get<{ promotions: Promotion[] }>(`${path}/promotions?stage=${stage}&limit=50`),
          get<StageHealthResponse>(`${path}/stages/${stage}/health`),
        ]);
        stagePromotions = stageList.promotions;
        stageHealth = health;
      }
      paint();
    } catch (cause) {
      if (isSessionGone(cause)) {
        navigate('/sign-in?ended=1');
        return;
      }
      problem(copy.networkFailed);
    } finally {
      polling = false;
    }
  }

  function paint(): void {
    for (const node of graph.nodes) {
      const edge = graph.edges.find((candidate) => candidate.to === node.stage);
      if (!edge) continue;
      paintNode(node, edge);
      const promotion =
        node.active_promotion ?? projectPromotions.find((candidate) => candidate.id === edge.promotion_id);
      edgeViews.get(node.stage)?.update(edge, promotion?.bundle.short_digest ?? null);
    }
    announcePhases();
    paintLedger();
    refreshPromoteOptions(bundles);
    paintEvidence(false);
    const intakeMeta = graphGrid.querySelector('.intake__meta');
    if (intakeMeta) intakeMeta.textContent = `${bundles.length} ingested`;
  }

  // ---------- start ----------

  renderProjectNav();
  renderStageNav();
  buildGraph();
  buildLedger();
  mount(shell);
  // The graph response is already in hand, so the first frame shows real state, not idle edges.
  paint();
  await poll();
  if (selectedStage) selectStage(selectedStage, { focusColumn: false });
  window.setInterval(() => void poll(), REFRESH_MS);
}
