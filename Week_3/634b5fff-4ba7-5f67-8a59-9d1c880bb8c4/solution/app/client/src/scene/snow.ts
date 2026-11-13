import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import { seeded } from "./random.js";

/** Each flake crosses the viewport vertically in this many seconds, its own value in the range. */
const FLAKE_PERIOD_MIN = 8;
const FLAKE_PERIOD_MAX = 20;
const DEPTH_SPAN = 22;
const FADE_SPAN = DEPTH_SPAN - 5;

/** A whole number as a GLSL float literal. */
const glsl = (value: number): string => `${value}.0`;

const vertexShader = /* glsl */ `
  attribute float aU;
  attribute float aDepth;
  attribute float aPeriod;
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  uniform float uTravel;
  uniform vec2 uTan;
  uniform float uPixels;
  uniform vec3 uLight;
  uniform float uWarm;
  varying float vAlpha;
  varying float vWarm;
  void main() {
    float cycle = fract(uTime / aPeriod + aPhase);
    float v = 1.0 - 2.0 * cycle;
    float travelled = mod(aDepth - uTravel, ${glsl(DEPTH_SPAN)});
    float depth = travelled + 1.3;
    float u = aU + 0.03 * sin(uTime * 0.35 + aPhase * 6.2831) + 0.02 * sin(uTime * 0.9 + aDepth);
    vec3 view = vec3(u * depth * uTan.x, v * depth * uTan.y, -depth);
    gl_Position = projectionMatrix * vec4(view, 1.0);
    gl_PointSize = clamp(aSize * uPixels / depth, 1.0, 16.0);
    float edge = smoothstep(1.0, 0.86, abs(v)) * smoothstep(0.0, 2.0, travelled) * smoothstep(${glsl(DEPTH_SPAN)}, ${glsl(FADE_SPAN)}, travelled);
    vAlpha = edge * (0.45 + 0.55 * aSize);
    float near = distance(view, uLight);
    vWarm = uWarm * clamp(1.0 - near / 7.0, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uOpacity;
  varying float vAlpha;
  varying float vWarm;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float disc = 1.0 - smoothstep(0.35, 1.0, r);
    vec3 cold = vec3(0.72, 0.8, 0.95);
    vec3 warm = vec3(1.0, 0.82, 0.5);
    gl_FragColor = vec4(mix(cold, warm, vWarm), disc * vAlpha * uOpacity);
  }
`;

/** Time-driven snow: flake i falls through the viewport from top to bottom every `period` seconds. */
export class Snow {
  readonly object: Points;
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly time = { value: 0 };
  private readonly travel = { value: 0 };
  private readonly tan = { value: { x: 0.364, y: 0.364 } };
  private readonly pixels = { value: 600 };
  private readonly light = { value: new Vector3() };
  private readonly warm = { value: 0 };
  private readonly opacity = { value: 1 };

  constructor(count: number) {
    const rand = seeded(9);
    const u = new Float32Array(count);
    const depth = new Float32Array(count);
    const period = new Float32Array(count);
    const phase = new Float32Array(count);
    const size = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      u[i] = (rand() * 2 - 1) * 1.15;
      depth[i] = rand() * DEPTH_SPAN;
      period[i] = FLAKE_PERIOD_MIN + rand() * (FLAKE_PERIOD_MAX - FLAKE_PERIOD_MIN);
      phase[i] = rand();
      size[i] = 0.012 + rand() * rand() * 0.05;
    }
    this.geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
    this.geometry.setAttribute("aU", new Float32BufferAttribute(u, 1));
    this.geometry.setAttribute("aDepth", new Float32BufferAttribute(depth, 1));
    this.geometry.setAttribute("aPeriod", new Float32BufferAttribute(period, 1));
    this.geometry.setAttribute("aPhase", new Float32BufferAttribute(phase, 1));
    this.geometry.setAttribute("aSize", new Float32BufferAttribute(size, 1));
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: this.time,
        uTravel: this.travel,
        uTan: this.tan,
        uPixels: this.pixels,
        uLight: this.light,
        uWarm: this.warm,
        uOpacity: this.opacity,
      },
      transparent: true,
      depthWrite: false,
    });
    this.object = new Points(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 5;
  }

  /** `travelled` is the camera's distance along the path, so flakes rush past as the camera moves. */
  update(seconds: number, travelled: number, opacity: number, warm: number, light: Vector3): void {
    this.time.value = seconds;
    this.travel.value = travelled;
    this.opacity.value = opacity;
    this.warm.value = warm;
    this.light.value.copy(light);
    this.object.visible = opacity > 0;
  }

  setView(tanHalfX: number, tanHalfY: number, pixels: number): void {
    this.tan.value = { x: tanHalfX, y: tanHalfY };
    this.pixels.value = pixels;
  }
}
