import * as THREE from 'three';
import type { ScenePart, RailResult } from './types';

// The moped scene: one parts table drives the meshes. Real WebGL built in code,
// with a still drawing generated from the same table when WebGL is missing.

export interface SceneState {
  azimuthDeg: number;
  elevationDeg: number;
  zoom: number;
  selectedPart: string;
  travelMm: Record<string, number>;
  fouling: { part: string; feature: string } | null;
  renderer: 'webgl' | 'still';
  meshCount: number;
}

export interface SceneCallbacks {
  onAttributes: () => void;
}

export class MopedScene {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private meshes = new Map<string, THREE.Mesh>();
  private group = new THREE.Group();
  private feelerPlanes = new Map<string, THREE.Mesh>();
  private foulingEdges = new Map<string, THREE.Mesh>();
  private rails: { pack: RailResult; hub: RailResult } | null = null;
  private storyOffsets: Record<string, [number, number, number]> = {};
  private canvas: HTMLCanvasElement | null = null;
  private host: HTMLElement | null = null;
  state: SceneState = {
    azimuthDeg: 30, elevationDeg: 15, zoom: 1,
    selectedPart: '', travelMm: {}, fouling: null, renderer: 'webgl', meshCount: 0,
  };

  constructor(private parts: ScenePart[], private callbacks: SceneCallbacks) {}

