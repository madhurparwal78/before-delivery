/**
 * The venue grid stage: a bowed perspective plane of faint white grid lines
 * with plus markers at every second crossing, drifting dust, and one
 * electric-blue light field sweeping from the top edge down the right side.
 *
 * The scene is drawn analytically in a fragment shader, so the whole stage is
 * one full-bleed quad and nothing but the camera changes between routes.
 */

export type SceneMode = 'landing' | 'brief' | 'configurator' | 'working';
export type MotionMode = 'animated' | 'still' | 'fallback';
export type Silhouette = 'none' | 'camera-reactive-wall' | 'portrait-kiosk' | 'projection-room';

export interface StageState {
  scene: SceneMode;
  /** 0 to 4 on the landing; the camera glides between keyframes with scroll. */
  keyframe: number;
  keyframeProgress: number;
  roomWidthM: number | null;
  roomDepthM: number | null;
  silhouette: Silhouette;
  dust: number;
  /** Entrance fade of the grid and light field, 0 to 1. */
  entrance: number;
  pointerX: number;
  pointerY: number;
}

export const DEFAULT_STAGE: StageState = {
  scene: 'working',
  keyframe: 0,
  keyframeProgress: 0,
  roomWidthM: null,
  roomDepthM: null,
  silhouette: 'none',
  dust: 60,
  entrance: 1,
  pointerX: 0,
  pointerY: 0,
};

