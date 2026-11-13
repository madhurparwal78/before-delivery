// The venue stage in WebGL: a bowed perspective grid with plus markers, the aurora light field, dust,
// installation silhouettes and, on the landing, the camera-reactive wall. It renders on demand: only
// while an entrance, scroll, pointer or answer is settling, so nothing moves once input stops.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, PerspectiveCamera,
  PlaneGeometry, Points, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer,
} from "three";
import { clock } from "../lib/motion";
import { BOW, LIGHT, cellSize, targetPose, type Pose, type StageState } from "./state";
import { silhouetteBoxes, type Box } from "./silhouettes";

const LIGHT_FIELD = /* glsl */ `
float lightField(vec2 uv) {
  float top = smoothstep(0.86, 1.0, uv.y) * (0.45 + 0.55 * uv.x);
  float right = smoothstep(0.64, 1.0, uv.x) * (0.2 + 0.8 * uv.y);
  float sweep = right + 0.3 * smoothstep(0.58, 1.0, uv.x) * smoothstep(0.4, 1.0, uv.y);
  float wedge = smoothstep(0.66, 1.15, uv.x * 0.8 + uv.y * 0.72);
  return clamp(max(top, sweep * wedge), 0.0, 1.0);
}
float hotCorner(vec2 uv) {
  float d = distance(uv * vec2(1.0, 0.8), vec2(1.0, 0.8));
  return pow(clamp(1.0 - d * 2.6, 0.0, 1.0), 2.0);
}`;

const BACKGROUND_FRAG = /* glsl */ `
uniform vec2 uResolution; uniform float uLight; uniform float uFade;
${LIGHT_FIELD}
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float l = lightField(uv) * uLight * uFade;
  vec3 ground = vec3(0.012, 0.024, 0.059);
  vec3 col = mix(ground, mix(vec3(0.133, 0.443, 0.89), vec3(0.184, 0.482, 1.0), l), l * 0.92);
  col = mix(col, vec3(0.91, 0.933, 1.0), hotCorner(uv) * uLight * uFade);
  gl_FragColor = vec4(col, 1.0);
}`;

