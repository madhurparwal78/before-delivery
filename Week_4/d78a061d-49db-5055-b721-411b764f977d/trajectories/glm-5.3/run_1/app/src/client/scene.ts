import { el, t } from './ui.js';
import { store } from './store.js';

/**
 * The graphite-outline scene layer: a real 3D scene when WebGL is available,
 * and a still graphite drawing when it is not (DP-57, DP-60).
 */
export type SceneState = {
  renderer: 'webgl' | 'still';
  orbit: number;
  tilt: number;
  distance: number;
  gesture: 'none' | 'orbit' | 'zoom';
  turntable: 'on' | 'off';
  cameraFocus: 'none' | 'head' | 'torso' | 'arms' | 'legs' | 'material' | 'sockets';
  cameraMoving: boolean;
};

export type HeroData = {
  name: string;
  parts: Record<string, string>;
  proportions: Record<string, number>;
  pose: { right_arm_raise: number };
  material: string;
  accessories: Record<string, string>;
};

export type WeaponData = { strokes: { thickness: number; points: [number, number][] }[]; stats: { reach_m: number; weight_kg: number; swing_per_s: number } } | null;

export const materialColors: Record<string, string> = {
  graphite: '#242120', cobalt: '#1d4ed8', marker: '#f5b301', chalk: '#8a8a8a', brick: '#9a3412', moss: '#4d7c0f',
};

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** The stick figure's own geometry, shared by the 3D scene and the still drawing. */
export function stickFigurePoints(hero: HeroData, viewWidth: number, viewHeight: number): { draw: (ctx: CanvasRenderingContext2D) => void; handPx: { x: number; y: number } } {
  const p = hero.proportions;
  const cx = viewWidth / 2;
  const baseY = viewHeight * 0.78;
  const scale = Math.min(viewWidth, viewHeight) / 3.2;
  const headR = 28 * (p.head_size ?? 1);
  const neck = 18 * (p.neck_length ?? 1);
  const spine = 90 * (p.spine_length ?? 1);
  const upperArm = 42 * (p.upper_arm_length ?? 1);
  const forearm = 40 * (p.forearm_length ?? 1);
  const thigh = 46 * (p.thigh_length ?? 1);
  const shin = 44 * (p.shin_length ?? 1);
  const shoulderY = baseY - shin - thigh - spine;
  const neckY = shoulderY - neck;
  const headY = neckY - headR;
  const raise = hero.pose.right_arm_raise;
  // Right arm raise turns the arm around the shoulder's forward axis.
  const angleRight = Math.PI / 2 - raise;
  const rightHand = {
    x: cx + Math.cos(angleRight) * (upperArm + forearm),
    y: shoulderY - Math.sin(angleRight) * (upperArm + forearm),
  };
  const draw = (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    ctx.lineWidth = 6;
    ctx.strokeStyle = materialColors[hero.material] ?? materialColors.graphite ?? '#242120';
    ctx.lineCap = 'round';
    // legs
    ctx.beginPath();
    ctx.moveTo(cx, baseY - shin - thigh);
    ctx.lineTo(cx - 26, baseY);
    ctx.moveTo(cx, baseY - shin - thigh);
    ctx.lineTo(cx + 26, baseY);
    ctx.stroke();
    // spine
    ctx.beginPath();
    ctx.moveTo(cx, shoulderY);
    ctx.lineTo(cx, baseY - shin - thigh);
    ctx.stroke();
    // left arm hangs at the side
    ctx.beginPath();
    ctx.moveTo(cx, shoulderY);
    ctx.lineTo(cx - upperArm, shoulderY + forearm);
    ctx.stroke();
    // right arm follows the pose
    ctx.beginPath();
    ctx.moveTo(cx, shoulderY);
    ctx.lineTo(rightHand.x, rightHand.y);
    ctx.stroke();
    // head
    ctx.beginPath();
    if (hero.parts.head === 'square') {
      ctx.rect(cx - headR, headY - headR, headR * 2, headR * 2);
    } else if (hero.parts.head === 'triangle') {
      ctx.moveTo(cx, headY - headR);
      ctx.lineTo(cx + headR, headY + headR);
      ctx.lineTo(cx - headR, headY + headR);
      ctx.closePath();
    } else {
      ctx.arc(cx, headY, headR, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  };
  return { draw, handPx: rightHand };
}

export type SceneHandle = {
  element: HTMLElement;
  setHero(hero: HeroData, weapon?: WeaponData): void;
  setOrbit(angle: number): void;
  setTilt(angle: number): void;
  setDistance(distance: number): void;
  setTurntable(on: boolean): void;
  setCameraFocus(focus: SceneState['cameraFocus']): void;
  state(): SceneState;
  render(): void;
};

export function createHeroPreview(initialHero: HeroData, weapon: WeaponData, opts: { turntable?: boolean; reduced?: boolean; width?: number; height?: number } = {}): SceneHandle {
  const wrap = el('div', { class: 'scene-wrap', role: 'application', 'aria-label': t('controls', 'hero-preview'), tabindex: '0' });
  const canvas = el('canvas', { class: 'scene-canvas', width: '0', height: '0' }) as HTMLCanvasElement;
  wrap.append(canvas);
  const state: SceneState = {
    renderer: hasWebGL() ? 'webgl' : 'still',
    orbit: 0,
    tilt: 15,
    distance: 4.0,
    gesture: 'none',
    turntable: 'off',
    cameraFocus: 'none',
    cameraMoving: false,
  };
  let hero = initialHero;
  let equippedWeapon = weapon;
  let gl: WebGLRenderingContext | null = null;
  if (state.renderer === 'webgl') {
    gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) state.renderer = 'still';
  }
  if (state.renderer === 'still') {
    const notice = el('p', { class: 'no-webgl', text: t('copy', 'no-webgl') });
    wrap.classList.add('still');
    wrap.append(notice);
  }
  const sync = () => {
    wrap.setAttribute('data-renderer', state.renderer);
    wrap.setAttribute('data-orbit', String(Math.round(state.orbit)));
    wrap.setAttribute('data-tilt', String(Math.round(state.tilt)));
    wrap.setAttribute('data-distance', state.distance.toFixed(2));
    wrap.setAttribute('data-gesture', state.gesture);
    wrap.setAttribute('data-turntable', state.turntable);
    wrap.setAttribute('data-camera-focus', state.cameraFocus);
    wrap.setAttribute('data-camera-moving', String(state.cameraMoving));
  };
  const render = () => {
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    if (gl) {
      renderWebgl(gl, canvas.width, canvas.height, state, hero, equippedWeapon);
    } else {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);
        const figure = stickFigurePoints(hero, rect.width, rect.height);
        figure.draw(ctx);
        const hand = figure.handPx;
        wrap.setAttribute('data-hand-px', `${Math.round(hand.x)},${Math.round(hand.y)}`);
      }
    }
    sync();
  };
  const handle = {
    element: wrap,
    setHero(nextHero: HeroData, nextWeapon?: WeaponData) {
      hero = nextHero;
      if (nextWeapon !== undefined) equippedWeapon = nextWeapon;
      render();
    },
    setOrbit(angle: number) {
      state.orbit = ((angle % 360) + 360) % 360;
      render();
    },
    setTilt(angle: number) {
      state.tilt = Math.max(-10, Math.min(60, angle));
      render();
    },
    setDistance(distance: number) {
      state.distance = Math.max(2, Math.min(6, distance));
      render();
    },
    setTurntable(on: boolean) {
      state.turntable = on ? 'on' : 'off';
      render();
    },
    setCameraFocus(focus: SceneState['cameraFocus']) {
      state.cameraFocus = focus;
      render();
    },
    state: () => state,
    render,
  };
  // Opening values.
  state.orbit = 0;
  state.tilt = 15;
  state.distance = 4;
  sync();
  requestAnimationFrame(render);
  if (opts.turntable && !opts.reduced) {
    state.turntable = 'on';
    let last = performance.now();
    const loop = (now: number) => {
      if (state.turntable === 'on') {
        const dt = (now - last) / 1000;
        state.orbit = (state.orbit + dt * 11) % 360;
        render();
      }
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return handle;
}

function renderWebgl(gl: WebGLRenderingContext, width: number, height: number, state: SceneState, hero: HeroData, weapon: WeaponData): void {
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  // The hero is drawn as an outlined stick figure in world space.
  if (!renderWebgl.program) {
    const vs = `attribute vec3 aPos; uniform mat4 uMVP; void main(){ gl_Position = uMVP * vec4(aPos, 1.0); }`;
    const fs = `precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor = uColor; }`;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram();
    const vsShader = compile(gl.VERTEX_SHADER, vs);
    const fsShader = compile(gl.FRAGMENT_SHADER, fs);
    if (program && vsShader && fsShader) {
      gl.attachShader(program, vsShader);
      gl.attachShader(program, fsShader);
      gl.linkProgram(program);
      renderWebgl.program = program;
    }
  }
  const program = renderWebgl.program;
  if (!program) return;
  gl.useProgram(program);
  const mvpLocation = gl.getUniformLocation(program, 'uMVP');
  const colorLocation = gl.getUniformLocation(program, 'uColor');
  const positionLocation = gl.getAttribLocation(program, 'aPos');
  const aspect = width / Math.max(1, height);
  const tilt = (state.tilt * Math.PI) / 180;
  const orbit = (state.orbit * Math.PI) / 180;
  const cosO = Math.cos(orbit);
  const sinO = Math.sin(orbit);
  const eyeDist = state.distance;
  const fov = 0.9;
  const f = 1 / Math.tan(fov / 2);
  const near = 0.1;
  const far = 100;
  const projection = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const eyeX = sinO * Math.cos(tilt) * eyeDist;
  const eyeY = Math.sin(tilt) * eyeDist;
  const eyeZ = cosO * Math.cos(tilt) * eyeDist;
  const zAxis = normalize([-eyeX, -eyeY, -eyeZ]);
  const up = [0, 1, 0];
  const xAxis = normalize(cross(up, zAxis));
  const yAxis = cross(zAxis, xAxis);
  const view = [
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    -dot(xAxis, [eyeX, eyeY, eyeZ]), -dot(yAxis, [eyeX, eyeY, eyeZ]), -dot(zAxis, [eyeX, eyeY, eyeZ]), 1,
  ];
  const mvp = multiply(projection, view);
  gl.uniformMatrix4fv(mvpLocation, false, new Float32Array(mvp));
  const materialColor = materialColors[hero.material] ?? materialColors.graphite ?? '#242120';
  const rgb = hexToRgb(materialColor);
  gl.uniform4f(colorLocation, rgb[0], rgb[1], rgb[2], 1);
  const segments: number[][] = stickSegments(hero, weapon);
  for (const segment of segments) {
    const vertices = new Float32Array(segment);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, vertices.length / 3);
    gl.deleteBuffer(buffer);
  }
}

