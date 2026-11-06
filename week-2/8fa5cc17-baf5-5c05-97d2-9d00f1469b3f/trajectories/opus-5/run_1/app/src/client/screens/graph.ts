import { api } from '../api';
import { clear, el, prefersReducedMotion } from '../dom';
import { frame } from '../frame';
import { Screen, ScreenParams, navigate } from '../router';
import { BacklinkDto, GraphDto, ShareLinkDto, CollectionDto } from '../types';
import { libraryOrder, theme, workspace } from '../state';
import { onLive } from '../live';
import { GraphRenderer, project, DrawLines, DrawNode } from '../graph/renderer';
import { THEME_TOKENS, toUnit } from '../../shared/tokens';
import {
  CAMERA_HOME,
  CameraPose,
  FLY_TO_MS,
  FOG_DEPTH,
  IDLE_RESUME_MS,
  IDLE_TURN_DEGREES_PER_SECOND,
  KEY_DISTANCE_STEP,
  KEY_PITCH_STEP,
  KEY_YAW_STEP,
  LABEL_MIN_PROJECTED_RADIUS,
  LABEL_OFFSET_PX,
  LayoutEdge,
  LayoutNode,
  NODE_GROW_MS,
  EDGE_DRAW_MS,
  ORBIT_DEGREES_PER_PIXEL,
  REHEAT_MAX_STEPS_PER_FRAME,
  REHEAT_STEPS,
  REHEAT_STEP_MS,
  SCOPE_DIM_MS,
  SCOPE_DIM_OPACITY,
  WHEEL_DISTANCE_PER_PIXEL,
  INITIAL_STEPS,
  clampDistance,
  clampPitch,
  flyToPose,
  identity,
  integrateStep,
  nodeSize,
  perspective,
  raySphere,
  seededStart,
  settle,
  shortWayYaw,
  translateScale,
  viewMatrix,
  cameraEye,
} from '../../shared/graph';
import { quireEase } from '../../shared/motion';
import { COPY, backlinksPhrase, pinnedCopy, unpinnedCopy } from '../../shared/copy';

type Node = {
  id: string;
  title: string;
  typeId: string;
  collectionIds: string[];
  backlinks: number;
  inScope: boolean;
  layout: LayoutNode;
  size: number;
  drawnSize: number;
  button: HTMLButtonElement;
  opacity: number;
  targetOpacity: number;
};

const CANVAS_HEIGHT_WIDE = 560;
const CANVAS_HEIGHT_PHONE = 480;
const GRAPH_REFRESH_MS = 5000;

