import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  type Vector3Like,
} from "three";
import { seeded } from "./random.js";

export const FLAME = 0;
export const GLOW = 1;

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aKind;
  attribute float aAlpha;
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixels;
  varying float vKind;
  varying float vAlpha;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    float flicker = 1.0 + 0.11 * sin(uTime * 21.0 + aSeed * 40.0) + 0.07 * sin(uTime * 34.0 + aSeed * 13.0) + 0.05 * sin(uTime * 8.0 + aSeed * 7.0);
    float size = aKind > 0.5 ? aSize : aSize * flicker;
    gl_PointSize = clamp(size * uPixels / max(-view.z, 0.05), 0.0, 220.0);
    gl_Position = projectionMatrix * view;
    vKind = aKind;
    vAlpha = aAlpha;
  }
`;

const fragmentShader = /* glsl */ `
  varying float vKind;
  varying float vAlpha;
  void main() {
    vec2 uv = (gl_PointCoord - 0.5) * 2.0;
    float t = 1.0 - gl_PointCoord.y;
    float radius = length(uv);
    vec3 colour;
    float alpha;
    if (vKind > 0.5) {
      float halo = exp(-radius * radius * 5.0);
      colour = mix(vec3(1.0, 0.78, 0.38), vec3(1.0, 0.97, 0.86), halo);
      alpha = halo * (1.0 - smoothstep(0.85, 1.0, radius));
    } else {
      float width = 0.5 * sin(3.14159 * pow(clamp(t, 0.0, 1.0), 0.8)) * (1.0 - 0.28 * t);
      float body = 1.0 - smoothstep(width * 0.75, width + 0.02, abs(uv.x));
      body *= smoothstep(0.02, 0.2, t) * (1.0 - smoothstep(0.86, 1.0, t));
      float core = exp(-(uv.x * uv.x) * 14.0) * smoothstep(0.0, 0.45, t) * (1.0 - smoothstep(0.35, 0.8, t));
      float halo = exp(-radius * radius * 3.4) * 0.35;
      vec3 outer = mix(vec3(0.88, 0.34, 0.17), vec3(0.95, 0.78, 0.25), smoothstep(0.1, 0.5, t));
      colour = mix(outer, vec3(1.0, 0.96, 0.78), core);
      alpha = clamp(body + halo, 0.0, 1.0);
    }
    float fade = vAlpha * (1.0 - step(0.999, radius));
    gl_FragColor = vec4(colour * alpha * fade, alpha * fade);
  }
`;

/** Every visible flame and glow of the scene in one draw call: points drawn as flame teardrops or soft halos. */
export class FlamePoints {
  readonly object: Points;
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly kinds: Float32Array;
  private readonly alphas: Float32Array;
  private readonly time = { value: 0 };
  private readonly pixels = { value: 600 };

  constructor(capacity: number) {
    const rand = seeded(77);
    this.positions = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.kinds = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    const seeds = new Float32Array(capacity);
    for (let i = 0; i < capacity; i += 1) seeds[i] = rand();
    this.geometry.setAttribute("position", new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute("aSize", new BufferAttribute(this.sizes, 1).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute("aKind", new BufferAttribute(this.kinds, 1).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute("aAlpha", new BufferAttribute(this.alphas, 1).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute("aSeed", new Float32BufferAttribute(seeds, 1));
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uTime: this.time, uPixels: this.pixels },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.object = new Points(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 10;
  }

  /** Puts a flame (or a halo) in a slot; a size of 0 or an alpha of 0 hides it. */
  set(slot: number, at: Vector3Like, size: number, alpha: number, kind: number = FLAME): void {
    this.positions[slot * 3] = at.x;
    this.positions[slot * 3 + 1] = at.y;
    this.positions[slot * 3 + 2] = at.z;
    this.sizes[slot] = size;
    this.alphas[slot] = alpha;
    this.kinds[slot] = kind;
  }

  hide(slot: number): void {
    this.alphas[slot] = 0;
    this.sizes[slot] = 0;
  }

  /** Uploads the slots changed since the last call. */
  commit(): void {
    for (const name of ["position", "aSize", "aKind", "aAlpha"]) {
      const attribute = this.geometry.getAttribute(name);
      attribute.needsUpdate = true;
    }
  }

  setTime(seconds: number): void {
    this.time.value = seconds;
  }

  /** `pixels` is the viewport height in pixels over twice the tangent of half the field of view. */
  setPixels(pixels: number): void {
    this.pixels.value = pixels;
  }
}
