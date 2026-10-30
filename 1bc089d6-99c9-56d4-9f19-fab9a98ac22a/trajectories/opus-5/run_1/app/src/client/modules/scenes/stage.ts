import * as THREE from 'three';

export interface SceneModule {
  readonly name: string;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Redraws the scene for a scroll position, and for elapsed seconds where it loops. */
  update(progress: number, elapsed: number): void;
}

export const mix = (from: number, to: number, at: number): number => from + (to - from) * at;

export function glowSprite(texture: THREE.Texture, size: number, colour: number): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: colour,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(size);
  return sprite;
}

/** A vertical gradient backdrop, built from a plane with coloured vertices. */
export function skyPlane(top: THREE.Color, bottom: THREE.Color, width = 300, height = 160): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(width, height, 1, 24);
  const colours = new Float32Array(geometry.attributes['position']!.count * 3);
  const position = geometry.attributes['position'] as THREE.BufferAttribute;
  const colour = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const at = (position.getY(i) + height / 2) / height;
    colour.copy(bottom).lerp(top, at);
    colours[i * 3] = colour.r;
    colours[i * 3 + 1] = colour.g;
    colours[i * 3 + 2] = colour.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: false }));
  mesh.renderOrder = -1;
  return mesh;
}

export function repaintSky(mesh: THREE.Mesh, top: THREE.Color, bottom: THREE.Color): void {
  const geometry = mesh.geometry as THREE.PlaneGeometry;
  const position = geometry.attributes['position'] as THREE.BufferAttribute;
  const colours = geometry.attributes['color'] as THREE.BufferAttribute;
  const height = geometry.parameters.height;
  const colour = new THREE.Color();
  for (let i = 0; i < position.count; i += 1) {
    const at = (position.getY(i) + height / 2) / height;
    colour.copy(bottom).lerp(top, at);
    colours.setXYZ(i, colour.r, colour.g, colour.b);
  }
  colours.needsUpdate = true;
}

const SLOW_FRAME_MILLIS = 26;

export class Stage {
  private readonly renderer: THREE.WebGLRenderer | null;
  private readonly modules = new Map<string, SceneModule>();
  private width = 1;
  private height = 1;
  private ratio = 1;
  private cost = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
      renderer.setClearColor(0x0b0914, 1);
    } catch {
      renderer = null;
    }
    this.renderer = renderer;
  }

  get usable(): boolean {
    return this.renderer !== null;
  }

  add(module: SceneModule): void {
    this.modules.set(module.name, module);
  }

  resize(): void {
    if (!this.renderer) return;
    this.ratio = Math.min(window.devicePixelRatio, 2);
    this.width = this.canvas.clientWidth || window.innerWidth;
    this.height = this.canvas.clientHeight || window.innerHeight;
    this.applySize();
    for (const module of this.modules.values()) {
      module.camera.aspect = this.width / this.height;
      module.camera.updateProjectionMatrix();
    }
  }

  private applySize(): void {
    this.renderer?.setPixelRatio(this.ratio);
    this.renderer?.setSize(this.width, this.height, false);
  }

  render(name: string, progress: number, elapsed: number): void {
    const module = this.modules.get(name);
    if (!this.renderer || !module) return;
    const started = performance.now();
    module.update(progress, elapsed);
    this.renderer.render(module.scene, module.camera);
    // Drawing never holds up the readouts: a slow canvas drops its own resolution.
    this.cost = this.cost * 0.7 + (performance.now() - started) * 0.3;
    if (this.cost > SLOW_FRAME_MILLIS && this.ratio > 0.5) {
      this.ratio = Math.max(0.5, this.ratio - 0.25);
      this.cost = 0;
      this.applySize();
    }
  }
}
