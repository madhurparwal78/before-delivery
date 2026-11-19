import * as THREE from 'three';
import { panelPoint, type PanelId } from './panels.js';
import {
  BEAT_PX, HERO_HOLD_PX, buildScene, cameraFor, projectPoint, restingCamera, scrollObservables,
  viewProjectionString, type StageFinding,
} from './stage.js';

export interface WalkroundOptions {
  container: HTMLElement;
  findings: () => StageFinding[];
  heroId: () => string | null;
  listing: () => string;
  onScrollSeen: (findingId: string) => void;
  onMarkerTap: (findingId: string, position: number) => void;
}

/**
 * The walkround engine: draws the stage only when scroll position, viewport size or server
 * state changes, writes seen records only on the buyer's own forward scrolling, and keeps
 * the published observables on the container.
 */
export class Walkround {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private markers = new Map<string, { ring: THREE.Mesh; core: THREE.Mesh; group: THREE.Group }>();
  private frameCount = 0;
  private lastKey = '';
  private lastCrossings = new Set<string>();
  private programmaticScroll = false;
  private rendererKind: 'webgl' | 'svg' = 'webgl';
  private mode: 'scroll' | 'still' = 'scroll';
  private reduced: boolean;
  private heroVertex: THREE.Mesh | null = null;
  private dimmed = false;
  private destroyed = false;