const VERTEX_SHADER = `#version 300 es
precision highp float;
const vec2 POSITIONS[4] = vec2[4](
  vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0)
);
void main() {
  gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uEntrance;
uniform float uLightScale;
uniform float uDust;
uniform vec3 uCameraPos;
uniform vec3 uCameraTarget;
uniform vec2 uRoom;
uniform float uSilhouette;
uniform float uGridSpeed;
uniform vec2 uPointer;

out vec4 outColor;

const vec3 GROUND = vec3(0.019, 0.027, 0.059);
const vec3 LINE = vec3(1.0);
const vec3 AURORA_CORE = vec3(0.184, 0.420, 1.0);
const vec3 AURORA_HOT = vec3(0.84, 0.92, 1.0);

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

/** Distance to the nearest line of a unit lattice, in cell units. */
float latticeLine(float coordinate, float width) {
  float edge = abs(fract(coordinate) - 0.5);
  return 1.0 - smoothstep(0.5 - width, 0.5, edge);
}

mat3 cameraBasis(vec3 eye, vec3 target) {
  vec3 forward = normalize(target - eye);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 up = cross(forward, right);
  return mat3(right, up, forward);
}

/** The footprint of the installation standing on the grid, in metres. */
vec2 silhouetteFootprint() {
  if (uSilhouette > 2.5) return vec2(1.0, 1.0);
  if (uSilhouette > 1.5) return vec2(1.2, 1.2);
  if (uSilhouette > 0.5) return vec2(4.0, 0.4);
  return vec2(0.0);
}

float silhouetteHeight() {
  if (uSilhouette > 2.5) return 2.6;
  if (uSilhouette > 1.5) return 2.1;
  if (uSilhouette > 0.5) return 3.2;
  return 0.0;
}

void main() {
  vec2 fragment = gl_FragCoord.xy;
  vec2 uv = (fragment - 0.5 * uResolution) / uResolution.y;
  vec2 screen = fragment / uResolution;

  vec3 eye = uCameraPos;
  vec3 target = uCameraTarget;
  // Pointer movement tilts the camera by a couple of degrees at most.
  target.x += uPointer.x * 0.12;
  target.y += uPointer.y * 0.08;

  mat3 basis = cameraBasis(eye, target);
  vec3 ray = normalize(basis * vec3(uv, 1.25));

  vec3 colour = GROUND;

  // The plane is bowed: it falls away gently with distance, so near cells are
  // large and shrink towards the far corner.
  float hit = -1.0;
  if (ray.y < -0.0015) {
    hit = eye.y / -ray.y;
  }

  if (hit > 0.0 && hit < 420.0) {
    vec3 point = eye + ray * hit;
    float bow = 0.0009 * dot(point.xz, point.xz);
    point.xz *= 1.0 / (1.0 + bow * 0.08);

    float drift = uTime * uGridSpeed;
    vec2 cell = vec2(point.x, point.z + drift * 0.35);

    float fade = exp(-hit * 0.021);
    float width = clamp(0.028 / max(fade, 0.06), 0.012, 0.42);

    float lines = max(latticeLine(cell.x, width), latticeLine(cell.y, width));

    // Plus markers at every second crossing.
    vec2 marker = abs(fract(cell * 0.5) - 0.5) * 2.0;
    vec2 toCrossing = abs(fract(cell + 0.5) - 0.5);
    float plusArm = 0.1;
    float plus =
      (1.0 - smoothstep(0.0, plusArm, toCrossing.x)) * (1.0 - smoothstep(0.0, plusArm * 0.34, toCrossing.y)) +
      (1.0 - smoothstep(0.0, plusArm * 0.34, toCrossing.x)) * (1.0 - smoothstep(0.0, plusArm, toCrossing.y));
    plus *= step(marker.x, 0.999) * step(marker.y, 0.999);

    float ink = clamp(lines * 0.21 + plus * 0.4, 0.0, 1.0) * fade;
    colour += LINE * ink * (0.55 + 0.45 * uEntrance);

    // The light field lights the grid lines beneath it.
    float lit = smoothstep(0.1, 1.0, screen.x) * smoothstep(-0.2, 1.0, screen.y);
    colour += AURORA_CORE * ink * lit * 0.85 * uLightScale;

    // The installation standing on the grid.
    vec2 footprint = silhouetteFootprint();
    if (footprint.x > 0.0) {
      vec2 centre = vec2(0.0, 0.0);
      vec2 local = abs(point.xz - centre);
      float inside = step(local.x, footprint.x * 0.5) * step(local.y, footprint.y * 0.5);
      colour = mix(colour, vec3(0.03, 0.05, 0.11), inside * 0.9);
      colour += AURORA_CORE * inside * 0.1;
    }
  }

  // The installation's standing body, drawn as an upright slab in view space.
  vec2 footprint = silhouetteFootprint();
  if (footprint.x > 0.0) {
    float height = silhouetteHeight();
    vec3 half3 = vec3(footprint.x * 0.5, height * 0.5, footprint.y * 0.5);
    vec3 centre = vec3(0.0, height * 0.5, 0.0);
    vec3 inverseRay = 1.0 / ray;
    vec3 t0 = (centre - half3 - eye) * inverseRay;
    vec3 t1 = (centre + half3 - eye) * inverseRay;
    vec3 near = min(t0, t1);
    vec3 far = max(t0, t1);
    float enter = max(max(near.x, near.y), near.z);
    float exit = min(min(far.x, far.y), far.z);
    if (exit > max(enter, 0.0)) {
      float shade = 0.5 + 0.5 * smoothstep(0.0, height, (eye + ray * enter).y);
      vec3 body = mix(vec3(0.035, 0.055, 0.12), AURORA_CORE * 0.55, shade * 0.6);
      float depthFade = exp(-enter * 0.012);
      colour = mix(colour, body, clamp(depthFade, 0.25, 1.0) * uEntrance);
    }
  }

  // Dust motes floating above the plane.
  float motes = 0.0;
  float count = clamp(uDust, 0.0, 260.0);
  for (int i = 0; i < 12; i++) {
    float layer = float(i);
    if (layer * 22.0 > count) break;
    vec2 grid = uv * (2.6 + layer * 0.5);
    vec2 id = floor(grid);
    vec2 local = fract(grid) - 0.5;
    float seed = hash21(id + layer * 17.3);
    float wobble = sin(uTime * 0.25 + seed * 6.28) * 0.12;
    float d = length(local - vec2(wobble, wobble * 0.6));
    float sparkle = step(0.86, seed) * (1.0 - smoothstep(0.0, 0.055, d));
    motes += sparkle * (0.25 + 0.75 * seed);
  }
  colour += vec3(0.78, 0.86, 1.0) * motes * 0.16 * uEntrance;

  // The light field: electric blue from the top edge down the right side,
  // brighter at its core and white-hot in the top-right corner.
  float rightSweep = smoothstep(0.08, 1.0, screen.x);
  float topSweep = smoothstep(-0.05, 0.95, screen.y);
  float field = pow(rightSweep * topSweep, 1.25);
  float core = pow(rightSweep, 2.4) * pow(topSweep, 2.0);
  colour += AURORA_CORE * field * 0.3 * uLightScale * uEntrance;
  colour += AURORA_HOT * core * 0.33 * uLightScale * uEntrance;

  // A dark diagonal wedge cuts in from the lower left.
  float wedge = smoothstep(0.55, -0.15, screen.x + screen.y);
  colour *= 1.0 - wedge * 0.78;

  colour = pow(clamp(colour, 0.0, 1.0), vec3(0.92));
  outColor = vec4(colour, 1.0);
}
`;

