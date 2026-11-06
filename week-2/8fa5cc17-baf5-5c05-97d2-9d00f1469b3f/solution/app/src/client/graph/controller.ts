// The link graph's live state: layout, camera pose, fly-to, idle turn, growth, scope dimming,
// pins and pointer input, drawn once per animation frame from the page clock.

import {
  DRAG_THRESHOLD_PX, HOME_POSE, LABEL_OFFSET_PX, IDLE_RESUME_MS, applyCameraKey, detailFactor, eyeOf, flyHome, flyTarget, fogFar,
  identity, idleTurn, interpolatePose, modelMatrix, normalize, orbit, pickNode, project, rayPlane, sceneProjection, screenRay, sub,
  viewMatrix, zoom, type CameraPose, type Mat4, type Vec3,
} from '../../shared/camera.ts';
import {
  OUT_OF_SCOPE_OPACITY, advanceReheat, createLayout, nodeSize, pin, positionOf, settle, startReheat, unpin, updateGraph,
  type Layout, type Reheat,
} from '../../shared/graph.ts';
import { EDGE_DRAW_MS, FLY_MS, NODE_GROW_MS, SCOPE_DIM_MS, quireEase } from '../../shared/motion.ts';
import { THEMES, glColor, type ThemeName } from '../../shared/tokens.ts';
import { reducedMotion } from '../motion.ts';
import type { GraphJson, GraphNodeJson } from '../types.ts';
import type { FrameUniforms, GraphScene, Rgb3 } from './scene.ts';

export interface GraphHooks {
  /** the node's label button, when rendered */
  label(id: string): HTMLElement | null;
  /** the SVG overlay that carries the shell rings */
  shells(): SVGSVGElement | null;
  focusLabel(id: string): void;
  selectionChanged(id: string | null): void;
  pinsChanged(pins: ReadonlySet<string>): void;
  announce(text: string): void;
  theme(): ThemeName;
}

export interface GraphFilter {
  type: string;
  collection: string;
}

/** A value animated from `from` to `to` starting at `start` (page clock). */
interface Tween {
  from: number;
  to: number;
  start: number;
}

interface Press {
  pointerId: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  travelled: number;
  dragging: boolean;
  /** node whose projected sphere is under the press */
  node: string | null;
  /** node whose label was pressed */
  label: string | null;
  /** camera-facing plane through the pressed node */
  planePoint: Vec3 | null;
  planeNormal: Vec3 | null;
}

const now = (): number => performance.now();

/** segments per shell ring, and the fog levels its segments are batched into */
const SHELL_SEGMENTS = 96;
const SHELL_FADE_STEPS = 8;

function tweenAt(t: Tween | undefined, at: number, ms: number, ease: (p: number) => number): number | undefined {
  if (!t) return undefined;
  const p = ms <= 0 ? 1 : Math.min(1, Math.max(0, (at - t.start) / ms));
  return t.from + (t.to - t.from) * ease(p);
}

const linear = (p: number): number => p;

export class GraphController {
  readonly hooks: GraphHooks;
  scene: GraphScene | null = null;
  canvas: HTMLCanvasElement | null = null;
  filter: GraphFilter = { type: '', collection: '' };

  layout: Layout | null = null;
  nodes = new Map<string, GraphNodeJson>();
  edges: GraphJson['edges'] = [];
  pose: CameraPose = { ...HOME_POSE, target: [...HOME_POSE.target] };
  selected: string | null = null;
  focused: string | null = null;

  private fly: { from: CameraPose; to: CameraPose; start: number } | null = null;
  private lastInput: number | null = null;
  private lastFrame: number | null = null;
  private reheat: Reheat | null = null;
  private sizes = new Map<string, Tween>();
  private dims = new Map<string, Tween>();
  private edgeDim: Tween = { from: 1, to: 1, start: 0 };
  private drawIn = new Map<string, number>();
  private scopeOn = false;
  private press: Press | null = null;
  private raf = 0;
  private running = false;

