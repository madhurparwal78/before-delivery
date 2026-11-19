import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { PANELS, frameCorners, worldPoint, type PanelDefinition, type Vec3 } from '../../shared/panels';
import { FIELD_OF_VIEW, panelOf, type StageFinding } from './camera';

const BASE = new Color(0.055, 0.047, 0.137);
const DEEP = new Color(0.16, 0.14, 0.42);
const INDIGO = new Color(0.27, 0.25, 0.66);
const PERIWINKLE = new Color(0.63, 0.65, 0.96);
const MAGENTA = new Color(0.78, 0.26, 0.72);
const FAR_BLUE = new Color(0.17, 0.42, 0.95);

const CELLS_U = 3;
const CELLS_V = 2;

const jitter = (seed: number): number => {
  const value = Math.sin(seed * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
};

const add = (a: Vec3, b: Vec3, scale = 1): Vec3 => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

const unit = (a: Vec3): Vec3 => {
  const size = length(a) || 1;
  return [a[0] / size, a[1] / size, a[2] / size];
};

/** The panel's outward normal, turned away from the car's middle. */
const outwardNormal = (panel: PanelDefinition): Vec3 => {
  const normal = unit(cross(panel.frame.u, panel.frame.v));
  const centre = worldPoint(panel, 0.5, 0.5);
  const outward: Vec3 = [centre[0], centre[1] - 0.6, centre[2] * 0.2];
  const dot = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2];
  return dot >= 0 ? normal : [-normal[0], -normal[1], -normal[2]];
};

/**
 * The planes shade from periwinkle through indigo, with a magenta bloom and saturated
 * blue at the far side, and dissolve down into the indigo base.
 */
const shadeAt = (point: Vec3): Color => {
  const height = Math.min(1, Math.max(0, (point[1] - 0.12) / 1.25));
  const colour = new Color();
  if (height < 0.52) colour.copy(BASE).lerp(DEEP, height / 0.52);
  else if (height < 0.78) colour.copy(DEEP).lerp(INDIGO, (height - 0.52) / 0.26);
  else colour.copy(INDIGO).lerp(PERIWINKLE, (height - 0.78) / 0.22);

  const bloom = Math.max(0, 1 - Math.hypot(point[0] + 0.3, point[2] + 1.1) / 2.1) * 0.42;
  colour.lerp(MAGENTA, bloom * height);
  const far = Math.max(0, Math.min(1, (point[0] - 0.1) / 1.1)) * 0.5;
  colour.lerp(FAR_BLUE, far * height);
  return colour;
};

interface Quad {
  readonly corners: readonly [Vec3, Vec3, Vec3, Vec3];
  readonly shadeSeed: number;
}

const panelQuads = (panel: PanelDefinition): Quad[] => {
  const normal = outwardNormal(panel);
  const quads: Quad[] = [];
  for (let i = 0; i < CELLS_U; i += 1) {
    for (let j = 0; j < CELLS_V; j += 1) {
      const seed = i * 7.3 + j * 3.1 + panel.id.length;
      const lift = (jitter(seed) - 0.5) * 0.045;
      const at = (u: number, v: number): Vec3 => add(worldPoint(panel, u, v), normal, lift);
      quads.push({
        corners: [
          at(i / CELLS_U, j / CELLS_V),
          at((i + 1) / CELLS_U, j / CELLS_V),
          at((i + 1) / CELLS_U, (j + 1) / CELLS_V),
          at(i / CELLS_U, (j + 1) / CELLS_V),
        ],
        shadeSeed: seed,
      });
    }
  }
  return quads;
};

const corner = (panelId: string, u: number, v: number): Vec3 => worldPoint(panelOf(panelId), u, v);

