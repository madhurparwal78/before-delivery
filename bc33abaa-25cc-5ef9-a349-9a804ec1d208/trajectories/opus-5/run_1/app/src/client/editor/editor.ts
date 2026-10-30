import { Author, CommentDto, LockDto, OpDto, ReviewLinkDto, VersionDto } from '../../shared/api';
import { Graph } from '../../shared/graph';
import { RawOp } from '../../shared/ops';
import { formatClockTime } from '../../shared/format';
import { ApiCallError, api } from '../api';
import { announce, el, mount } from '../dom';
import { reducedMotion, tween, withBusy } from '../motion';
import { registerTeardown } from '../router';
import { Session, renderAppScreen } from '../shell';
import { changeItemText, changedNodeIds, graphChanges } from './changes';
import { Inspector } from './inspector';
import { PanelContext, assetsPanel, commentsPanel, reviewLinksPanel, versionsPanel } from './panels';
import { announcedNodeId, authorWord, flattenTree, nodeName, presenceItems } from './parts';
import { hashGraph, loadEditorModel } from './state';
import { Viewport, webglAvailable } from './viewport';

export function editorScreen(root: HTMLElement, sceneId: string): void {
  void renderAppScreen(root, 'Scenes', async (session) => buildEditor(root, session, sceneId));
}