  constructor(private opts: WalkroundOptions) {
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.mode = this.reduced ? 'still' : 'scroll';
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x16121f);
    const built = buildScene();
    this.scene.add(built.group);
    this.scene.add(built.markerGroup);
    this.markerRoot = built.markerGroup;
    this.panelMeshes = built.panelMeshes as unknown as Map<PanelId, THREE.Object3D[]>;
    this.buildHeroVertex();
    this.initRenderer();
    this.attach();
  }

  private markerRoot: THREE.Group;

  private initRenderer(): void {
    if (this.reduced || !window.WebGLRenderingContext) {
      this.rendererKind = 'svg';
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl', { preserveDrawingBuffer: true });
      if (!gl) { this.rendererKind = 'svg'; return; }
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(Math.min(3, window.devicePixelRatio || 1));
      this.opts.container.replaceChildren(this.renderer.domElement);
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.loseContext();
      });
    } catch {
      this.rendererKind = 'svg';
    }
  }

  /** Drop to the drawn still: no more canvas, no scrub, pills carry the walkround. */
  loseContext(): void {
    this.rendererKind = 'svg';
    this.mode = 'still';
    if (this.renderer) {
      this.renderer.domElement.remove();
      this.renderer = null;
    }
    this.draw();
  }

  private buildHeroVertex(): void {
    const geometry = new THREE.SphereGeometry(0.22, 12, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xdde6ff });
    this.heroVertex = new THREE.Mesh(geometry, material);
    this.scene.add(this.heroVertex);
  }

  private attach(): void {
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onResize);
    this.onScroll();
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onResize);
    this.renderer?.dispose();
    this.renderer = null;
  }

  private onResize = (): void => {
    this.draw();
  };

  private onScroll = (): void => {
    if (this.programmaticScroll) { this.programmaticScroll = false; this.draw(); return; }
    const crossings = this.currentCrossings();
    for (const id of crossings) {
      if (!this.lastCrossings.has(id)) {
        const finding = this.opts.findings().find(f => f.id === id);
        if (finding && !finding.seen) this.opts.onScrollSeen(id);
      }
    }
    this.lastCrossings = crossings;
    this.draw();
  };

  /** Findings whose hand-off point the scroll position has passed, in walkround order. */
  private currentCrossings(): Set<string> {
    if (this.mode === 'still' || this.rendererKind === 'svg') return new Set();
    const y = window.scrollY;
    const out = new Set<string>();
    if (y < HERO_HOLD_PX) return out;
    const findings = this.opts.findings();
    for (let k = 1; k <= findings.length; k++) {
      const handOff = HERO_HOLD_PX + k * BEAT_PX - BEAT_PX * 0.4;
      if (y >= handOff) out.add(findings[k - 1].id);
    }
    return out;
  }

  /** Links, Next unread and deliberate jumps write nothing. */
  suppressNextWrite(): void {
    this.programmaticScroll = true;
    this.lastCrossings = this.currentCrossings();
  }

  markersDirty = true;

  syncMarkers(findings: StageFinding[]): void {
    if (this.destroyed) return;
    const present = new Set(findings.map(f => f.id));
    for (const [id, marker] of this.markers) {
      if (!present.has(id)) {
        this.markerRoot.remove(marker.group);
        this.markers.delete(id);
      }
    }
    for (const f of findings) {
      let marker = this.markers.get(f.id);
      if (!marker) {
        const group = new THREE.Group();
        const ringGeo = new THREE.RingGeometry(0.12, 0.16, 24);
        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xdfe7ff, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
        const coreGeo = new THREE.CircleGeometry(0.06, 16);
        const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0x0c0816 }));
        core.position.z = 0.01;
        group.add(ring); group.add(core);
        this.markerRoot.add(group);
        marker = { ring, core, group };
        this.markers.set(f.id, marker);
      }
      const world = panelPoint(f.panelId, f.u, f.v);
      marker.group.position.set(world[0], world[1], world[2]);
      // Markers face the camera at a constant screen size: rescaled on each frame.
      const isSeen = f.seen;
      (marker.core.material as THREE.MeshBasicMaterial).color.set(isSeen ? 0xdfe7ff : 0x0c0816);
      marker.ring.visible = !isSeen;
      marker.core.scale.setScalar(isSeen ? 1.6 : 1);
    }
    this.markersDirty = false;
  }

  private dim: number | null = null;

  private draw(): void {
    if (this.destroyed) return;
    const container = this.opts.container;
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const findings = this.opts.findings();
    this.syncMarkers(findings);
    const listing = this.opts.listing();
    const dimmed = listing === 'under_offer' || listing === 'sold' || listing === 'withdrawn';
    const { beat, progress, finding } = this.mode === 'still'
      ? { beat: 0, progress: 0, finding: this.heroFinding(findings) }
      : scrollObservables(window.scrollY, findings, this.opts.heroId(), height);
    const activeFinding = beat === 0 ? this.heroFinding(findings) : finding;
    const anchorUv = activeFinding ? `${activeFinding.u.toFixed(3)},${activeFinding.v.toFixed(3)}` : '';
    const panel = activeFinding?.panelId ?? '';
    const rimGlow = beat > 0 ? (progress <= 0.4 ? progress / 0.4 : 1) : 0;
    const cardTravel = beat > 0 ? (progress <= 0.6 ? 0 : (progress - 0.6) / 0.4) : 0;
    const key = `${this.rendererKind}|${this.mode}|${beat}|${Math.round(progress * 100)}|${panel}|${activeFinding?.id}|${width}x${height}|${findings.map(f => f.seen ? '1' : '0').join('')}|${listing}|${dimmed ? 'd' : 'l'}`;
    const changed = key !== this.lastKey || this.markersDirty;
    if (!changed) return;
    this.lastKey = key;
    this.markersDirty = false;

    if (this.rendererKind === 'svg' || !this.renderer) {
      this.renderSvgStill(activeFinding, findings, dimmed, width, height);
      this.writeObservables(this.rendererKind, this.mode, beat, progress, panel, anchorUv, rimGlow, cardTravel, null, null);
      return;
    }

    const renderer = this.renderer;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const world = activeFinding ? panelPoint(activeFinding.panelId, activeFinding.u, activeFinding.v) : [0, 1, 0] as [number, number, number];
    const pose = beat === 0 ? restingCamera(world, aspect) : beatPose(activeFinding, progress);
    const { camera, angleDeg } = cameraFor(pose, aspect);
    this.currentAngle = angleDeg;
    if (this.heroVertex) {
      this.heroVertex.position.set(world[0], world[1], world[2]);
      this.heroVertex.visible = beat === 0;
      (this.heroVertex.material as THREE.MeshBasicMaterial).color.set(dimmed ? 0x3c3652 : 0xeef3ff);
    }
    // Rim glow brightens the current panel's meshes.
    for (const [panelId, meshes] of this.panelMeshes) {
      const isCurrent = panelId === activeFinding?.panelId;
      for (const mesh of meshes) {
        const material = (mesh as THREE.Mesh).material as THREE.Material & { color?: THREE.Color; opacity?: number };
        if ('color' in material && material.color) {
          material.color.set(dimmed ? 0x2c2740 : isCurrent ? 0x8a97ec : 0x5a63b0);
          material.opacity = isCurrent && !dimmed ? 0.65 + 0.35 * rimGlow : dimmed ? 0.5 : 0.85;
          material.transparent = true;
        }
      }
      void panelId;
    }
    // Marker sizes constant in screen space.
    const distance = camera.position.distanceTo(new THREE.Vector3(world[0], world[1], world[2]));
    const scale = distance * 0.028;
    for (const marker of this.markers.values()) {
      marker.group.scale.setScalar(scale);
      marker.group.lookAt(camera.position);
      const coreColor = (marker.core.material as THREE.MeshBasicMaterial).color;
      const ringMat = (marker.ring.material as THREE.MeshBasicMaterial);
      coreColor.multiplyScalar(1);
      ringMat.color.set(dimmed ? 0x6a6482 : 0xdfe7ff);
      if (dimmed) coreColor.set(marker.core.scale.x > 1 ? 0x8a86a0 : 0x0c0816);
    }
    renderer.render(this.scene, camera);
    this.frameCount += 1;
    const vp = viewProjectionString(camera);
    const pos = camera.position.toArray().map(n => n.toFixed(3)).join(',');
    this.writeObservables('webgl', this.mode, beat, progress, panel, anchorUv, rimGlow, cardTravel, pos, vp);
  }

  private panelMeshes = new Map<PanelId, THREE.Object3D[]>();

  private writeObservables(renderer: string, mode: string, beat: number, progress: number, panel: string, anchor: string, rimGlow: number, cardTravel: number, cameraPos: string | null, vp: string | null): void {
    const el = this.opts.container;
    el.dataset.renderer = renderer;
    el.dataset.mode = mode;
    el.dataset.beat = String(beat);
    el.dataset.beatProgress = progress.toFixed(2);
    el.dataset.panel = panel;
    el.dataset.anchor = anchor;
    el.dataset.rimGlow = rimGlow.toFixed(2);
    el.dataset.cardTravel = cardTravel.toFixed(2);
    el.dataset.listing = this.opts.listing();
    el.dataset.frameCount = String(this.frameCount);
    if (cameraPos !== null) el.dataset.cameraPosition = cameraPos;
    if (vp !== null) el.dataset.viewProjection = vp;
    if (cameraPos !== null) el.dataset.cameraAngle = String(Math.round(this.currentAngle));
  }

  private currentAngle = 0;

  /** The drawn still: one vector frame with a pin per finding placed by the projection. */
  private renderSvgStill(active: StageFinding | null, findings: StageFinding[], dimmed: boolean, width: number, height: number): void {
    const world = active ? panelPoint(active.panelId, active.u, active.v) : [0, 1, 0] as [number, number, number];
    const pose = restingCamera(world, width / height);
    const { camera } = cameraFor(pose, width / height);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'facet-still');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Facet still of this car`);
    // Facets as projected quads.
    const facets = document.createElementNS(ns, 'g');
    this.scene.children.forEach(child => {
      if (!(child as THREE.Mesh).isMesh && !(child as THREE.Line).isLine) return;
      if ((child as THREE.Mesh).geometry instanceof THREE.SphereGeometry) return;
      const geometry = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!geometry || !geometry.getAttribute('position')) return;
      const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
      const points: string[] = [];
      for (let i = 0; i < attr.count; i++) {
        const p = new THREE.Vector3(attr.getX(i), attr.getY(i), attr.getZ(i));
        const projected = p.applyMatrix4(child.matrixWorld).project(camera);
        if (projected.z < -1 || projected.z > 1) return;
        points.push(`${((projected.x + 1) / 2 * width).toFixed(1)},${((1 - projected.y) / 2 * height).toFixed(1)}`);
      }
      const poly = document.createElementNS(ns, 'polygon');
      poly.setAttribute('points', points.join(' '));
      const material = (child as THREE.Mesh).material as THREE.Material & { color?: THREE.Color };
      const color = dimmed ? '#251f38' : child === this.heroVertex ? '#cfd8ff' : '#4c5590';
      poly.setAttribute('fill', material && 'color' in material && material.color ? `#${material.color.getHexString()}` : color);
      poly.setAttribute('opacity', dimmed ? '0.45' : '0.9');
      facets.appendChild(poly);
    });
    svg.appendChild(facets);
    for (const f of findings) {
      const w = panelPoint(f.panelId, f.u, f.v);
      const projected = new THREE.Vector3(w[0], w[1], w[2]).project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const x = (projected.x + 1) / 2 * width;
      const y = (1 - projected.y) / 2 * height;
      if (x < 0 || x > width || y < 0 || y > height) continue;
      const pin = document.createElementNS(ns, 'g');
      pin.setAttribute('data-finding-id', f.id);
      pin.setAttribute('data-seen', String(f.seen));
      pin.setAttribute('tabindex', '-1');
      pin.style.cursor = 'pointer';
      pin.addEventListener('click', () => this.opts.onMarkerTap(f.id, f.position));
      const ring = document.createElementNS(ns, 'circle');
      ring.setAttribute('cx', String(x)); ring.setAttribute('cy', String(y));
      ring.setAttribute('r', '12'); ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', dimmed ? '#6a6482' : '#dfe7ff'); ring.setAttribute('stroke-width', '3');
      const core = document.createElementNS(ns, 'circle');
      core.setAttribute('cx', String(x)); core.setAttribute('cy', String(y));
      core.setAttribute('r', f.seen ? '9' : '5');
      core.setAttribute('fill', f.seen ? (dimmed ? '#8a86a0' : '#dfe7ff') : '#0c0816');
      pin.appendChild(ring); pin.appendChild(core);
      svg.appendChild(pin);
    }
    this.opts.container.replaceChildren(svg);
    this.frameCount += 1;
    const vp = viewProjectionString(camera);
    this.writeObservables('svg', 'still', 0, 0, active?.panelId ?? '', active ? `${active.u.toFixed(3)},${active.v.toFixed(3)}` : '', 0, 0, camera.position.toArray().map(n => n.toFixed(3)).join(','), vp);
  }

  private heroFinding(findings: StageFinding[]): StageFinding | null {
    const heroId = this.opts.heroId();
    return findings.find(f => f.id === heroId) ?? findings[0] ?? null;
  }

  /** The nearest marker projection to a canvas point, for marker taps. */
  hitTest(clientX: number, clientY: number): string | null {
    const rect = this.opts.container.getBoundingClientRect();
    const findings = this.opts.findings();
    if (this.rendererKind === 'svg' || !this.renderer) {
      let best: { id: string; d: number } | null = null;
      const active = this.heroFinding(findings);
      const world = active ? panelPoint(active.panelId, active.u, active.v) : [0, 1, 0] as [number, number, number];
      const pose = restingCamera(world, rect.width / rect.height);
      const { camera } = cameraFor(pose, rect.width / rect.height);
      for (const f of findings) {
        const w = panelPoint(f.panelId, f.u, f.v);
        const p = new THREE.Vector3(w[0], w[1], w[2]).project(camera);
        const x = (p.x + 1) / 2 * rect.width;
        const y = (1 - p.y) / 2 * rect.height;
        const d = Math.hypot(clientX - rect.left - x, clientY - rect.top - y);
        if (d <= 22 && (!best || d < best.d || (d === best.d && f.position > (findings.find(g => g.id === best?.id)?.position ?? 0)))) {
          best = { id: f.id, d };
        }
      }
      return best?.id ?? null;
    }
    const { beat, finding } = scrollObservables(window.scrollY, findings, this.opts.heroId(), rect.height);
    const active = beat === 0 ? this.heroFinding(findings) : finding;
    if (!active) return null;
    const world = panelPoint(active.panelId, active.u, active.v);
    const pose = beat === 0 ? restingCamera(world, rect.width / rect.height) : beatPose(active, scrollProgress());
    const { camera } = cameraFor(pose, rect.width / rect.height);
    let best: { id: string; d: number } | null = null;
    for (const f of findings) {
      const w = panelPoint(f.panelId, f.u, f.v);
      const p = new THREE.Vector3(w[0], w[1], w[2]).project(camera);
      if (p.z < -1 || p.z > 1) continue;
      const x = (p.x + 1) / 2 * rect.width;
      const y = (1 - p.y) / 2 * rect.height;
      if (x < 0 || x > rect.width || y < 0 || y > rect.height) continue;
      const d = Math.hypot(clientX - rect.left - x, clientY - rect.top - y);
      if (d <= 22 && (!best || d < best.d)) best = { id: f.id, d };
    }
    return best?.id ?? null;
  }

  redraw(): void {
    this.markersDirty = true;
    this.draw();
  }
}

function scrollProgress(): number {
  const y = window.scrollY;
  if (y < HERO_HOLD_PX) return 0;
  return Math.min(1, ((y - HERO_HOLD_PX) % BEAT_PX) / BEAT_PX);
}

function beatPose(finding: StageFinding, progress: number): { eye: [number, number, number]; look: [number, number, number]; fov: number } {
  const point = panelPoint(finding.panelId, finding.u, finding.v);
  const baseAngle = Math.atan2(point[0], -point[2]);
  const beatStartAngle = finding.position * 22 * (Math.PI / 180);
  const angle = beatStartAngle + (baseAngle - beatStartAngle) * Math.min(1, progress * 1.4);
  const distance = 7.2 - progress * 0.8;
  return {
    eye: [Math.sin(angle) * distance, 2.6 - progress * 0.5, Math.cos(angle) * distance],
    look: point,
    fov: 40,
  };
}