  // What the last frame showed, for picking and node drags.
  private shown: { view: Mat4; projection: Mat4; width: number; height: number } | null = null;

  constructor(hooks: GraphHooks) {
    this.hooks = hooks;
  }

  isVisible(id: string): boolean {
    const n = this.nodes.get(id);
    if (!n) return false;
    if (this.filter.type && n.type_id !== this.filter.type) return false;
    if (this.filter.collection && !n.collection_ids.includes(this.filter.collection)) return false;
    return true;
  }

  outOfScope(id: string): boolean {
    return this.scopeOn && this.nodes.get(id)?.in_scope === false;
  }

  isPinned(id: string): boolean {
    return this.layout?.pinned.has(id) ?? false;
  }

  /** Applies a fetched graph: the first one settles, later ones reheat, grow nodes and draw new edges in. */
  setData(graph: GraphJson, typeOrder: readonly string[], scoped: boolean): void {
    const at = now();
    const reduced = reducedMotion();
    const typeIndex = new Map(typeOrder.map((id, i) => [id, i]));
    const layoutNodes = graph.nodes.map((n) => ({ id: n.id, title: n.title, typeIndex: typeIndex.get(n.type_id) ?? typeOrder.length }));
    const layoutEdges = graph.edges.map((e) => ({ id: e.id, from: e.from, to: e.to }));
    const previous = this.nodes;
    if (!this.layout) {
      this.layout = createLayout(layoutNodes, layoutEdges);
      settle(this.layout);
    } else {
      const oldEdges = new Set(this.layout.edges.map((e) => e.id));
      const hadPins = this.layout.pinned.size;
      if (updateGraph(this.layout, layoutNodes, layoutEdges)) this.reheat = startReheat();
      for (const e of this.layout.edges) if (!oldEdges.has(e.id) && !reduced) this.drawIn.set(e.id, at);
      const live = new Set(this.layout.edges.map((e) => e.id));
      for (const id of [...this.drawIn.keys()]) if (!live.has(id)) this.drawIn.delete(id);
      if (this.layout.pinned.size !== hadPins) this.hooks.pinsChanged(new Set(this.layout.pinned));
    }
    this.nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    this.edges = graph.edges;
    this.scopeOn = scoped;
    for (const n of graph.nodes) {
      const target = nodeSize(n.backlinks);
      const old = previous.get(n.id);
      const current = this.sizeAt(n.id, at) ?? target;
      if (!old) this.sizes.set(n.id, { from: target, to: target, start: at });
      else if (this.sizes.get(n.id)?.to !== target) this.sizes.set(n.id, { from: reduced ? target : current, to: target, start: at });
      const dim = scoped && n.in_scope === false ? OUT_OF_SCOPE_OPACITY : 1;
      const tween = this.dims.get(n.id);
      if (!tween) this.dims.set(n.id, { from: dim, to: dim, start: at });
      else if (tween.to !== dim) this.dims.set(n.id, { from: reduced ? dim : this.dimAt(n.id, at), to: dim, start: at });
    }
    for (const id of [...this.sizes.keys()]) if (!this.nodes.has(id)) this.sizes.delete(id);
    for (const id of [...this.dims.keys()]) if (!this.nodes.has(id)) this.dims.delete(id);
    if (scoped && this.edgeDim.to !== OUT_OF_SCOPE_OPACITY) this.setEdgeDim(OUT_OF_SCOPE_OPACITY, reduced, at);
    if (this.selected !== null && !this.nodes.has(this.selected)) this.setSelected(null);
  }

  private setEdgeDim(to: number, instant: boolean, at: number): void {
    this.edgeDim = { from: instant ? to : (tweenAt(this.edgeDim, at, SCOPE_DIM_MS, linear) ?? to), to, start: at };
  }