function stickSegments(hero: HeroData, weapon: WeaponData | null): number[][] {
  const p = hero.proportions;
  const segments: number[][] = [];
  const line = (a: [number, number, number], b: [number, number, number]) => {
    segments.push([...a, ...b]);
  };
  const thigh = 0.46 * (p.thigh_length ?? 1);
  const shin = 0.44 * (p.shin_length ?? 1);
  const spine = 0.9 * (p.spine_length ?? 1);
  const neck = 0.18 * (p.neck_length ?? 1);
  const head = 0.28 * (p.head_size ?? 1);
  const upperArm = 0.42 * (p.upper_arm_length ?? 1);
  const forearm = 0.4 * (p.forearm_length ?? 1);
  const hipY = thigh + shin;
  const shoulderY = hipY + spine;
  line([0, hipY, 0], [-0.26, hipY - thigh, 0]);
  line([-0.26, hipY - thigh, 0], [-0.3, 0, 0]);
  line([0, hipY, 0], [0.26, hipY - thigh, 0]);
  line([0.26, hipY - thigh, 0], [0.3, 0, 0]);
  line([0, hipY, 0], [0, shoulderY, 0]);
  line([0, shoulderY, 0], [-upperArm, shoulderY - forearm * 0.6, 0]);
  const raise = hero.pose.right_arm_raise;
  const angle = Math.PI / 2 - raise;
  const hand: [number, number, number] = [Math.cos(angle) * (upperArm + forearm), shoulderY + Math.sin(angle) * (upperArm + forearm), 0];
  line([0, shoulderY, 0], hand);
  line([0, shoulderY, 0], [0, shoulderY + neck, 0]);
  line([0, shoulderY + neck, 0], [0, shoulderY + neck + head, 0]);
  if (weapon) {
    const grip = weapon.strokes[0]?.points[0];
    if (grip) {
      line(hand, [hand[0] + grip[0] * 0.5, hand[1] + grip[1] * 0.5 + 0.4, hand[2]]);
    }
  }
  return segments;
}

function normalize(v: (number | undefined)[]): number[] {
  const x = v[0] ?? 0;
  const y = v[1] ?? 0;
  const z = v[2] ?? 0;
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function cross(a: (number | undefined)[], b: (number | undefined)[]): number[] {
  const a1 = a[1] ?? 0, a2 = a[2] ?? 0, a0 = a[0] ?? 0;
  const b1 = b[1] ?? 0, b2 = b[2] ?? 0, b0 = b[0] ?? 0;
  return [a1 * b2 - a2 * b1, a2 * b0 - a0 * b2, a0 * b1 - a1 * b0];
}

function dot(a: (number | undefined)[], b: (number | undefined)[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

function multiply(a: (number | undefined)[], b: (number | undefined)[]): number[] {
  const out = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + j] ?? 0) * (b[i * 4 + k] ?? 0);
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [parseInt(value.slice(0, 2), 16) / 255, parseInt(value.slice(2, 4), 16) / 255, parseInt(value.slice(4, 6), 16) / 255];
}

renderWebgl.program = null as WebGLProgram | null;