export interface CameraPose {
  eye: [number, number, number];
  target: [number, number, number];
}

/** The five published landing keyframes. */
export const LANDING_KEYFRAMES: readonly CameraPose[] = [
  { eye: [0, 7.5, -34], target: [0, 2.2, 0] },
  { eye: [0, 2.4, -14], target: [0, 1.9, 0] },
  { eye: [-13, 3.4, -9], target: [0, 1.8, 0] },
  { eye: [-1.4, 1.7, -3.4], target: [0, 1.7, 0] },
  { eye: [2, 11, -42], target: [0, 1.5, 0] },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  return {
    eye: [lerp(a.eye[0], b.eye[0], t), lerp(a.eye[1], b.eye[1], t), lerp(a.eye[2], b.eye[2], t)],
    target: [
      lerp(a.target[0], b.target[0], t),
      lerp(a.target[1], b.target[1], t),
      lerp(a.target[2], b.target[2], t),
    ],
  };
}

function poseFor(state: StageState): CameraPose {
  if (state.scene === 'landing') {
    const index = Math.max(0, Math.min(LANDING_KEYFRAMES.length - 1, state.keyframe));
    const next = Math.min(LANDING_KEYFRAMES.length - 1, index + 1);
    const from = LANDING_KEYFRAMES[index] ?? LANDING_KEYFRAMES[0]!;
    const to = LANDING_KEYFRAMES[next] ?? from;
    return lerpPose(from, to, state.keyframeProgress);
  }
  if (state.scene === 'configurator') {
    const depth = state.roomDepthM ?? 9;
    return { eye: [0, Math.max(7, depth * 0.9), -depth * 1.5], target: [0, 1.2, 0] };
  }
  if (state.scene === 'brief') {
    return { eye: [0, 4.6, -19], target: [0, 1.6, 0] };
  }
  return { eye: [0, 5.6, -24], target: [0, 1.4, 0] };
}

const SILHOUETTE_INDEX: Record<Silhouette, number> = {
  none: 0,
  'camera-reactive-wall': 1,
  'portrait-kiosk': 2,
  'projection-room': 3,
};

interface GlProgram {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(canvas: HTMLCanvasElement): GlProgram | null {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const names = [
    'uResolution', 'uTime', 'uEntrance', 'uLightScale', 'uDust',
    'uCameraPos', 'uCameraTarget', 'uRoom', 'uSilhouette', 'uGridSpeed', 'uPointer',
  ];
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const name of names) uniforms[name] = gl.getUniformLocation(program, name);
  return { gl, program, uniforms };
}

/** Working screens dim the light field to about two fifths and slow the grid. */
function lightScaleFor(scene: SceneMode): number {
  return scene === 'landing' || scene === 'brief' ? 1 : 0.4;
}

function gridSpeedFor(scene: SceneMode): number {
  return scene === 'landing' || scene === 'brief' ? 1 : 0.35;
}