const GRID_VERT = /* glsl */ `
uniform float uBow; varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  w.y -= uBow * (w.x * w.x + w.z * w.z);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GRID_FRAG = /* glsl */ `
uniform vec2 uResolution; uniform float uLight; uniform float uFade; uniform float uCell;
uniform vec4 uRoom; uniform float uRoomOn; uniform vec3 uGlowPos; uniform float uGlow;
varying vec3 vWorld;
${LIGHT_FIELD}
void main() {
  vec2 p = vWorld.xz / uCell;
  vec2 fw = fwidth(p);
  vec2 g = abs(fract(p - 0.5) - 0.5) / fw;
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  vec2 cell = floor(p + 0.5);
  vec2 off = p - cell;
  float even = step(mod(cell.x, 2.0), 0.5) * step(mod(cell.y, 2.0), 0.5);
  float arm = 0.17;
  float plus = even * max(step(abs(off.y), fw.y * 1.4) * step(abs(off.x), arm), step(abs(off.x), fw.x * 1.4) * step(abs(off.y), arm));
  vec2 uv = gl_FragCoord.xy / uResolution;
  float lit = lightField(uv) * uLight;
  float fog = 1.0 - smoothstep(16.0, 44.0, length(vWorld.xz));
  vec2 q = vWorld.xz; vec2 c = (uRoom.xy + uRoom.zw) * 0.5; vec2 h = (uRoom.zw - uRoom.xy) * 0.5;
  vec2 d = abs(q - c) - h;
  float room = uRoomOn * (1.0 - smoothstep(0.0, max(fwidth(q).x, fwidth(q).y) * 1.8, abs(max(d.x, d.y))));
  float glow = uGlow * (1.0 - smoothstep(0.0, 6.0, distance(q, uGlowPos.xz)));
  float a = (line * (0.15 + 0.4 * lit + 0.35 * glow) + plus * (0.3 + 0.35 * lit) + room * 0.75) * fog * uFade;
  vec3 col = mix(vec3(1.0), vec3(0.66, 0.82, 1.0), max(lit, room * 0.6));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

const DUST_VERT = /* glsl */ `
attribute float aSize; uniform float uDrift; uniform float uScale; varying float vAlpha;
void main() {
  vec3 p = position + vec3(sin(position.z * 0.7 + uDrift) * 0.35, cos(position.x * 0.5 + uDrift * 0.8) * 0.18, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = aSize * uScale / max(1.0, -mv.z);
  vAlpha = clamp(0.25 + aSize * 0.08, 0.0, 0.7);
  gl_Position = projectionMatrix * mv;
}`;

const DUST_FRAG = /* glsl */ `
uniform float uFade; varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(0.86, 0.92, 1.0, vAlpha * uFade * (1.0 - smoothstep(0.15, 0.5, r)));
}`;

const WALL_VERT = /* glsl */ `
varying vec3 vPos; varying vec3 vNormal;
void main() { vPos = position; vNormal = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const WALL_FRAG = /* glsl */ `
uniform float uPhase; uniform float uFade; varying vec3 vPos; varying vec3 vNormal;
void main() {
  float face = step(0.5, vNormal.z);
  float b = 0.5 + 0.5 * sin(vPos.y * 5.2 + vPos.x * 0.9 + uPhase);
  float band = smoothstep(0.55, 1.0, b) * face;
  float ripple = 0.5 + 0.5 * sin(length(vPos.xy - vec2(0.6, 0.4)) * 6.0 - uPhase * 1.4);
  vec3 base = vec3(0.03, 0.07, 0.15);
  vec3 tide = mix(vec3(0.133, 0.443, 0.89), vec3(0.66, 0.9, 1.0), ripple * 0.5);
  vec3 col = mix(base, tide, band * 0.62) * uFade;
  gl_FragColor = vec4(min(col, vec3(0.42, 0.58, 0.8)), 1.0);
}`;

const MAX_DUST = 220;
const BOX_EDGES = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });

function edges(box: Box): LineSegments {
  const lines = new LineSegments(new EdgesGeometry(new BoxGeometry(box.size[0], box.size[1], box.size[2])), BOX_EDGES);
  lines.position.set(box.at[0], box.at[1], box.at[2]);
  return lines;
}

export class WebGLStage {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(38, 1, 0.1, 200);
  private readonly background: ShaderMaterial;
  private readonly grid: ShaderMaterial;
  private readonly dust: ShaderMaterial;
  private readonly dustGeometry = new BufferGeometry();
  private readonly wallMaterial: ShaderMaterial;
  private readonly wall = new Group();
  private readonly silhouette = new Group();
  private state: StageState | null = null;
  private reduced = false;
  private pose: Pose | null = null;
  private light = 0;
  private fadeFrom = 0;
  private dropFrom = 0;
  private driftUntil = 0;
  private drift = 0;
  private tilt = new Vector2();
  private tiltTarget = new Vector2();
  private last = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement, context: WebGL2RenderingContext) {
    this.renderer = new WebGLRenderer({ canvas, context, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const resolution = { value: new Vector2(1, 1) };
    const common = { uResolution: resolution, uLight: { value: 0 }, uFade: { value: 0 } };
    this.background = new ShaderMaterial({
      uniforms: common, fragmentShader: BACKGROUND_FRAG, depthWrite: false, depthTest: false,
      vertexShader: "void main() { gl_Position = vec4(position.xy, 0.999, 1.0); }",
    });
    const backdrop = new Mesh(new PlaneGeometry(2, 2), this.background);
    backdrop.frustumCulled = false;
    backdrop.renderOrder = -10;
    this.scene.add(backdrop);

    this.grid = new ShaderMaterial({
      uniforms: { ...common, uBow: { value: BOW }, uCell: { value: 2 }, uRoom: { value: [0, 0, 0, 0] }, uRoomOn: { value: 0 }, uGlowPos: { value: new Vector3(0, 0, 0.6) }, uGlow: { value: 0 } },
      vertexShader: GRID_VERT, fragmentShader: GRID_FRAG, transparent: true, depthWrite: false,
    });
    const plane = new Mesh(new PlaneGeometry(90, 90, 180, 180), this.grid);
    plane.rotation.x = -Math.PI / 2;
    this.scene.add(plane);

    const positions = new Float32Array(MAX_DUST * 3);
    const sizes = new Float32Array(MAX_DUST);
    let seed = 7;
    const random = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < MAX_DUST; i++) {
      positions.set([(random() - 0.5) * 26, 0.3 + random() * 4.2, (random() - 0.7) * 24], i * 3);
      sizes[i] = 2 + random() * 6;
    }
    this.dustGeometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.dustGeometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
    this.dust = new ShaderMaterial({
      uniforms: { uDrift: { value: 0 }, uScale: { value: 40 }, uFade: common.uFade },
      vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false,
    });
    this.scene.add(new Points(this.dustGeometry, this.dust));

    this.wallMaterial = new ShaderMaterial({ uniforms: { uPhase: { value: 0 }, uFade: common.uFade }, vertexShader: WALL_VERT, fragmentShader: WALL_FRAG });
    const panel = new Mesh(new BoxGeometry(4, 2.6, 0.4), this.wallMaterial);
    panel.position.set(0, 1.3, 0);
    this.wall.add(panel, edges({ size: [4, 2.6, 0.4], at: [0, 1.3, 0] }));
    this.scene.add(this.wall, this.silhouette);

    this.fadeFrom = clock();
    addEventListener("resize", () => (this.reduced ? this.frame() : this.kick()));
    addEventListener("pointermove", (event) => {
      if (this.state?.scene !== "landing" || this.reduced) return;
      const degree = Math.PI / 180;
      this.tiltTarget.set((event.clientX / innerWidth - 0.5) * 2 * degree, (event.clientY / innerHeight - 0.5) * 2 * degree);
      this.kick();
    });
  }

  update(next: StageState, reduced: boolean): void {
    const previous = this.state;
    this.state = next;
    this.reduced = reduced;
    if (previous?.silhouette !== next.silhouette) {
      this.silhouette.clear();
      for (const box of silhouetteBoxes(next.silhouette)) this.silhouette.add(edges(box));
      this.dropFrom = clock();
    }
    if (previous && (previous.roomW !== next.roomW || previous.dust !== next.dust || previous.scene !== next.scene)) this.driftUntil = clock() + 1.2;
    if (previous && previous.scene !== next.scene && next.scene === "brief") this.fadeFrom = clock();
    this.wall.visible = next.scene === "landing";
    this.dustGeometry.setDrawRange(0, Math.min(MAX_DUST, next.dust));
    if (reduced) this.frame();
    else this.kick();
  }

  private kick(): void {
    if (!this.raf) {
      this.last = clock();
      this.raf = requestAnimationFrame(() => this.frame());
    }
  }

  private frame(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const s = this.state;
    if (!s) return;
    const now = clock();
    const dt = Math.min(0.1, Math.max(0, now - this.last));
    this.last = now;
    const width = innerWidth;
    const height = innerHeight;
    this.renderer.setSize(width, height, false);
    const buffer = this.renderer.getDrawingBufferSize(new Vector2());
    (this.background.uniforms.uResolution.value as Vector2).copy(buffer);
    this.camera.aspect = width / height;
    this.camera.fov = width < 768 ? 52 : 38;
    this.camera.updateProjectionMatrix();

    const target = targetPose(s, width / height);
    const follow = this.reduced ? 1 : 1 - Math.exp(-dt / 0.16);
    let moving = false;
    if (!this.pose) this.pose = { position: [...target.position], target: [...target.target], roll: target.roll };
    const pose: Pose = this.pose;
    for (const key of ["position", "target"] as const) {
      for (let i = 0; i < 3; i++) {
        const gap = target[key][i] - pose[key][i];
        pose[key][i] = Math.abs(gap) < 1e-4 ? target[key][i] : pose[key][i] + gap * follow;
        if (pose[key][i] !== target[key][i]) moving = true;
      }
    }
    pose.roll = Math.abs(target.roll - pose.roll) < 1e-5 ? target.roll : pose.roll + (target.roll - pose.roll) * follow;
    const tiltFollow = this.reduced ? 1 : 1 - Math.exp(-dt / 0.1);
    for (const axis of ["x", "y"] as const) {
      const gap = this.tiltTarget[axis] - this.tilt[axis];
      this.tilt[axis] = Math.abs(gap) < 1e-5 ? this.tiltTarget[axis] : this.tilt[axis] + gap * tiltFollow;
      if (this.tilt[axis] !== this.tiltTarget[axis]) moving = true;
    }
    this.camera.position.set(...pose.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(new Vector3(...pose.target));
    this.camera.rotateZ(pose.roll);
    this.camera.rotateY(-this.tilt.x);
    this.camera.rotateX(-this.tilt.y);

    const fade = this.reduced ? 1 : Math.min(1, (now - this.fadeFrom) / 1.6);
    const eased = 1 - (1 - fade) ** 3;
    const lightTarget = LIGHT[s.scene];
    this.light = this.reduced || Math.abs(lightTarget - this.light) < 1e-3 ? lightTarget : this.light + (lightTarget - this.light) * (1 - Math.exp(-dt / 0.2));
    this.background.uniforms.uLight.value = this.light;
    this.background.uniforms.uFade.value = eased;
    this.grid.uniforms.uCell.value = cellSize(s);
    const w = s.roomW ?? 0;
    const d = s.roomD ?? 0;
    this.grid.uniforms.uRoom.value = [-w / 2, -d / 2, w / 2, d / 2];
    this.grid.uniforms.uRoomOn.value = s.roomW && s.scene === "brief" ? 1 : 0;
    this.grid.uniforms.uGlow.value = s.scene === "landing" ? 1 : 0;

    const dropT = this.reduced ? 1 : Math.min(1, (now - this.dropFrom) / 0.6);
    this.silhouette.position.y = this.reduced ? 0 : 2.6 * Math.exp(-6 * dropT) * Math.cos(9 * dropT) * (1 - dropT);
    this.silhouette.visible = s.scene === "brief";
    if (now < this.driftUntil && !this.reduced) this.drift += dt * (s.scene === "brief" || s.scene === "landing" ? 0.8 : 0.3);
    this.dust.uniforms.uDrift.value = this.drift;
    this.dust.uniforms.uScale.value = buffer.y / 20;
    this.wallMaterial.uniforms.uPhase.value = s.scroll * 2.4 + this.tilt.x * 40;

    this.renderer.render(this.scene, this.camera);
    if (!this.reduced && (moving || fade < 1 || dropT < 1 || now < this.driftUntil || this.light !== lightTarget)) this.kick();
  }
}