  mount(host: HTMLElement): 'webgl' | 'still' {
    this.host = host;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
      if (!gl) throw new Error('no webgl');
      this.canvas = canvas;
      canvas.className = 'moped-canvas';
      host.appendChild(canvas);
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      this.renderer.setClearColor(0xfaf6ef, 1);
      this.buildMeshes();
      this.state.renderer = 'webgl';
      this.state.meshCount = this.meshes.size;
      this.applyState();
      this.resize();
      this.render();
      return 'webgl';
    } catch {
      this.state.renderer = 'still';
      this.state.meshCount = this.parts.length;
      return 'still';
    }
  }

  private buildMeshes(): void {
    const ink = new THREE.MeshBasicMaterial({ color: 0x211d17 });
    const paper = new THREE.MeshBasicMaterial({ color: 0xefe8dc, transparent: true });
    const accent = new THREE.MeshBasicMaterial({ color: 0xc8471b, transparent: true });
    const wheelMat = new THREE.MeshBasicMaterial({ color: 0x211d17 });
    this.scene.add(this.group);

    const add = (part: ScenePart, geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.partId = part.id;
      this.group.add(mesh);
      this.meshes.set(part.id, mesh);
      const feeler = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial({ color: 0xc8471b, side: THREE.DoubleSide }));
      feeler.visible = false;
      this.group.add(feeler);
      this.feelerPlanes.set(part.id, feeler);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.32), new THREE.MeshBasicMaterial({ color: 0xc8471b }));
      edge.visible = false;
      this.group.add(edge);
      this.foulingEdges.set(part.id, edge);
    };

    for (const part of this.parts) {
      if (part.id.includes('wheel')) {
        add(part, new THREE.TorusGeometry(0.16, 0.045, 12, 28), wheelMat);
      } else if (part.id === 'traction-pack') {
        add(part, new THREE.BoxGeometry(0.34, 0.18, 0.18), accent);
      } else if (part.id === 'hub-motor') {
        const g = new THREE.CylinderGeometry(0.07, 0.07, 0.12, 16);
        add(part, g, accent);
        this.meshes.get(part.id)!.rotation.x = Math.PI / 2;
      } else if (part.id === 'controller') {
        add(part, new THREE.BoxGeometry(0.16, 0.09, 0.1), accent);
      } else if (part.id === 'frame') {
        add(part, new THREE.BoxGeometry(0.82, 0.1, 0.18), ink);
      } else if (part.id === 'front-fork') {
        add(part, new THREE.CylinderGeometry(0.02, 0.02, 0.48, 8), ink);
      } else if (part.id === 'swingarm') {
        add(part, new THREE.BoxGeometry(0.42, 0.05, 0.12), ink);
      } else {
        add(part, new THREE.BoxGeometry(0.22, 0.3, 0.42), paper);
      }
    }
  }

  setParts(parts: ScenePart[]): void {
    this.parts = parts;
    if (!this.renderer) return;
    for (const m of [...this.meshes.values(), ...this.feelerPlanes.values(), ...this.foulingEdges.values()]) {
      this.group.remove(m);
    }
    this.meshes.clear();
    this.feelerPlanes.clear();
    this.foulingEdges.clear();
    this.buildMeshes();
    this.state.meshCount = this.meshes.size;
    this.applyState();
    this.render();
  }

  setRails(rails: { pack: RailResult; hub: RailResult } | null): void {
    this.rails = rails;
  }

  setSelected(partId: string): void {
    this.state.selectedPart = partId;
    this.applyState();
    this.render();
    this.callbacks.onAttributes();
  }

  setTravel(partId: string, travelMm: number): void {
    this.state.travelMm[partId] = travelMm;
    this.applyState();
    this.render();
    this.callbacks.onAttributes();
  }

  setFouling(part: string | null, feature: string | null): void {
    this.state.fouling = part ? { part, feature: feature ?? '' } : null;
    this.applyState();
    this.render();
    this.callbacks.onAttributes();
  }

  setStoryOffsets(offsets: Record<string, [number, number, number]>): void {
    this.storyOffsets = offsets;
    this.applyState();
    this.render();
    this.callbacks.onAttributes();
  }

  setPanelFade(selectedPart: string, fade: boolean): void {
    for (const part of this.parts) {
      const mesh = this.meshes.get(part.id);
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (!mat.transparent) continue;
      const shouldFade = fade && part.fadedFor.includes(selectedPart === 'traction-pack' ? 'pack' : 'hub');
      mat.opacity = shouldFade ? 0.25 : 1;
    }
    this.render();
  }

  orbit(dAzimuth: number, dElevation: number): void {
    this.state.azimuthDeg += dAzimuth;
    this.state.elevationDeg = Math.max(-15, Math.min(75, this.state.elevationDeg + dElevation));
    this.render();
    this.callbacks.onAttributes();
  }

  zoomBy(factor: number): void {
    this.state.zoom = Math.max(0.5, Math.min(2.0, this.state.zoom * factor));
    this.render();
    this.callbacks.onAttributes();
  }

  resetView(): void {
    this.state.azimuthDeg = 30;
    this.state.elevationDeg = 15;
    this.state.zoom = 1;
    this.render();
    this.callbacks.onAttributes();
  }

  private applyState(): void {
    for (const part of this.parts) {
      const mesh = this.meshes.get(part.id);
      if (!mesh) continue;
      const base = part.position;
      const travel = this.state.travelMm[part.id] ?? 0;
      const story = this.storyOffsets[part.id] ?? [0, 0, 0];
      let dx = 0, dy = 0, dz = 0;
      if (part.axis === '+x') dx = travel;
      if (part.axis === '-x') dx = -travel;
      if (part.axis === '+y') dy = travel;
      if (part.axis === '-y') dy = -travel;
      if (part.axis === '+z') dz = travel;
      if (part.axis === '-z') dz = -travel;
      mesh.position.set(
        (base[0] + dx + story[0]) / 1000,
        (base[1] + dy + story[1]) / 1000,
        (base[2] + dz + story[2]) / 1000,
      );
      const isRailPart = part.id === 'traction-pack' || part.id === 'hub-motor';
      const feeler = this.feelerPlanes.get(part.id);
      if (feeler) {
        feeler.visible = isRailPart && this.state.selectedPart === part.id;
        feeler.position.copy(mesh.position);
      }
      const edge = this.foulingEdges.get(part.id);
      if (edge) {
        edge.visible = this.state.fouling?.part === part.id;
        if (edge.visible) edge.position.copy(mesh.position);
      }
    }
  }

  resize(): void {
    if (!this.renderer || !this.canvas || !this.host) return;
    const rect = this.host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setSize(Math.floor(rect.width), 420, false);
    this.renderer.setPixelRatio(dpr);
    this.camera.aspect = Math.max(0.5, rect.width / 420);
    this.camera.updateProjectionMatrix();
    this.render();
    this.callbacks.onAttributes();
  }

  private render(): void {
    if (!this.renderer) return;
    const { azimuthDeg, elevationDeg, zoom } = this.state;
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    const radius = 2.6 / zoom;
    const centre = new THREE.Vector3(0.7, 0.4, 0);
    this.camera.position.set(
      centre.x + radius * Math.cos(el) * Math.sin(az),
      centre.y + radius * Math.sin(el),
      centre.z + radius * Math.cos(el) * Math.cos(az),
    );
    this.camera.lookAt(centre);
    this.renderer.render(this.scene, this.camera);
  }

  // Projected screen point of a part's centre or leading edge.
  screenPoint(partId: string, lead: 'centre' | 'leading'): { x: number; y: number } | null {
    const mesh = this.meshes.get(partId);
    if (!mesh || !this.canvas) return null;
    const v = mesh.position.clone();
    if (lead === 'leading') {
      const part = this.parts.find((p) => p.id === partId);
      if (part?.axis === '-x') v.x -= 0.17;
      if (part?.axis === '+y') v.y += 0.09;
      if (part?.axis === '-y') v.y -= 0.09;
    }
    void this.rails;
    v.project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }

  dispose(): void {
    this.renderer?.dispose();
    this.renderer = null;
  }
}

// Story offsets are a pure function of progress: a part of stage n moves
// linearly while p × 6 goes from n − 1 to n, and holds its offset otherwise.
export function storyOffsetsFor(parts: ScenePart[], progress: number): Record<string, [number, number, number]> {
  const offsets: Record<string, [number, number, number]> = {};
  const p6 = progress * 6;
  for (const part of parts) {
    if (part.storyStage === null || !part.axis) continue;
    const n = part.storyStage;
    const frac = Math.max(0, Math.min(1, p6 - (n - 1)));
    const d = part.storyDistanceMm * frac;
    const sign = part.axis.startsWith('-') ? -1 : 1;
    const axis = part.axis[1] as 'x' | 'y' | 'z';
    const off: [number, number, number] = [0, 0, 0];
    if (axis === 'x') off[0] = sign * d;
    if (axis === 'y') off[1] = sign * d;
    if (axis === 'z') off[2] = sign * d;
    offsets[part.id] = off;
  }
  return offsets;
}