async function buildEditor(
  root: HTMLElement,
  session: Session,
  sceneId: string,
): Promise<HTMLElement> {
  const model = await loadEditorModel(sceneId);
  const status = el('p', { role: 'status', 'aria-label': 'Editor status', class: 'live-status' });
  const rewind = el('p', {
    role: 'status',
    'aria-label': 'Rewind announcement',
    class: 'live-status',
  });
  const uploadStatus = el('p', {
    role: 'status',
    'aria-label': 'Upload status',
    class: 'live-status',
  });
  const changesList = el('ul', { class: 'changes-list', 'aria-label': 'Changes' });
  const collapsed = new Set<string>();
  const reviewLinks = new Map<string, ReviewLinkDto[]>();

  const tree = el('div', { role: 'tree', 'aria-label': 'Scene hierarchy', class: 'hierarchy' });
  const canvas = el('canvas', { class: 'viewport-canvas' });
  const pinLayer = el('div', { class: 'pin-layer' });
  const viewportRegion = el('div', {
    role: 'region',
    'aria-label': 'Viewport',
    class: 'viewport',
    tabindex: '0',
    'data-op-seq': String(model.playhead),
    'data-graph-hash': model.scene.hash,
    'data-highlighted': '',
  });
  const presenceList = el('ul', { class: 'presence-list', 'aria-label': 'People in this scene' });
  const timelineTicks = el('div', { class: 'timeline-ticks' });
  const slider = el('input', {
    type: 'range',
    'aria-label': 'Operation log',
    min: '0',
    max: String(model.latestSeq),
    value: String(model.playhead),
    step: '1',
    class: 'timeline-slider',
  });
  const restoreButton = el('button', {
    type: 'button',
    class: 'button',
    text: 'Restore as new operation',
  });
  const returnButton = el('button', { type: 'button', class: 'button quiet', text: 'Return to latest' });
  const undoButton = el('button', { type: 'button', class: 'button', text: 'Undo' });
  const redoButton = el('button', { type: 'button', class: 'button', text: 'Redo' });
  const sheetToggle = el('button', {
    type: 'button',
    class: 'button',
    text: 'Versions',
    'aria-expanded': 'true',
  });
  const sheet = el('aside', { class: 'side-sheet' });

  let viewport: Viewport | null = null;
  const inspector = new Inspector({
    model,
    status,
    sendOps: (ops, intent) => sendOps(ops, intent),
    refreshViewport: () => paintViewport(),
    previewState: (fromStateId, toStateId) => previewState(fromStateId, toStateId),
    takeOver: (nodeId) => takeOverNode(nodeId),
    cameraState: () =>
      viewport?.cameraState() ?? { position: [0, 1.2, 4], target: [0, 0.4, 0], fov: 45 },
  });

  const panelContext: PanelContext = {
    model,
    timeZone: session.timeZone,
    status,
    uploadStatus,
    reload: async () => {
      await reloadData();
      paintAll();
    },
    selectNode: (nodeId) => {
      void select(nodeId);
    },
    mentionableUrl: `/api/scenes/${sceneId}/mentionable`,
    captureThumbnail: async (versionId: string) => {
      const png = await viewport?.snapshot();
      if (!png) return;
      await api
        .put(`/api/versions/${versionId}/thumbnail`, png, { 'content-type': 'image/png' })
        .catch(() => undefined);
    },
  };

  async function reloadData(): Promise<void> {
    const [comments, versions, assets] = await Promise.all([
      api.get<{ comments: CommentDto[] }>(`/api/scenes/${sceneId}/comments`),
      api.get<{ versions: VersionDto[] }>(`/api/scenes/${sceneId}/versions`),
      api.get<{ assets: { id: string; kind: 'model' | 'texture'; name: string; bytes: number; contentType: string; uploadedBy: Author }[] }>(
        '/api/assets',
      ),
    ]);
    model.comments = comments.comments;
    model.versions = versions.versions;
    model.setAssets(assets.assets);
    reviewLinks.clear();
    for (const version of model.versions) {
      if (['draft', 'in_review', 'scheduled'].includes(version.state)) {
        try {
          const links = await api.get<{ links: ReviewLinkDto[] }>(
            `/api/versions/${version.id}/review-links`,
          );
          reviewLinks.set(version.id, links.links);
        } catch {
          reviewLinks.set(version.id, []);
        }
      }
    }
  }

  async function sendOps(ops: RawOp[], intent: { nodeId: string; fieldLabel: string; rollback: () => void }): Promise<boolean> {
    try {
      const result = await api.post<{ latestSeq: number; hash: string }>(
        `/api/scenes/${sceneId}/ops`,
        { ops },
      );
      await model.refreshOps();
      model.latestSeq = result.latestSeq;
      model.playhead = result.latestSeq;
      paintAll();
      viewportRegion.dataset.graphHash = result.hash;
      return true;
    } catch (error) {
      intent.rollback();
      if (error instanceof ApiCallError) {
        if (error.error === 'locked') {
          const holder = error.body.holder as Author | undefined;
          const graph = model.latestGraph();
          if (holder) model.locks.set(intent.nodeId, holder);
          announce(
            status,
            `Change to ${nodeName(graph, intent.nodeId)} rolled back: ${
              holder?.name ?? 'another author'
            } is editing it.`,
          );
          paintHierarchy();
          return false;
        }
        if (error.errors) {
          announce(status, Object.values(error.errors)[0] ?? 'The change was rejected.');
          return false;
        }
        if (error.error === 'workspace_read_only') {
          announce(status, 'This workspace is read-only until the overdue invoice is paid.');
          return false;
        }
      }
      announce(status, 'The change was rejected.');
      return false;
    }
  }

  async function takeOverNode(nodeId: string): Promise<boolean> {
    try {
      const result = await api.post<{ lock: LockDto; previousHolder: Author | null }>(
        `/api/scenes/${sceneId}/locks/${nodeId}/takeover`,
      );
      model.locks.set(nodeId, result.lock.holder);
      paintHierarchy();
      announce(status, `You now hold ${nodeName(model.latestGraph(), nodeId)}.`);
      return true;
    } catch {
      announce(status, `${nodeName(model.latestGraph(), nodeId)} could not be taken over.`);
      return false;
    }
  }

  async function select(nodeId: string | null): Promise<void> {
    const previous = model.selection;
    model.selection = nodeId;
    paintHierarchy();
    inspector.render();
    paintPins();
    if (previous && previous !== nodeId) {
      await api.del(`/api/scenes/${sceneId}/locks/${previous}`).catch(() => undefined);
      model.locks.delete(previous);
    }
    if (nodeId && model.playhead === model.latestSeq) {
      try {
        const result = await api.post<{ lock: LockDto }>(`/api/scenes/${sceneId}/locks`, { nodeId });
        model.locks.set(nodeId, result.lock.holder);
      } catch (error) {
        if (error instanceof ApiCallError && error.error === 'locked') {
          const holder = error.body.holder as Author | undefined;
          if (holder) model.locks.set(nodeId, holder);
        }
      }
      paintHierarchy();
    }
    void api
      .post(`/api/scenes/${sceneId}/presence`, { selection: nodeId, cursor: [0.5, 0.5] })
      .catch(() => undefined);
  }

  function paintHierarchy(): void {
    const graph = model.graphAt(model.playhead);
    const rows = flattenTree(graph, collapsed);
    mount(
      tree,
      ...rows.map((row) => {
        const holder = model.lockHolder(row.node.id);
        const descriptionId = `lock-${row.node.id}`;
        const hasChildren = graph.nodes.some((node) => node.parentId === row.node.id);
        const item = el(
          'div',
          {
            role: 'treeitem',
            tabindex: model.selection === row.node.id ? '0' : '-1',
            'aria-selected': model.selection === row.node.id ? 'true' : 'false',
            'aria-level': String(row.depth + 1),
            'aria-expanded': hasChildren ? String(!collapsed.has(row.node.id)) : null,
            'aria-describedby': holder ? descriptionId : null,
            'data-node-id': row.node.id,
            class: `tree-item depth-${row.depth}${holder ? ' is-locked' : ''}`,
            style: `--depth:${row.depth}`,
          },
          [
            el('span', { class: 'tree-name', text: row.node.name, title: row.node.name }),
            holder
              ? el('span', {
                  class: 'visually-hidden',
                  id: descriptionId,
                  text: `Locked by ${holder.name}`,
                })
              : null,
            holder ? el('span', { class: 'lock-badge', 'aria-hidden': 'true', text: '◼' }) : null,
          ],
        );
        item.addEventListener('click', () => void select(row.node.id));
        return item;
      }),
    );
  }

  function treeItems(): HTMLElement[] {
    return [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  }

  tree.addEventListener('keydown', (event) => {
    const items = treeItems();
    if (items.length === 0) return;
    const currentIndex = items.findIndex(
      (item) => item.getAttribute('data-node-id') === model.selection,
    );
    const focusAt = (index: number): void => {
      const item = items[Math.max(0, Math.min(items.length - 1, index))];
      if (!item) return;
      const nodeId = item.getAttribute('data-node-id');
      if (nodeId) void select(nodeId);
      window.setTimeout(() => {
        const refreshed = treeItems().find((entry) => entry.getAttribute('data-node-id') === nodeId);
        refreshed?.focus();
      }, 0);
    };
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusAt(currentIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusAt(currentIndex - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusAt(items.length - 1);
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const nodeId = model.selection;
      if (!nodeId) return;
      const graph = model.graphAt(model.playhead);
      const hasChildren = graph.nodes.some((node) => node.parentId === nodeId);
      if (event.key === 'ArrowRight') {
        if (hasChildren && collapsed.has(nodeId)) {
          collapsed.delete(nodeId);
          paintHierarchy();
          return;
        }
        focusAt(currentIndex + 1);
        return;
      }
      if (hasChildren && !collapsed.has(nodeId)) {
        collapsed.add(nodeId);
        paintHierarchy();
        return;
      }
      const parentId = graph.nodes.find((node) => node.id === nodeId)?.parentId;
      if (parentId) void select(parentId);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const nodeId = items[Math.max(0, currentIndex)]?.getAttribute('data-node-id');
      if (nodeId) void select(nodeId);
      return;
    }
    if (event.key.length === 1 && /[a-z0-9]/i.test(event.key)) {
      const letter = event.key.toLowerCase();
      const start = currentIndex + 1;
      for (let step = 0; step < items.length; step += 1) {
        const item = items[(start + step) % items.length];
        const name = item?.querySelector('.tree-name')?.textContent ?? '';
        if (name.toLowerCase().startsWith(letter)) {
          const nodeId = item?.getAttribute('data-node-id');
          if (nodeId) void select(nodeId);
          return;
        }
      }
    }
  });

  function paintPins(): void {
    const graph = model.graphAt(model.playhead);
    mount(
      pinLayer,
      ...model.comments
        .filter((comment) => !comment.resolved)
        .map((comment) => {
          const position = viewport?.project(comment.nodeId);
          const pin = el('button', {
            type: 'button',
            class: 'comment-pin',
            'aria-label': `Comment on ${nodeName(graph, comment.nodeId)}`,
            text: '●',
            style: position
              ? `left:${(position.x * 100).toFixed(2)}%; top:${(position.y * 100).toFixed(2)}%`
              : 'left:50%; top:50%',
          });
          pin.addEventListener('click', () => {
            void select(comment.nodeId);
            openSheet('Comments');
          });
          return pin;
        }),
    );
  }

  function paintViewport(): void {
    const graph = model.graphAt(model.playhead);
    viewport?.setGraph(graph, model.stateId);
    viewportRegion.dataset.opSeq = String(model.playhead);
    void hashGraph(graph).then((hash) => {
      viewportRegion.dataset.graphHash = hash;
    });
    paintPins();
  }

  /** A state preview moves over the transition's duration, or a quarter second. */
  function previewState(fromStateId: string, toStateId: string): void {
    const graph = model.graphAt(model.playhead);
    viewport?.setGraph(graph, fromStateId);
    const linked = graph.transitions.find(
      (transition) =>
        (transition.from === fromStateId && transition.to === toStateId) ||
        (transition.from === toStateId && transition.to === fromStateId),
    );
    const duration = linked ? linked.durationMs : 240;
    tween(
      duration,
      (progress) => viewport?.setBlend(fromStateId, toStateId, progress),
      () => viewport?.setGraph(graph, toStateId),
    );
    paintPins();
  }

  function paintTimeline(): void {
    slider.max = String(model.latestSeq);
    slider.value = String(model.playhead);
    mount(
      timelineTicks,
      ...model.ops.map((op) =>
        el('span', {
          class: `tick ${op.author.kind === 'agent' ? 'tick-agent' : 'tick-member'}${
            op.seq > model.playhead ? ' tick-faded' : ''
          }`,
          'data-op-seq': String(op.seq),
          'data-author-kind': op.author.kind,
          style: `left:${model.latestSeq === 0 ? 0 : (op.seq / model.latestSeq) * 100}%`,
          title: `Operation ${op.seq}: ${op.type}`,
        }),
      ),
    );
    const behind = model.playhead < model.latestSeq;
    restoreButton.hidden = !behind;
    returnButton.hidden = !behind;
    changesList.hidden = !reducedMotion();
  }

  function paintPresence(): void {
    const graph = model.graphAt(model.playhead);
    mount(presenceList, ...presenceItems(model.presence, graph, model.self));
  }

  function paintSheet(): void {
    mount(
      sheet,
      versionsPanel(panelContext),
      reviewLinksPanel(panelContext, reviewLinks),
      commentsPanel(panelContext),
      assetsPanel(panelContext),
    );
  }

  function paintAll(): void {
    paintHierarchy();
    inspector.render();
    paintViewport();
    paintTimeline();
    paintPresence();
    paintSheet();
  }

  function announceOperation(seq: number): void {
    if (seq === 0) {
      announce(rewind, 'Start of log');
      return;
    }
    const op = model.opAt(seq);
    if (!op) return;
    const graph = model.graphAt(op.type === 'node.remove' ? seq - 1 : seq);
    const nodeId = announcedNodeId(op);
    const time = formatClockTime(op.createdAt, session.timeZone);
    const prefix = `Operation ${seq} of ${model.latestSeq}: ${op.type}`;
    const suffix = `by ${op.author.name} (${authorWord(op.author)}) at ${time}`;
    announce(
      rewind,
      nodeId ? `${prefix} on ${nodeName(graph, nodeId)} ${suffix}` : `${prefix} ${suffix}`,
    );
  }

  function authorOfChange(fromSeq: number, toSeq: number, key: string): string {
    const low = Math.min(fromSeq, toSeq);
    const high = Math.max(fromSeq, toSeq);
    let author = '';
    for (let seq = low + 1; seq <= high; seq += 1) {
      const before = model.graphAt(seq - 1);
      const after = model.graphAt(seq);
      const touched = graphChanges(before, after).some((item) => item.key === key);
      if (touched) author = model.opAt(seq)?.author.name ?? author;
    }
    return author;
  }

  let highlightTimer: number | null = null;

  function movePlayhead(next: number, settle: boolean): void {
    const clamped = Math.max(0, Math.min(model.latestSeq, next));
    const previousSeq = model.playhead;
    if (clamped === previousSeq && settle) {
      announceOperation(clamped);
      return;
    }
    const previousGraph: Graph = model.graphAt(previousSeq);
    model.playhead = clamped;
    const nextGraph = model.graphAt(clamped);

    paintViewport();
    const changed = changedNodeIds(previousGraph, nextGraph);
    viewportRegion.dataset.highlighted = changed.join(',');
    viewport?.highlight(changed);
    if (highlightTimer !== null) window.clearTimeout(highlightTimer);
    highlightTimer = window.setTimeout(
      () => {
        viewportRegion.dataset.highlighted = '';
        viewport?.highlight([]);
      },
      reducedMotion() ? 0 : 420,
    );

    inspector.animateTo(previousGraph);
    paintTimeline();
    paintHierarchy();

    if (reducedMotion()) {
      const items = graphChanges(previousGraph, nextGraph);
      mount(
        changesList,
        ...items.map((item) =>
          el('li', { text: changeItemText(item, authorOfChange(previousSeq, clamped, item.key)) }),
        ),
      );
      changesList.hidden = false;
    }
    if (settle) announceOperation(clamped);
  }

  slider.addEventListener('input', () => {
    movePlayhead(Number(slider.value), false);
  });
  slider.addEventListener('change', () => {
    movePlayhead(Number(slider.value), true);
  });
  slider.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      movePlayhead(model.playhead + step, true);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      movePlayhead(model.playhead - step, true);
    } else if (event.key === 'Home') {
      event.preventDefault();
      movePlayhead(0, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      movePlayhead(model.latestSeq, true);
    }
  });

  restoreButton.addEventListener('click', () => {
    const target = model.playhead;
    void withBusy(restoreButton, async () => {
      try {
        await api.post(`/api/scenes/${sceneId}/restore`, { toSeq: target });
        await model.refreshOps();
        model.playhead = model.latestSeq;
        paintAll();
        announce(status, `Restored to operation ${target}.`);
      } catch (error) {
        if (error instanceof ApiCallError && error.error === 'locked') {
          const holder = error.body.holder as Author | undefined;
          const nodeId = error.body.nodeId as string | undefined;
          announce(
            status,
            `Cannot restore: ${holder?.name ?? 'another author'} is editing ${nodeName(
              model.latestGraph(),
              nodeId ?? null,
            )}.`,
          );
          return;
        }
        announce(status, 'The scene could not be restored.');
      }
    });
  });

  returnButton.addEventListener('click', () => {
    movePlayhead(model.latestSeq, true);
  });

  async function runUndoRedo(kind: 'undo' | 'redo', button: HTMLButtonElement): Promise<void> {
    await withBusy(button, async () => {
      try {
        await api.post(`/api/scenes/${sceneId}/${kind}`);
        await model.refreshOps();
        model.playhead = model.latestSeq;
        paintAll();
        announce(status, kind === 'undo' ? 'Undone.' : 'Redone.');
      } catch (error) {
        if (!(error instanceof ApiCallError)) return;
        if (error.error === 'nothing_to_undo') {
          announce(status, 'Nothing to undo.');
          return;
        }
        if (error.error === 'nothing_to_redo') {
          announce(status, 'Nothing to redo.');
          return;
        }
        if (error.error === 'locked') {
          const holder = error.body.holder as Author | undefined;
          const nodeId = error.body.nodeId as string | undefined;
          announce(
            status,
            `Cannot ${kind}: ${holder?.name ?? 'another author'} is editing ${nodeName(
              model.latestGraph(),
              nodeId ?? null,
            )}.`,
          );
          return;
        }
        if (error.error === 'undo_conflict') {
          const nodeId = error.body.nodeId as string | null;
          const stateId = error.body.stateId as string | null;
          if (nodeId) {
            announce(
              status,
              `Cannot ${kind}: a later change removed ${nodeName(model.latestGraph(), nodeId)}.`,
            );
            return;
          }
          const stateName =
            model.latestGraph().states.find((state) => state.id === stateId)?.name ?? stateId ?? '';
          announce(
            status,
            `Cannot ${kind}: a later change removed or uses state ${stateName}.`,
          );
          return;
        }
        announce(status, `Cannot ${kind}.`);
      }
    });
  }

  undoButton.addEventListener('click', () => void runUndoRedo('undo', undoButton));
  redoButton.addEventListener('click', () => void runUndoRedo('redo', redoButton));

  function openSheet(panel: string): void {
    sheet.classList.add('is-open');
    sheetToggle.setAttribute('aria-expanded', 'true');
    const target = sheet.querySelector<HTMLElement>(`[aria-label="${panel}"]`);
    target?.scrollIntoView({ block: 'nearest' });
  }

  sheetToggle.addEventListener('click', () => {
    const open = sheetToggle.getAttribute('aria-expanded') === 'true';
    sheetToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    sheet.classList.toggle('is-open', !open);
  });

  const keyHandler = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const inField =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    if (inField) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier || event.key.toLowerCase() !== 'z') return;
    event.preventDefault();
    void runUndoRedo(event.shiftKey ? 'redo' : 'undo', event.shiftKey ? redoButton : undoButton);
  };
  document.addEventListener('keydown', keyHandler);

  viewportRegion.addEventListener('keydown', (event) => {
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-5, 0],
      ArrowRight: [5, 0],
      ArrowUp: [0, 5],
      ArrowDown: [0, -5],
    };
    const move = map[event.key];
    if (!move) return;
    event.preventDefault();
    viewport?.orbitBy(move[0], move[1]);
    paintPins();
  });

  const source = new EventSource(`/api/scenes/${sceneId}/events`);
  source.addEventListener('op', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { ops: OpDto[] };
    model.addOps(data.ops);
    const atLatest = model.playhead === model.latestSeq - data.ops.length;
    if (atLatest) model.playhead = model.latestSeq;
    paintTimeline();
    if (model.playhead === model.latestSeq) {
      paintViewport();
      paintHierarchy();
      inspector.render();
    }
  });
  source.addEventListener('lock', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as {
      nodeId: string;
      holder: Author | null;
    };
    const previous = model.locks.get(data.nodeId);
    if (data.holder) model.locks.set(data.nodeId, data.holder);
    else model.locks.delete(data.nodeId);
    if (
      model.self &&
      previous &&
      previous.kind === model.self.kind &&
      previous.id === model.self.id &&
      data.holder &&
      !(data.holder.kind === model.self.kind && data.holder.id === model.self.id)
    ) {
      announce(
        status,
        `${data.holder.name} took over ${nodeName(model.latestGraph(), data.nodeId)}.`,
      );
    }
    paintHierarchy();
  });
  source.addEventListener('presence', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as {
      authors: { author: Author; selection: string | null }[];
    };
    model.presence = data.authors;
    paintPresence();
  });
  source.addEventListener('comment', (event) => {
    const comment = JSON.parse((event as MessageEvent<string>).data) as CommentDto;
    model.comments = [...model.comments.filter((entry) => entry.id !== comment.id), comment];
    paintSheet();
    paintPins();
  });
  source.addEventListener('version', (event) => {
    const version = JSON.parse((event as MessageEvent<string>).data) as VersionDto;
    model.versions = [
      version,
      ...model.versions.filter((entry) => entry.id !== version.id),
    ].sort((a, b) => b.number - a.number);
    paintSheet();
  });

  const heartbeat = window.setInterval(() => {
    void api
      .post(`/api/scenes/${sceneId}/presence`, {
        selection: model.selection,
        cursor: [0.5, 0.5],
      })
      .catch(() => undefined);
  }, 8_000);

  registerTeardown(() => {
    source.close();
    window.clearInterval(heartbeat);
    document.removeEventListener('keydown', keyHandler);
    viewport?.dispose();
  });

  const header = el('header', { class: 'editor-header' }, [
    el('h1', { class: 'scene-title', text: model.scene.name, title: model.scene.name }),
    presenceList,
    el('div', { class: 'editor-actions' }, [undoButton, redoButton, sheetToggle]),
  ]);

  const tabs = ['Hierarchy', 'Inspector', 'Comments', 'Versions'];
  const tabStrip = el('div', { class: 'tab-strip', role: 'tablist', 'aria-label': 'Editor panels' });
  const editorGrid = el('div', { class: 'editor-grid' }, [
    el('div', { class: 'column hierarchy-column', 'data-panel': 'Hierarchy' }, [
      el('h2', { class: 'column-title', text: 'Hierarchy' }),
      tree,
    ]),
    viewportRegion,
    el('div', { class: 'column inspector-column', 'data-panel': 'Inspector' }, [inspector.element]),
  ]);
  mount(
    tabStrip,
    ...tabs.map((tab, index) => {
      const button = el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': index === 0 ? 'true' : 'false',
        text: tab,
      });
      button.addEventListener('click', () => {
        for (const other of tabStrip.querySelectorAll('[role="tab"]')) {
          other.setAttribute('aria-selected', other === button ? 'true' : 'false');
        }
        editorGrid.dataset.activePanel = tab;
        if (tab === 'Comments' || tab === 'Versions') openSheet(tab === 'Comments' ? 'Comments' : 'Versions');
        else sheet.classList.remove('is-open');
      });
      return button;
    }),
  );
  editorGrid.dataset.activePanel = 'Hierarchy';

  const timeline = el('div', { class: 'timeline' }, [
    el('div', { class: 'timeline-track' }, [timelineTicks, slider]),
    el('div', { class: 'timeline-actions' }, [restoreButton, returnButton]),
    rewind,
    changesList,
    status,
  ]);

  mount(viewportRegion, canvas, pinLayer);
  sheet.classList.add('is-open');

  const editor = el('div', { class: 'screen editor' }, [header, tabStrip, editorGrid, timeline, sheet]);

  window.setTimeout(() => {
    if (webglAvailable()) {
      viewport = new Viewport({
        canvas,
        onPick: (nodeId) => {
          if (nodeId) void select(nodeId);
        },
      });
      viewport.setGraph(model.graphAt(model.playhead), model.stateId);
      viewport.resize();
      window.addEventListener('resize', () => {
        viewport?.resize();
        paintPins();
      });
    } else {
      canvas.remove();
      const fallback = el('div', { class: 'viewport-fallback' }, [
        el('p', {
          text: '3D preview needs WebGL. The hierarchy, inspector and operation log still work.',
        }),
      ]);
      pinLayer.remove();
      const newest = model.versions[0];
      if (newest) {
        const still = el('img', {
          src: `/api/versions/${newest.id}/thumbnail`,
          alt: model.scene.name,
        });
        still.addEventListener('error', () => still.remove());
        fallback.append(still);
      }
      viewportRegion.append(fallback);
    }
    paintPins();
  }, 0);

  await reloadData();
  paintAll();
  restoreButton.hidden = true;
  returnButton.hidden = true;
  void select(null);
  void api
    .post(`/api/scenes/${sceneId}/presence`, { selection: null, cursor: [0.5, 0.5] })
    .catch(() => undefined);

  void root;
  return editor;
}