  /** Removes the scope highlight: fading back, or at once when `instant`. */
  clearScope(instant: boolean): void {
    const at = now();
    const reduced = instant || reducedMotion();
    this.scopeOn = false;
    for (const [id, tween] of this.dims) {
      if (tween.to !== 1 || reduced) this.dims.set(id, { from: reduced ? 1 : this.dimAt(id, at), to: 1, start: at });
    }
    this.setEdgeDim(1, reduced, at);
  }

  sizeAt(id: string, at: number): number | undefined {
    return tweenAt(this.sizes.get(id), at, reducedMotion() ? 0 : NODE_GROW_MS, quireEase);
  }

  dimAt(id: string, at: number): number {
    return tweenAt(this.dims.get(id), at, reducedMotion() ? 0 : SCOPE_DIM_MS, linear) ?? 1;
  }

  // ---- frames ----

  /** Draws the first frame now, then one per animation frame. */
  start(): void {
    if (this.running || !this.scene || !this.layout) return;
    this.running = true;
    this.frame(now());
    const loop = (): void => {
      if (!this.running) return;
      this.frame(now());
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private idleAllowed(): boolean {
    return this.selected === null && this.press?.dragging !== true && !reducedMotion();
  }

  /** Advances layout and camera to `at`, then draws. */
  frame(at: number): void {
    const layout = this.layout;
    const scene = this.scene;
    const canvas = this.canvas;
    if (!layout || !scene || !canvas) return;
    const reduced = reducedMotion();
    const previous = this.lastFrame ?? at;
    if (this.reheat) {
      this.reheat = advanceReheat(layout, this.reheat, at - previous, reduced);
      if (this.reheat.remaining === 0) this.reheat = null;
    }
    if (this.fly) {
      const p = reduced ? 1 : Math.min(1, (at - this.fly.start) / FLY_MS);
      if (p >= 1) {
        this.pose = this.fly.to;
        this.fly = null;
      } else this.pose = interpolatePose(this.fly.from, this.fly.to, quireEase(p));
    } else if (this.idleAllowed()) {
      const activeFrom = this.lastInput === null ? -Infinity : this.lastInput + IDLE_RESUME_MS;
      const from = Math.max(previous, activeFrom);
      if (at > from) this.pose = idleTurn(this.pose, at - from);
    }
    this.lastFrame = at;
    for (const [id, start] of this.drawIn) if (reduced || at - start >= EDGE_DRAW_MS) this.drawIn.delete(id);
    this.draw(at, layout, scene, canvas);
  }

  private draw(at: number, layout: Layout, scene: GraphScene, canvas: HTMLCanvasElement): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const tokens = THEMES[this.hooks.theme()];
    const paper = glColor(tokens.paper);
    const ink = glColor(tokens.ink);
    const rule = glColor(tokens.rule);
    const link = glColor(tokens.link);
    const view = viewMatrix(this.pose);
    const projection = sceneProjection(width, height);
    this.shown = { view, projection, width, height };
    const frame: FrameUniforms = {
      view: new Float32Array(view), projection: new Float32Array(projection),
      fogNear: this.pose.distance, fogFar: fogFar(this.pose.distance), fogColor: paper,
    };
    scene.begin(Math.round(width * dpr), Math.round(height * dpr), paper);

    // Edge batches first.
    const plain: number[] = [];
    const chosen: number[] = [];
    const out: number[] = [];
    const drawing: Array<{ from: Vec3; to: Vec3; e: number; color: Rgb3; opacity: number }> = [];
    const edgeDim = tweenAt(this.edgeDim, at, reducedMotion() ? 0 : SCOPE_DIM_MS, linear) ?? 1;
    for (const edge of layout.edges) {
      if (!this.isVisible(edge.from) || !this.isVisible(edge.to)) continue;
      const a = positionOf(layout, edge.from);
      const b = positionOf(layout, edge.to);
      if (!a || !b) continue;
      const dimmed = this.outOfScope(edge.from) || this.outOfScope(edge.to) || this.dimAt(edge.from, at) < 1 || this.dimAt(edge.to, at) < 1;
      const isSelected = this.selected !== null && (edge.from === this.selected || edge.to === this.selected);
      const started = this.drawIn.get(edge.id);
      if (started !== undefined) {
        drawing.push({
          from: a, to: b, e: quireEase((at - started) / EDGE_DRAW_MS),
          color: dimmed ? rule : isSelected ? link : rule, opacity: dimmed ? edgeDim : 1,
        });
        continue;
      }
      (dimmed ? out : isSelected ? chosen : plain).push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    const ident = identity();
    if (plain.length) scene.lines(frame, new Float32Array(plain), ident, rule, 1);
    if (chosen.length) scene.lines(frame, new Float32Array(chosen), ident, link, 1);
    if (out.length) scene.lines(frame, new Float32Array(out), ident, rule, edgeDim);
    for (const d of drawing) {
      const v = sub(d.to, d.from);
      scene.lines(frame, new Float32Array([0, 0, 0, v[0], v[1], v[2]]), modelMatrix(d.from, d.e), d.color, d.opacity);
    }

    // Node spheres last.
    for (const id of layout.order) {
      if (!this.isVisible(id)) continue;
      const p = positionOf(layout, id);
      const n = this.nodes.get(id);
      if (!p || !n) continue;
      const s = this.sizeAt(id, at) ?? nodeSize(n.backlinks);
      scene.sphere(frame, modelMatrix(p, s), id === this.selected ? link : ink, this.dimAt(id, at));
    }
    this.placeLabels(at, layout, view, projection, width, height);
    this.placeShells(layout, view, projection, width, height);
  }

  /**
   * Draws each visible type's shell as its equator (solid) and meridian (dotted) through the scene
   * camera, each segment faded toward the paper by the same fog factor as the WebGL draws.
   */
  placeShells(layout: Layout, view: Mat4, projection: Mat4, width: number, height: number): void {
    const svg = this.hooks.shells();
    if (!svg) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const radii = new Set<number>();
    for (const id of layout.order) {
      const i = layout.index.get(id);
      if (i !== undefined && this.isVisible(id)) radii.add(layout.radius[i] ?? 0);
    }
    const near = this.pose.distance;
    const far = fogFar(near);
    const paths = new Map<string, string[]>();
    const ring = (r: number, meridian: boolean) => {
      let prev: { x: number; y: number; depth: number } | null = null;
      for (let k = 0; k <= SHELL_SEGMENTS; k++) {
        const a = (k / SHELL_SEGMENTS) * Math.PI * 2;
        const point: Vec3 = meridian ? [0, r * Math.cos(a), r * Math.sin(a)] : [r * Math.cos(a), 0, r * Math.sin(a)];
        const p = project(point, view, projection, width, height);
        if (prev && prev.depth > 0 && p.depth > 0) {
          const fog = Math.min(1, Math.max(0, ((prev.depth + p.depth) / 2 - near) / (far - near)));
          const key = `${meridian ? 'm' : 'e'}${Math.round((1 - fog) * SHELL_FADE_STEPS)}`;
          const list = paths.get(key) ?? [];
          list.push(`M${prev.x.toFixed(1)} ${prev.y.toFixed(1)}L${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
          paths.set(key, list);
        }
        prev = p;
      }
    };
    for (const r of radii) {
      ring(r, false);
      ring(r, true);
    }
    for (const el of [...svg.children]) if (!paths.has(el.getAttribute('data-shell') ?? '')) el.remove();
    for (const [key, list] of paths) {
      let el = svg.querySelector<SVGPathElement>(`[data-shell="${key}"]`);
      if (!el) {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        el.setAttribute('data-shell', key);
        el.setAttribute('class', key.startsWith('m') ? 'graph-shell graph-shell-meridian' : 'graph-shell');
        el.setAttribute('stroke-opacity', String(Number(key.slice(1)) / SHELL_FADE_STEPS));
        svg.appendChild(el);
      }
      el.setAttribute('d', list.join(''));
    }
  }

  /** Lays each visible node's button over its projected point and sets its text opacity. */
  placeLabels(at: number, layout: Layout, view: Mat4, projection: Mat4, width: number, height: number): void {
    for (const id of layout.order) {
      if (!this.isVisible(id)) continue;
      const el = this.hooks.label(id);
      const p = positionOf(layout, id);
      const n = this.nodes.get(id);
      if (!el || !p || !n) continue;
      const projected = project(p, view, projection, width, height);
      if (Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
        el.style.transform = `translate(${projected.x + LABEL_OFFSET_PX}px, ${projected.y}px) translateY(-50%)`;
      }
      const s = this.sizeAt(id, at) ?? nodeSize(n.backlinks);
      const detail = detailFactor({ s, projected, width, height, selected: id === this.selected, focused: id === this.focused });
      const text = el.firstElementChild;
      if (text instanceof HTMLElement) text.style.opacity = String(detail * this.dimAt(id, at));
      // A label projected off the canvas takes no presses where it overhangs the margin.
      const onCanvas = projected.depth > 0 && projected.x >= 0 && projected.x <= width && projected.y >= 0 && projected.y <= height;
      el.style.pointerEvents = onCanvas ? '' : 'none';
    }
  }

  // ---- selection, camera and pins ----

  private setSelected(id: string | null): void {
    if (this.selected === id) return;
    this.selected = id;
    this.hooks.selectionChanged(id);
  }

  /** Any pointer press, wheel, key or focus in the graph stops the idle turn. */
  input(): void {
    this.lastInput = now();
  }

  /** Stops a fly-to at the pose last drawn. */
  private stopFly(): void {
    this.fly = null;
  }

  private flyTo(to: CameraPose): void {
    this.fly = { from: this.pose, to, start: now() };
  }

  select(id: string, fly: boolean): void {
    this.setSelected(id);
    if (!fly || !this.layout) return;
    const p = positionOf(this.layout, id);
    const n = this.nodes.get(id);
    if (p && n) this.flyTo(flyTarget(p, nodeSize(n.backlinks), this.pose.yaw));
  }

  /** Focus reached a node button: it is selected and the camera flies to it. */
  focusNode(id: string): void {
    this.input();
    this.focused = id;
    if (this.selected !== id) this.select(id, true);
  }

  blurNode(id: string): void {
    if (this.focused === id) this.focused = null;
  }

  /** Escape or a click on empty canvas: no selection, and the camera flies home. */
  home(): void {
    this.input();
    this.setSelected(null);
    this.flyTo(flyHome(this.pose.yaw));
  }

  cameraKey(key: string, shiftKey: boolean): boolean {
    const next = applyCameraKey(this.pose, key, shiftKey);
    if (!next) return false;
    this.input();
    this.adjustPose((pose) => applyCameraKey(pose, key, shiftKey) ?? pose);
    return true;
  }

  /** Orbit and zoom apply at once; a running fly-to keeps flying to its node with the change applied. */
  private adjustPose(change: (pose: CameraPose) => CameraPose): void {
    if (this.fly) this.fly = { ...this.fly, from: change(this.fly.from), to: change(this.fly.to) };
    this.pose = change(this.pose);
  }

  togglePin(id: string): void {
    const layout = this.layout;
    const n = this.nodes.get(id);
    if (!layout || !n) return;
    if (layout.pinned.has(id)) {
      unpin(layout, id);
      this.reheat = startReheat();
      this.hooks.announce(`Unpinned ${n.title}.`);
    } else {
      pin(layout, id);
      this.hooks.announce(`Pinned ${n.title}.`);
    }
    this.hooks.pinsChanged(new Set(layout.pinned));
  }

  wheel(deltaYPx: number): void {
    this.input();
    this.adjustPose((pose) => zoom(pose, deltaYPx));
  }

  // ---- pointer ----

  /** The visible node whose projected sphere lies under canvas point (x, y), nearest first. */
  private pick(x: number, y: number): string | null {
    const layout = this.layout;
    const shown = this.shown;
    if (!layout || !shown) return null;
    const ray = screenRay(x, y, shown.width, shown.height, shown.view, shown.projection);
    if (!ray) return null;
    const at = now();
    const targets = [];
    for (const id of layout.order) {
      const p = positionOf(layout, id);
      const n = this.nodes.get(id);
      if (!this.isVisible(id) || !p || !n) continue;
      targets.push({ id, pos: p, s: this.sizeAt(id, at) ?? nodeSize(n.backlinks) });
    }
    return pickNode(ray.origin, ray.dir, targets)?.id ?? null;
  }

  pointerDown(pointerId: number, x: number, y: number, label: string | null): void {
    this.input();
    const node = this.pick(x, y);
    let planePoint: Vec3 | null = null;
    let planeNormal: Vec3 | null = null;
    if (node && this.layout) {
      const p = positionOf(this.layout, node);
      if (p) {
        planePoint = [p[0], p[1], p[2]];
        planeNormal = normalize(sub(eyeOf(this.pose), this.pose.target));
      }
    }
    this.press = { pointerId, x, y, lastX: x, lastY: y, travelled: 0, dragging: false, node, label, planePoint, planeNormal };
  }

  pointerMove(pointerId: number, x: number, y: number): void {
    const press = this.press;
    if (!press || press.pointerId !== pointerId) return;
    this.input();
    press.travelled += Math.hypot(x - press.lastX, y - press.lastY);
    if (!press.dragging) {
      press.lastX = x;
      press.lastY = y;
      if (press.travelled < DRAG_THRESHOLD_PX) return;
      press.dragging = true;
      this.stopFly();
      if (press.node) {
        const n = this.nodes.get(press.node);
        this.setSelected(press.node);
        this.hooks.focusLabel(press.node);
        if (n) this.hooks.announce(`Pinned ${n.title}.`);
      } else {
        this.pose = orbit(this.pose, x - press.x, y - press.y);
        return;
      }
    }
    if (press.node) this.dragNode(press, x, y);
    else this.pose = orbit(this.pose, x - press.lastX, y - press.lastY);
    press.lastX = x;
    press.lastY = y;
  }

  private dragNode(press: Press, x: number, y: number): void {
    const layout = this.layout;
    const shown = this.shown;
    if (!layout || !shown || !press.node || !press.planePoint || !press.planeNormal) return;
    const ray = screenRay(x, y, shown.width, shown.height, shown.view, shown.projection);
    const hit = ray ? rayPlane(ray.origin, ray.dir, press.planePoint, press.planeNormal) : null;
    const wasPinned = layout.pinned.has(press.node);
    pin(layout, press.node, hit ?? undefined);
    this.reheat = { ...startReheat(), carryMs: this.reheat?.carryMs ?? 0 };
    if (!wasPinned) this.hooks.pinsChanged(new Set(layout.pinned));
  }

  pointerUp(pointerId: number, altKey: boolean): void {
    const press = this.press;
    if (!press || press.pointerId !== pointerId) return;
    this.press = null;
    this.input();
    if (press.dragging) {
      if (press.node && altKey && this.layout?.pinned.has(press.node)) this.togglePin(press.node);
      return;
    }
    const target = press.node ?? press.label;
    if (target) {
      this.select(target, true);
      this.hooks.focusLabel(target);
    } else this.home();
  }

  pointerCancel(pointerId: number): void {
    if (this.press?.pointerId === pointerId) this.press = null;
  }
}