export class StageRenderer {
  private readonly canvas: HTMLCanvasElement;
  private gl: GlProgram | null = null;
  private context2d: CanvasRenderingContext2D | null = null;
  private state: StageState = DEFAULT_STAGE;
  private frame = 0;
  private sceneTime = 0;
  private lastFrameAt = 0;
  /** Time of the last input, so the stage stops moving when nothing happens. */
  private lastInputAt = 0;
  private motion: MotionMode = 'animated';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = createProgram(canvas);
    if (!this.gl) {
      this.context2d = canvas.getContext('2d');
      this.motion = 'fallback';
    }
  }

  get motionMode(): MotionMode {
    return this.motion;
  }

  setReducedMotion(reduced: boolean): void {
    if (this.motion === 'fallback') return;
    this.motion = reduced ? 'still' : 'animated';
  }

  resize(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.requestDraw();
  }

  update(state: StageState): void {
    this.state = state;
    this.lastInputAt = performance.now();
    this.requestDraw();
  }

  /** Draw one frame, and keep drawing only while something is still moving. */
  private requestDraw(): void {
    if (this.motion !== 'animated') {
      this.drawOnce(0);
      return;
    }
    if (this.frame !== 0) return;
    this.lastFrameAt = performance.now();
    const step = (now: number): void => {
      const delta = Math.min(0.05, (now - this.lastFrameAt) / 1000);
      this.lastFrameAt = now;
      this.sceneTime += delta;
      this.drawOnce(this.sceneTime);
      // Within 2 seconds of the last input nothing on the stage moves.
      if (now - this.lastInputAt < 2_000) {
        this.frame = requestAnimationFrame(step);
      } else {
        this.frame = 0;
      }
    };
    this.frame = requestAnimationFrame(step);
  }

  private drawOnce(time: number): void {
    if (this.gl) {
      this.drawGl(time);
      return;
    }
    this.drawFallback();
  }

  private drawGl(time: number): void {
    const { gl, uniforms } = this.gl!;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const pose = poseFor(this.state);
    gl.uniform2f(uniforms['uResolution'] ?? null, this.canvas.width, this.canvas.height);
    gl.uniform1f(uniforms['uTime'] ?? null, this.motion === 'animated' ? time : 0);
    gl.uniform1f(uniforms['uEntrance'] ?? null, this.state.entrance);
    gl.uniform1f(uniforms['uLightScale'] ?? null, lightScaleFor(this.state.scene));
    gl.uniform1f(uniforms['uDust'] ?? null, this.state.dust);
    gl.uniform3f(uniforms['uCameraPos'] ?? null, pose.eye[0], pose.eye[1], pose.eye[2]);
    gl.uniform3f(
      uniforms['uCameraTarget'] ?? null,
      pose.target[0],
      pose.target[1],
      pose.target[2],
    );
    gl.uniform2f(
      uniforms['uRoom'] ?? null,
      this.state.roomWidthM ?? 12,
      this.state.roomDepthM ?? 9,
    );
    gl.uniform1f(uniforms['uSilhouette'] ?? null, SILHOUETTE_INDEX[this.state.silhouette]);
    gl.uniform1f(
      uniforms['uGridSpeed'] ?? null,
      this.motion === 'animated' ? gridSpeedFor(this.state.scene) : 0,
    );
    gl.uniform2f(uniforms['uPointer'] ?? null, this.state.pointerX, this.state.pointerY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Without WebGL the stage is a still frame of the same scene, carrying the
   * same ground, light field, grid and silhouette.
   */
  private drawFallback(): void {
    const context = this.context2d;
    if (!context) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    context.fillStyle = '#05070f';
    context.fillRect(0, 0, width, height);

    const horizon = height * 0.34;
    const light = context.createRadialGradient(
      width * 1.02,
      -height * 0.05,
      0,
      width * 1.02,
      -height * 0.05,
      Math.max(width, height) * 1.15,
    );
    const scale = lightScaleFor(this.state.scene);
    light.addColorStop(0, `rgba(214, 235, 255, ${0.5 * scale})`);
    light.addColorStop(0.35, `rgba(47, 107, 255, ${0.34 * scale})`);
    light.addColorStop(1, 'rgba(5, 7, 15, 0)');
    context.fillStyle = light;
    context.fillRect(0, 0, width, height);

    context.strokeStyle = 'rgba(255,255,255,0.17)';
    context.lineWidth = Math.max(1, width / 1400);
    for (let i = -14; i <= 14; i += 1) {
      context.beginPath();
      context.moveTo(width / 2 + i * (width / 14), height);
      context.lineTo(width / 2 + i * (width / 90), horizon);
      context.stroke();
    }
    for (let row = 1; row <= 20; row += 1) {
      const t = row / 20;
      const y = horizon + (height - horizon) * t * t;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    if (this.state.silhouette !== 'none') {
      const footprint =
        this.state.silhouette === 'camera-reactive-wall'
          ? [0.46, 0.2]
          : this.state.silhouette === 'portrait-kiosk'
            ? [0.1, 0.17]
            : [0.09, 0.22];
      const w = width * footprint[0]!;
      const h = height * footprint[1]!;
      context.fillStyle = 'rgba(12, 20, 44, 0.92)';
      context.strokeStyle = 'rgba(91,140,255,0.85)';
      context.fillRect(width / 2 - w / 2, height * 0.62 - h, w, h);
      context.strokeRect(width / 2 - w / 2, height * 0.62 - h, w, h);
    }

    context.fillStyle = 'rgba(2,3,8,0.78)';
    context.beginPath();
    context.moveTo(0, height);
    context.lineTo(0, height * 0.35);
    context.lineTo(width * 0.52, height);
    context.closePath();
    context.fill();
  }

  destroy(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