export function graphScreen(): Screen {
  let stopLive: (() => void) | null = null;
  let renderer: GraphRenderer | null = null;
  let nodes: Node[] = [];
  let edges: LayoutEdge[] = [];
  let newEdges = new Map<string, number>();
  let selectedId: string | null = null;
  let focusedId: string | null = null;
  let pose: CameraPose = { ...CAMERA_HOME, target: [0, 0, 0] };
  let fly: { from: CameraPose; to: CameraPose; started: number } | null = null;
  let lastInput = performance.now();
  let idling = true;
  let reheatLeft = 0;
  let reheatCarry = 0;
  let frameId = 0;
  let scopeLinkId: string | null = null;
  let refreshTimer = 0;
  let shareLinks: ShareLinkDto[] = [];
  let typeFilter: string | null = null;
  let collectionFilter: string | null = null;

  const toolbar = el('div', { className: 'graph-toolbar' });
  const typeSelect = el('select', { attrs: { 'aria-label': 'Show type' } });
  const collectionSelect = el('select', { attrs: { 'aria-label': 'Show collection' } });
  const scopeSelect = el('select', { attrs: { 'aria-label': 'Share scope' } });
  const group = el('div', { className: 'graph-group', attrs: { role: 'group', 'aria-label': 'Link graph' } });
  const labelLayer = el('div', { className: 'graph-labels' });
  const fallbackList = el('ul', { className: 'graph-nodes', attrs: { 'aria-label': 'Graph nodes' } });
  let canvas: HTMLCanvasElement | null = null;

  function visibleNodes(): Node[] {
    return nodes.filter(
      (node) =>
        (typeFilter === null || node.typeId === typeFilter) &&
        (collectionFilter === null || node.collectionIds.includes(collectionFilter)),
    );
  }

  function titleOrder(list: Node[]): Node[] {
    return [...list].sort((a, b) => {
      const byTitle = a.title.toLowerCase().localeCompare(b.title.toLowerCase());
      return byTitle !== 0 ? byTitle : a.id < b.id ? -1 : 1;
    });
  }

  function layoutOrderKey(node: { typeId: string; title: string; id: string }): string {
    const index = libraryOrder(workspace().types).findIndex((type) => type.id === node.typeId);
    return `${String(index).padStart(3, '0')}|${node.title.toLowerCase()}|${node.id}`;
  }

  function buildNodes(payload: GraphDto): void {
    const types = libraryOrder(workspace().types);
    const ordered = [...payload.nodes].sort((a, b) =>
      layoutOrderKey({ typeId: a.type_id, title: a.title, id: a.id }) <
      layoutOrderKey({ typeId: b.type_id, title: b.title, id: b.id })
        ? -1
        : 1,
    );
    const countByType = new Map<string, number>();
    for (const node of ordered) countByType.set(node.type_id, (countByType.get(node.type_id) ?? 0) + 1);
    const indexByType = new Map<string, number>();
    const existing = new Map(nodes.map((node) => [node.id, node]));
    const next: Node[] = [];
    for (const raw of ordered) {
      const typeIndex = Math.max(0, types.findIndex((type) => type.id === raw.type_id));
      const indexInType = indexByType.get(raw.type_id) ?? 0;
      indexByType.set(raw.type_id, indexInType + 1);
      const previous = existing.get(raw.id);
      const size = nodeSize(raw.backlinks);
      if (previous !== undefined) {
        previous.title = raw.title;
        previous.backlinks = raw.backlinks;
        previous.collectionIds = raw.collection_ids;
        previous.inScope = raw.in_scope ?? true;
        if (previous.size !== size) growNode(previous, size);
        next.push(previous);
        continue;
      }
      const layout: LayoutNode = {
        id: raw.id,
        typeIndex,
        indexInType,
        countInType: countByType.get(raw.type_id) ?? 1,
        position: seededStart({
          id: raw.id,
          typeIndex,
          indexInType,
          countInType: countByType.get(raw.type_id) ?? 1,
        }),
        velocity: [0, 0, 0],
        acceleration: [0, 0, 0],
        pinned: false,
      };
      const button = el('button', { className: 'graph-node', attrs: { type: 'button' } });
      const node: Node = {
        id: raw.id,
        title: raw.title,
        typeId: raw.type_id,
        collectionIds: raw.collection_ids,
        backlinks: raw.backlinks,
        inScope: raw.in_scope ?? true,
        layout,
        size,
        drawnSize: size,
        button,
        opacity: 1,
        targetOpacity: 1,
      };
      wireNodeButton(node);
      next.push(node);
    }
    nodes = next;
    edges = payload.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to }));
  }

  function growNode(node: Node, size: number): void {
    const from = node.drawnSize;
    node.size = size;
    if (prefersReducedMotion()) {
      node.drawnSize = size;
      return;
    }
    const started = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / NODE_GROW_MS);
      node.drawnSize = from + (size - from) * quireEase(progress);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function wireNodeButton(node: Node): void {
    node.button.addEventListener('focus', () => {
      focusedId = node.id;
      lastInput = performance.now();
      idling = false;
      select(node.id, true);
    });
    node.button.addEventListener('keydown', (event) => onNodeKey(event, node));
    node.button.addEventListener('click', () => select(node.id, true));
  }

  function renderLabels(): void {
    const order = titleOrder(visibleNodes());
    const wanted = new Set(order.map((node) => node.id));
    for (const node of nodes) {
      if (!wanted.has(node.id) && node.button.parentElement !== null) node.button.remove();
    }
    for (const node of order) {
      const scopeSuffix = scopeLinkId !== null && !node.inScope ? ', not shared' : '';
      const pinSuffix = node.layout.pinned ? ', pinned' : '';
      node.button.setAttribute(
        'aria-label',
        `${node.title}, ${backlinksPhrase(node.backlinks)}${scopeSuffix}${pinSuffix}`,
      );
      node.button.textContent = `${node.title}${scopeLinkId !== null && !node.inScope ? ' · not shared' : ''}`;
      if (node.button.parentElement === null) labelLayer.append(node.button);
    }
    for (const node of order) labelLayer.append(node.button);
    renderFallback(order);
  }

  function renderFallback(order: Node[]): void {
    if (canvas !== null) return;
    clear(fallbackList);
    for (const node of order) {
      const targets = edges
        .filter((edge) => edge.from === node.id)
        .map((edge) => nodes.find((candidate) => candidate.id === edge.to))
        .filter((candidate): candidate is Node => candidate !== undefined && order.includes(candidate))
        .map((candidate) => candidate.title)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      fallbackList.append(
        el('li', {
          children: [
            node.button,
            el('span', {
              className: 'graph-links',
              text: targets.length === 0 ? 'links to nothing' : `links to ${targets.join(', ')}`,
            }),
          ],
        }),
      );
    }
  }

  function select(id: string | null, withFly: boolean): void {
    selectedId = id;
    if (id === null) {
      if (withFly) startFly({ ...CAMERA_HOME, target: [0, 0, 0] });
      void showBacklinks(null);
      return;
    }
    const node = nodes.find((candidate) => candidate.id === id);
    if (node === undefined) return;
    if (withFly) startFly(flyToPose(node.layout.position, node.size));
    void showBacklinks(node.id);
  }

  async function showBacklinks(objectId: string | null): Promise<void> {
    const margin = frame().margin;
    clear(margin);
    if (objectId === null) return;
    const result = await api.get<{ count: number; backlinks: BacklinkDto[] }>(
      `/api/objects/${objectId}/backlinks`,
    );
    if (!result.ok) return;
    const region = el('div', { className: 'backlinks', attrs: { role: 'region', 'aria-label': 'Backlinks' } });
    region.append(
      el('h2', {
        className: 'backlinks-heading',
        children: [
          el('span', { text: 'Backlinks' }),
          el('span', {
            className: 'backlink-count',
            text: String(result.data.count),
            attrs: { 'data-backlink-count': String(result.data.count) },
          }),
        ],
      }),
    );
    const list = el('ul', { className: 'backlinks-list', attrs: { 'aria-label': 'Backlinks list' } });
    for (const backlink of result.data.backlinks) {
      const link = el('a', { text: backlink.from_title, attrs: { href: `/o/${backlink.from_object_id}` } });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        navigate(`/o/${backlink.from_object_id}`);
      });
      list.append(
        el('li', {
          children: [
            link,
            el('span', {
              className: 'backlink-kind',
              text: backlink.kind === 'quote' ? 'quoted' : backlink.field_name ?? 'relation',
            }),
          ],
        }),
      );
    }
    region.append(list);
    margin.append(region);
  }

  function startFly(to: CameraPose): void {
    if (prefersReducedMotion()) {
      pose = { ...to, yaw: shortWayYaw(pose.yaw, to.yaw) };
      fly = null;
      return;
    }
    fly = { from: { ...pose }, to: { ...to, yaw: shortWayYaw(pose.yaw, to.yaw) }, started: performance.now() };
  }

  function onNodeKey(event: KeyboardEvent, node: Node): void {
    lastInput = performance.now();
    idling = false;
    const order = titleOrder(visibleNodes());
    const index = order.findIndex((candidate) => candidate.id === node.id);
    if (event.shiftKey && event.key.startsWith('Arrow')) {
      event.preventDefault();
      if (event.key === 'ArrowLeft') pose.yaw -= KEY_YAW_STEP;
      if (event.key === 'ArrowRight') pose.yaw += KEY_YAW_STEP;
      if (event.key === 'ArrowUp') pose.pitch = clampPitch(pose.pitch + KEY_PITCH_STEP);
      if (event.key === 'ArrowDown') pose.pitch = clampPitch(pose.pitch - KEY_PITCH_STEP);
      fly = null;
      return;
    }
    if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      pose.distance = clampDistance(pose.distance + (event.key === '-' ? KEY_DISTANCE_STEP : -KEY_DISTANCE_STEP));
      fly = null;
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      order[(index + 1) % order.length]?.button.focus();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      order[(index - 1 + order.length) % order.length]?.button.focus();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      order[0]?.button.focus();
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      order[order.length - 1]?.button.focus();
      return;
    }
    if (event.key === 'p' || event.key === 'P') {
      event.preventDefault();
      node.layout.pinned = !node.layout.pinned;
      if (!node.layout.pinned) reheat();
      frame().announce(node.layout.pinned ? pinnedCopy(node.title) : unpinnedCopy(node.title));
      renderLabels();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      navigate(`/o/${node.id}`);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      select(null, true);
      renderLabels();
    }
  }

  function reheat(): void {
    reheatLeft = REHEAT_STEPS;
    if (prefersReducedMotion()) {
      for (let step = 0; step < REHEAT_STEPS; step += 1) {
        if (integrateStep(layoutNodes(), edges) < 0.002) break;
      }
      reheatLeft = 0;
    }
  }

  function layoutNodes(): LayoutNode[] {
    return nodes.map((node) => node.layout);
  }

  function canvasSize(): { width: number; height: number } {
    const width = frame().main.clientWidth;
    const height = frame().currentLayout() === 'phone' ? CANVAS_HEIGHT_PHONE : CANVAS_HEIGHT_WIDE;
    return { width, height };
  }

  function drawFrame(now: number): void {
    const size = canvasSize();
    if (canvas !== null && renderer !== null) {
      if (canvas.style.width !== `${size.width}px`) {
        canvas.style.width = `${size.width}px`;
        canvas.style.height = `${size.height}px`;
        renderer.resize(size.width, size.height, window.devicePixelRatio);
      }
    }
    if (fly !== null) {
      const progress = Math.min(1, (now - fly.started) / FLY_TO_MS);
      const eased = quireEase(progress);
      pose = {
        target: [
          fly.from.target[0] + (fly.to.target[0] - fly.from.target[0]) * eased,
          fly.from.target[1] + (fly.to.target[1] - fly.from.target[1]) * eased,
          fly.from.target[2] + (fly.to.target[2] - fly.from.target[2]) * eased,
        ],
        yaw: fly.from.yaw + (fly.to.yaw - fly.from.yaw) * eased,
        pitch: fly.from.pitch + (fly.to.pitch - fly.from.pitch) * eased,
        distance: fly.from.distance + (fly.to.distance - fly.from.distance) * eased,
      };
      if (progress >= 1) {
        pose = { ...fly.to };
        fly = null;
      }
    } else if (selectedId === null && !prefersReducedMotion()) {
      if (!idling && now - lastInput > IDLE_RESUME_MS) idling = true;
      if (idling) pose.yaw += (IDLE_TURN_DEGREES_PER_SECOND * 16.6) / 1000;
    }
    if (reheatLeft > 0) {
      reheatCarry += 16.6;
      let steps = 0;
      while (reheatCarry >= REHEAT_STEP_MS && steps < REHEAT_MAX_STEPS_PER_FRAME && reheatLeft > 0) {
        reheatCarry -= REHEAT_STEP_MS;
        reheatLeft -= 1;
        steps += 1;
        if (integrateStep(layoutNodes(), edges) < 0.002) reheatLeft = 0;
      }
    }
    if (renderer !== null && canvas !== null) {
      const tokens = THEME_TOKENS[theme()];
      const ink = toUnit(tokens.ink);
      const link = toUnit(tokens.link);
      const rule = toUnit(tokens.rule);
      const paper = toUnit(tokens.paper);
      const view = viewMatrix(pose);
      const projection = perspective(size.width / size.height);
      const visible = visibleNodes();
      const drawNodes: DrawNode[] = visible.map((node) => ({
        model: translateScale(node.layout.position, node.drawnSize),
        colour: node.id === selectedId ? link : ink,
        opacity: node.opacity,
      }));
      const plain: number[] = [];
      const selectedLines: number[] = [];
      const outOfScope: number[] = [];
      const drawing: DrawLines[] = [];
      for (const edge of edges) {
        const from = visible.find((node) => node.id === edge.from);
        const to = visible.find((node) => node.id === edge.to);
        if (from === undefined || to === undefined) continue;
        const started = newEdges.get(edge.id);
        if (started !== undefined) {
          const progress = Math.min(1, (now - started) / EDGE_DRAW_MS);
          const eased = prefersReducedMotion() ? 1 : quireEase(progress);
          drawing.push({
            vertices: new Float32Array([
              0,
              0,
              0,
              to.layout.position[0] - from.layout.position[0],
              to.layout.position[1] - from.layout.position[1],
              to.layout.position[2] - from.layout.position[2],
            ]),
            model: translateScale(from.layout.position, eased),
            colour: rule,
            opacity: 1,
          });
          if (progress >= 1) newEdges.delete(edge.id);
          continue;
        }
        const points = [...from.layout.position, ...to.layout.position];
        if (scopeLinkId !== null && (!from.inScope || !to.inScope)) outOfScope.push(...points);
        else if (selectedId !== null && (edge.from === selectedId || edge.to === selectedId)) {
          selectedLines.push(...points);
        } else plain.push(...points);
      }
      const batches: DrawLines[] = [...drawing];
      if (plain.length > 0) {
        batches.push({ vertices: new Float32Array(plain), model: identity(), colour: rule, opacity: 1 });
      }
      if (selectedLines.length > 0) {
        batches.push({ vertices: new Float32Array(selectedLines), model: identity(), colour: link, opacity: 1 });
      }
      if (outOfScope.length > 0) {
        batches.push({
          vertices: new Float32Array(outOfScope),
          model: identity(),
          colour: rule,
          opacity: SCOPE_DIM_OPACITY,
        });
      }
      renderer.draw({
        view,
        projection,
        fogNear: pose.distance,
        fogFar: pose.distance + FOG_DEPTH,
        fogColour: paper,
        paper,
        nodes: drawNodes,
        lineBatches: batches,
      });
      positionLabels(view, projection, size);
    }
    frameId = requestAnimationFrame(drawFrame);
  }

  /** Each node's label follows its projected point on every frame. */
  function positionLabels(view: Float32Array, projection: Float32Array, size: { width: number; height: number }): void {
    for (const node of visibleNodes()) {
      const point = project(node.layout.position, view, projection, size.width, size.height);
      node.button.style.left = `${point.x + LABEL_OFFSET_PX}px`;
      node.button.style.top = `${point.y}px`;
      const projectedRadius =
        point.depth <= 0
          ? 0
          : (node.drawnSize * (size.height / 2)) / (Math.tan((22.5 * Math.PI) / 180) * point.depth);
      const focused = document.activeElement === node.button;
      let detail = projectedRadius >= LABEL_MIN_PROJECTED_RADIUS || node.id === selectedId || focused ? 1 : 0;
      if (!point.visible && !focused) detail = 0;
      const scope = scopeLinkId !== null && !node.inScope ? SCOPE_DIM_OPACITY : 1;
      node.button.style.opacity = String(detail * scope);
    }
  }

  function installPointer(): void {
    if (canvas === null) return;
    let dragging = false;
    let draggingNode: Node | null = null;
    let start = { x: 0, y: 0 };
    let moved = 0;
    canvas.addEventListener('pointerdown', (event) => {
      lastInput = performance.now();
      idling = false;
      fly = null;
      start = { x: event.clientX, y: event.clientY };
      moved = 0;
      dragging = true;
      draggingNode = pick(event);
      canvas?.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const dx = event.movementX;
      const dy = event.movementY;
      moved += Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (draggingNode !== null) {
        draggingNode.layout.pinned = true;
        const size = canvasSize();
        const scale = (2 * Math.tan((22.5 * Math.PI) / 180) * pose.distance) / size.height;
        const yaw = (pose.yaw * Math.PI) / 180;
        const right: [number, number, number] = [Math.cos(yaw), 0, -Math.sin(yaw)];
        draggingNode.layout.position = [
          draggingNode.layout.position[0] + dx * scale * right[0],
          draggingNode.layout.position[1] - dy * scale,
          draggingNode.layout.position[2] + dx * scale * right[2],
        ];
        reheat();
        return;
      }
      pose.yaw += dx * ORBIT_DEGREES_PER_PIXEL;
      pose.pitch = clampPitch(pose.pitch + dy * ORBIT_DEGREES_PER_PIXEL);
    });
    const release = (event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      const node = draggingNode;
      draggingNode = null;
      if (node !== null && moved >= 4) {
        if (event.altKey) {
          node.layout.pinned = false;
          reheat();
          frame().announce(unpinnedCopy(node.title));
        } else {
          frame().announce(pinnedCopy(node.title));
        }
        selectedId = node.id;
        node.button.focus();
        renderLabels();
        return;
      }
      if (moved < 4) {
        const hit = pick(event);
        if (hit === null) {
          select(null, true);
          renderLabels();
          return;
        }
        selectedId = hit.id;
        hit.button.focus();
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        lastInput = performance.now();
        idling = false;
        fly = null;
        const size = canvasSize();
        const deltaY =
          event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * size.height : event.deltaY;
        pose.distance = clampDistance(pose.distance + deltaY * WHEEL_DISTANCE_PER_PIXEL);
      },
      { passive: false },
    );
  }

  /** Picking is computed from the geometry and never draws. */
  function pick(event: PointerEvent): Node | null {
    if (canvas === null) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
    const aspect = rect.width / rect.height;
    const tangent = Math.tan((22.5 * Math.PI) / 180);
    const eye = cameraEye(pose);
    const forward: [number, number, number] = [
      pose.target[0] - eye[0],
      pose.target[1] - eye[1],
      pose.target[2] - eye[2],
    ];
    const length = Math.hypot(forward[0], forward[1], forward[2]) || 1;
    const f: [number, number, number] = [forward[0] / length, forward[1] / length, forward[2] / length];
    const up: [number, number, number] = [0, 1, 0];
    let right: [number, number, number] = [
      f[1] * up[2] - f[2] * up[1],
      f[2] * up[0] - f[0] * up[2],
      f[0] * up[1] - f[1] * up[0],
    ];
    const rightLength = Math.hypot(right[0], right[1], right[2]) || 1;
    right = [right[0] / rightLength, right[1] / rightLength, right[2] / rightLength];
    const trueUp: [number, number, number] = [
      right[1] * f[2] - right[2] * f[1],
      right[2] * f[0] - right[0] * f[2],
      right[0] * f[1] - right[1] * f[0],
    ];
    const direction: [number, number, number] = [
      f[0] + right[0] * x * tangent * aspect + trueUp[0] * y * tangent,
      f[1] + right[1] * x * tangent * aspect + trueUp[1] * y * tangent,
      f[2] + right[2] * x * tangent * aspect + trueUp[2] * y * tangent,
    ];
    let best: { node: Node; distance: number } | null = null;
    for (const node of visibleNodes()) {
      const hit = raySphere(eye, direction, node.layout.position, node.drawnSize);
      if (hit === null) continue;
      if (best === null || hit < best.distance) best = { node, distance: hit };
    }
    return best === null ? null : best.node;
  }

  function syncAddress(): void {
    const params = new URLSearchParams();
    if (typeFilter !== null) params.set('type', typeFilter);
    if (collectionFilter !== null) params.set('collection', collectionFilter);
    const query = params.toString();
    navigate(`/graph${query === '' ? '' : `?${query}`}`);
  }

  async function load(): Promise<void> {
    const params = new URLSearchParams();
    if (scopeLinkId !== null) params.set('share_link_id', scopeLinkId);
    const query = params.toString();
    const result = await api.get<GraphDto>(`/api/graph${query === '' ? '' : `?${query}`}`);
    if (!result.ok) {
      if (result.status === 422 && scopeLinkId !== null) {
        scopeLinkId = null;
        scopeSelect.value = '';
        for (const node of nodes) {
          node.inScope = true;
          node.opacity = 1;
        }
        frame().showAlert(COPY.scopeLinkInactive);
        renderLabels();
        await load();
      }
      return;
    }
    const hadNodes = nodes.map((node) => node.id).join(',');
    const hadEdges = edges.map((edge) => edge.id).join(',');
    const previousEdgeIds = new Set(edges.map((edge) => edge.id));
    buildNodes(result.data);
    for (const edge of edges) {
      if (previousEdgeIds.size > 0 && !previousEdgeIds.has(edge.id)) newEdges.set(edge.id, performance.now());
    }
    const changed =
      hadNodes !== nodes.map((node) => node.id).join(',') || hadEdges !== edges.map((edge) => edge.id).join(',');
    if (changed) reheat();
    if (scopeLinkId !== null) applyScopeDimming();
    renderLabels();
  }

  /** Choosing a share link fades out-of-scope nodes and their edges. */
  function applyScopeDimming(): void {
    for (const node of nodes) {
      const target = scopeLinkId !== null && !node.inScope ? SCOPE_DIM_OPACITY : 1;
      if (node.opacity === target) continue;
      const from = node.opacity;
      node.targetOpacity = target;
      if (prefersReducedMotion()) {
        node.opacity = target;
        continue;
      }
      const started = performance.now();
      const step = (now: number): void => {
        const progress = Math.min(1, (now - started) / SCOPE_DIM_MS);
        node.opacity = from + (target - from) * progress;
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  async function loadShareLinks(): Promise<void> {
    const collections = workspace().collections;
    const all: ShareLinkDto[] = [];
    const names = new Map<string, string>();
    for (const collection of collections as CollectionDto[]) {
      const result = await api.get<{ share_links: ShareLinkDto[] }>(
        `/api/collections/${collection.id}/share-links`,
      );
      if (!result.ok) continue;
      for (const link of result.data.share_links) {
        if (link.status !== 'active') continue;
        all.push(link);
        names.set(link.id, collection.name);
      }
    }
    shareLinks = all.sort((a, b) => {
      const byName = (names.get(a.id) ?? '').localeCompare(names.get(b.id) ?? '');
      if (byName !== 0) return byName;
      return a.created_at < b.created_at ? 1 : -1;
    });
    clear(scopeSelect);
    scopeSelect.append(el('option', { text: 'None', attrs: { value: '' } }));
    for (const link of shareLinks) {
      scopeSelect.append(
        el('option', {
          text: `${names.get(link.id) ?? ''}, until ${link.expires_at_display}`,
          attrs: { value: link.id },
        }),
      );
    }
    scopeSelect.value = scopeLinkId ?? '';
  }

  return {
    async mount(params: ScreenParams): Promise<void> {
      const main = frame().main;
      clear(main);
      clear(frame().margin);
      frame().setTopTitle('Graph');
      typeFilter = params.search.get('type');
      collectionFilter = params.search.get('collection');

      clear(typeSelect);
      typeSelect.append(el('option', { text: 'All types', attrs: { value: '' } }));
      for (const type of libraryOrder(workspace().types)) {
        typeSelect.append(el('option', { text: type.name, attrs: { value: type.id } }));
      }
      typeSelect.value = typeFilter ?? '';
      typeSelect.addEventListener('change', () => {
        typeFilter = typeSelect.value === '' ? null : typeSelect.value;
        syncAddress();
        renderLabels();
      });

      clear(collectionSelect);
      collectionSelect.append(el('option', { text: 'All collections', attrs: { value: '' } }));
      for (const collection of workspace().collections) {
        collectionSelect.append(el('option', { text: collection.name, attrs: { value: collection.id } }));
      }
      collectionSelect.value = collectionFilter ?? '';
      collectionSelect.addEventListener('change', () => {
        collectionFilter = collectionSelect.value === '' ? null : collectionSelect.value;
        syncAddress();
        renderLabels();
      });

      scopeSelect.addEventListener('change', () => {
        scopeLinkId = scopeSelect.value === '' ? null : scopeSelect.value;
        if (scopeLinkId === null) {
          for (const node of nodes) node.inScope = true;
          applyScopeDimming();
          renderLabels();
        }
        void load();
      });

      clear(toolbar);
      toolbar.append(
        el('label', { text: 'Show type' }),
        typeSelect,
        el('label', { text: 'Show collection' }),
        collectionSelect,
        el('label', { text: 'Share scope' }),
        scopeSelect,
      );
      clear(group);
      clear(labelLayer);
      main.append(el('h1', { text: 'Graph', attrs: { tabindex: '-1' } }), toolbar, group);

      const size = canvasSize();
      canvas = el('canvas', { className: 'graph-canvas', attrs: { 'aria-hidden': 'true' } });
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
      try {
        renderer = new GraphRenderer(canvas);
        renderer.resize(size.width, size.height, window.devicePixelRatio);
        group.append(canvas, labelLayer);
      } catch {
        renderer = null;
        canvas = null;
        group.append(fallbackList);
      }

      await loadShareLinks();
      await load();
      settle(layoutNodes(), edges, INITIAL_STEPS);
      renderLabels();
      if (canvas !== null) {
        installPointer();
        frameId = requestAnimationFrame(drawFrame);
      }
      refreshTimer = window.setInterval(() => {
        if (scopeLinkId !== null) void load();
      }, GRAPH_REFRESH_MS);
      stopLive = onLive((type) => {
        if (
          type === 'backlinks.changed' ||
          type === 'object.saved' ||
          type === 'object.removed' ||
          type === 'share_link.changed'
        ) {
          void load();
          if (type === 'share_link.changed') void loadShareLinks();
        }
      });
    },
    unmount(): void {
      if (stopLive !== null) stopLive();
      if (frameId !== 0) cancelAnimationFrame(frameId);
      if (refreshTimer !== 0) window.clearInterval(refreshTimer);
      newEdges = new Map();
    },
  };
}