/** The facets that carry the body between the panels, so the planes read as one car. */
const bridgingQuads = (): Quad[] =>
  (
    [
      [corner('bonnet', 0, 1), corner('bonnet', 1, 1), corner('roof', 1, 0), corner('roof', 0, 0)],
      [corner('roof', 0, 1), corner('roof', 1, 1), corner('boot-lid', 0, 0), corner('boot-lid', 1, 0)],
      [corner('os-door', 0, 1), corner('os-door', 1, 1), corner('roof', 1, 1), corner('roof', 1, 0)],
      [corner('ns-door', 0, 1), corner('ns-door', 1, 1), corner('roof', 0, 0), corner('roof', 0, 1)],
      [
        corner('bonnet', 0, 0),
        corner('bonnet', 1, 0),
        corner('front-bumper', 1, 1),
        corner('front-bumper', 0, 1),
      ],
      [
        corner('boot-lid', 0, 1),
        corner('boot-lid', 1, 1),
        corner('rear-bumper', 1, 1),
        corner('rear-bumper', 0, 1),
      ],
      [
        corner('os-front-wing', 0, 1),
        corner('os-front-wing', 1, 1),
        corner('bonnet', 1, 1),
        corner('bonnet', 1, 0),
      ],
      [
        corner('ns-front-wing', 0, 1),
        corner('ns-front-wing', 1, 1),
        corner('bonnet', 0, 1),
        corner('bonnet', 0, 0),
      ],
      [
        corner('os-rear-quarter', 0, 1),
        corner('os-rear-quarter', 1, 1),
        corner('boot-lid', 0, 1),
        corner('boot-lid', 0, 0),
      ],
      [
        corner('ns-rear-quarter', 0, 1),
        corner('ns-rear-quarter', 1, 1),
        corner('boot-lid', 1, 1),
        corner('boot-lid', 1, 0),
      ],
    ] as const
  ).map((corners, index) => ({ corners: corners as unknown as readonly [Vec3, Vec3, Vec3, Vec3], shadeSeed: index * 5.7 }));

const quadsGeometry = (quads: readonly Quad[]): BufferGeometry => {
  const positions = new Float32Array(quads.length * 18);
  const colours = new Float32Array(quads.length * 18);
  let at = 0;

  for (const quad of quads) {
    const centre: Vec3 = [
      (quad.corners[0][0] + quad.corners[2][0]) / 2,
      (quad.corners[0][1] + quad.corners[2][1]) / 2,
      (quad.corners[0][2] + quad.corners[2][2]) / 2,
    ];
    const shade = shadeAt(centre);
    const facet = 0.84 + jitter(quad.shadeSeed) * 0.32;
    const red = Math.min(1, shade.r * facet);
    const green = Math.min(1, shade.g * facet);
    const blue = Math.min(1, shade.b * facet);

    for (const index of [0, 1, 2, 0, 2, 3]) {
      const point = quad.corners[index];
      positions[at] = point[0];
      positions[at + 1] = point[1];
      positions[at + 2] = point[2];
      colours[at] = red;
      colours[at + 1] = green;
      colours[at + 2] = blue;
      at += 3;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  return geometry;
};

const RIM_SEGMENTS = 28;

/**
 * A bright rim along the panel's four frame edges, brightest at each edge's midpoint
 * and falling away towards the corners, so the vertex of the lit planes is the
 * brightest point of the rim.
 */
const rimProfile = (t: number): number => 0.1 + 0.9 * Math.pow(Math.cos(Math.PI * (t - 0.5)), 20);

const rimGeometry = (panel: PanelDefinition, width: number): BufferGeometry => {
  const normal = outwardNormal(panel);
  const corners = frameCorners(panel);
  // Clear of the facet jitter, so the body never covers the rim.
  const lift = add([0, 0, 0], normal, 0.06);

  const positions: number[] = [];
  const colours: number[] = [];

  for (let edge = 0; edge < 4; edge += 1) {
    const from = corners[edge];
    const to = corners[(edge + 1) % 4];
    const along = unit(sub(to, from));
    const across = unit(cross(along, normal));
    const at = (t: number, side: number): Vec3 => {
      const base: Vec3 = [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
      ];
      return add(add(base, across, (width / 2) * side), lift, 1);
    };

    for (let step = 0; step < RIM_SEGMENTS; step += 1) {
      const t0 = step / RIM_SEGMENTS;
      const t1 = (step + 1) / RIM_SEGMENTS;
      const quad: readonly [Vec3, Vec3, Vec3, Vec3] = [at(t0, -1), at(t1, -1), at(t1, 1), at(t0, 1)];
      const weights = [rimProfile(t0), rimProfile(t1), rimProfile(t1), rimProfile(t0)];
      for (const index of [0, 1, 2, 0, 2, 3]) {
        positions.push(quad[index][0], quad[index][1], quad[index][2]);
        const weight = weights[index];
        colours.push(weight, weight, weight);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3));
  return geometry;
};

const ringTexture = (filled: boolean): CanvasTexture => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No 2D context for the marker texture');
  context.clearRect(0, 0, size, size);
  const middle = size / 2;

  context.beginPath();
  context.arc(middle, middle, size * 0.42, 0, Math.PI * 2);
  context.lineWidth = size * 0.13;
  context.strokeStyle = '#eaf0ff';
  context.stroke();

  context.beginPath();
  context.arc(middle, middle, size * 0.27, 0, Math.PI * 2);
  context.fillStyle = filled ? '#f3f7ff' : '#100d22';
  context.fill();

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
};

const glowTexture = (): CanvasTexture => {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No 2D context for the glow texture');
  const middle = size / 2;
  const gradient = context.createRadialGradient(middle, middle, 0, middle, middle, middle);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(236,240,255,0.98)');
  gradient.addColorStop(0.52, 'rgba(176,196,255,0.6)');
  gradient.addColorStop(0.76, 'rgba(126,96,220,0.2)');
  gradient.addColorStop(1, 'rgba(90,60,190,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
};

export interface MarkerState {
  finding: StageFinding;
  seen: boolean;
}

export interface RenderInput {
  camera: PerspectiveCamera;
  panelId: string;
  anchor: Vec3;
  rimGlow: number;
  markers: readonly MarkerState[];
  dimmed: boolean;
  cssHeight: number;
}

const DIM_FACTOR = 0.46;
/**
 * The additive vertex glow needs dimming harder than the body, because adding light
 * to a dark base saturates: a closed listing must bring the hero patch to at most 60%
 * of what it measured while live.
 */
const DIM_GLOW = 0.12;

/** The faceted car body, its rims, the vertex glow and the finding markers. */
export class StageScene {
  readonly scene = new Scene();
  private readonly body: Mesh;
  private readonly rims = new Map<string, { lit: Mesh; halo: Mesh }>();
  private readonly glow: Mesh;
  private readonly vertexRim: Mesh;
  private readonly markerMeshes = new Map<string, Mesh>();
  private readonly ring = ringTexture(false);
  private readonly ringFilled = ringTexture(true);

  constructor() {
    this.body = new Mesh(
      quadsGeometry([...PANELS.flatMap(panelQuads), ...bridgingQuads()]),
      new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }),
    );
    this.scene.add(this.body);

    for (const panel of PANELS) {
      const halo = new Mesh(
        rimGeometry(panel, 0.1),
        new MeshBasicMaterial({
          color: new Color(0.55, 0.62, 1),
          vertexColors: true,
          transparent: true,
          opacity: 0,
          blending: AdditiveBlending,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      halo.renderOrder = 6;
      const lit = new Mesh(
        rimGeometry(panel, 0.11),
        new MeshBasicMaterial({ color: new Color(0.12, 0.12, 0.12), vertexColors: true, side: DoubleSide }),
      );
      lit.renderOrder = 4;
      this.scene.add(halo, lit);
      this.rims.set(panel.id, { lit, halo });
    }

    this.glow = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: glowTexture(),
        transparent: true,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.glow.renderOrder = 6;
    this.scene.add(this.glow);

    this.vertexRim = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: glowTexture(),
        transparent: true,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        opacity: 0.55,
      }),
    );
    this.vertexRim.renderOrder = 5;
    this.scene.add(this.vertexRim);
  }

  private markerFor(state: MarkerState): Mesh {
    const existing = this.markerMeshes.get(state.finding.id);
    if (existing !== undefined) return existing;
    const mesh = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: this.ring, transparent: true, depthTest: false, depthWrite: false }),
    );
    mesh.renderOrder = 12;
    this.scene.add(mesh);
    this.markerMeshes.set(state.finding.id, mesh);
    return mesh;
  }

  /** The world size that covers a fixed number of CSS pixels at a point. */
  private screenScale(camera: PerspectiveCamera, point: Vector3, pixels: number, cssHeight: number): number {
    const distance = camera.position.distanceTo(point);
    const visibleHeight = 2 * distance * Math.tan(((FIELD_OF_VIEW / 2) * Math.PI) / 180);
    return (visibleHeight / Math.max(1, cssHeight)) * pixels;
  }

  apply(input: RenderInput): void {
    const dim = input.dimmed ? DIM_FACTOR : 1;
    (this.body.material as MeshBasicMaterial).color.setScalar(dim);

    for (const [panelId, rim] of this.rims) {
      const current = panelId === input.panelId;
      const litMaterial = rim.lit.material as MeshBasicMaterial;
      const haloMaterial = rim.halo.material as MeshBasicMaterial;
      const brightness = current ? 0.3 + 0.7 * input.rimGlow : 0.12;
      litMaterial.color.setRGB(brightness * dim, brightness * dim, brightness * dim);
      rim.lit.renderOrder = current ? 5 : 4;
      haloMaterial.opacity = current ? 0.5 * input.rimGlow * dim : 0;
      rim.lit.visible = true;
      rim.halo.visible = haloMaterial.opacity > 0;
    }

    const anchor = new Vector3(input.anchor[0], input.anchor[1], input.anchor[2]);
    // The vertex glow belongs to the resting vertex. It fades out as the panel rim
    // lights up, so the lit rim is the brightest thing on the canvas during a beat.
    const vertexWeight = 1 - input.rimGlow;
    const glowDim = input.dimmed ? DIM_GLOW : 1;
    const glowMaterial = this.glow.material as MeshBasicMaterial;
    glowMaterial.opacity = glowDim * vertexWeight;
    this.glow.position.copy(anchor);
    this.glow.quaternion.copy(input.camera.quaternion);
    this.glow.scale.setScalar(this.screenScale(input.camera, anchor, 108, input.cssHeight));

    const vertexMaterial = this.vertexRim.material as MeshBasicMaterial;
    vertexMaterial.opacity = 0.5 * glowDim * vertexWeight;
    this.vertexRim.position.copy(anchor);
    this.vertexRim.quaternion.copy(input.camera.quaternion);
    this.vertexRim.scale.setScalar(this.screenScale(input.camera, anchor, 190, input.cssHeight));

    const live = new Set<string>();
    for (const state of input.markers) {
      live.add(state.finding.id);
      const mesh = this.markerFor(state);
      const material = mesh.material as MeshBasicMaterial;
      material.map = state.seen ? this.ringFilled : this.ring;
      material.color.setScalar(dim);
      material.needsUpdate = true;
      const point = worldPoint(panelOf(state.finding.panelId), state.finding.u, state.finding.v);
      const position = new Vector3(point[0], point[1], point[2]);
      mesh.position.copy(position);
      mesh.quaternion.copy(input.camera.quaternion);
      mesh.scale.setScalar(this.screenScale(input.camera, position, 26, input.cssHeight));
      mesh.visible = true;
    }
    for (const [id, mesh] of this.markerMeshes) {
      if (!live.has(id)) mesh.visible = false;
    }
  }
}

export const makeRenderer = (canvas: HTMLCanvasElement): WebGLRenderer | null => {
  try {
    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    renderer.setClearColor(new Color(0.043, 0.035, 0.11), 1);
    return renderer;
  } catch {
    return null;
  }
};
