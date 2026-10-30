import type { Programme, Session } from "./api.js";

export interface LatticeModel {
  days: Array<{ id: string; label: string }>;
  venues: Array<{ id: string; name: string }>;
  disciplines: Array<{ id: string; name: string }>;
  sessions: Array<{ session: Session; x: number; z: number; w: number }>;
}

// The lattice is drawn from live programme data: day slabs stacked in depth,
// one pillar per venue through them, one bar per published session.
export function buildModel(programme: Programme): LatticeModel {
  const days = programme.festival_days.map((d) => ({ id: d.date, label: d.label }));
  const venues = programme.venues;
  const sessions = programme.sessions
    .filter((s) => s.status === "published" || s.status === "cancelled")
    .map((s) => {
      const dayIndex = Math.max(0, days.findIndex((d) => d.id === s.festival_day));
      const venueIndex = Math.max(0, venues.findIndex((v) => v.id === s.venue_id));
      const day = programme.festival_days[dayIndex];
      const startMs = new Date(day.starts_at).getTime();
      const endMs = new Date(day.ends_at).getTime();
      const t0 = (new Date(s.starts_at).getTime() - startMs) / (endMs - startMs);
      const t1 = (new Date(s.ends_at).getTime() - startMs) / (endMs - startMs);
      return {
        session: s,
        x: venueIndex / Math.max(1, venues.length - 1),
        z: dayIndex / Math.max(1, days.length - 1),
        w: Math.max(0.04, t1 - t0),
      };
    });
  return { days, venues, disciplines: programme.disciplines, sessions };
}

export const DISCIPLINE_COLOURS: Record<string, [number, number, number]> = {
  sound: [0.85, 0.95, 0.23],
  light: [0.89, 0.24, 0.12],
  performance: [0.11, 0.17, 0.56],
  "moving-image": [0.96, 0.94, 0.89],
  code: [0.85, 0.95, 0.23],
};

function rgb(colour: [number, number, number]): string {
  return `rgb(${Math.round(colour[0] * 255)}, ${Math.round(colour[1] * 255)}, ${Math.round(colour[2] * 255)})`;
}

export interface LatticeState {
  raised: string[];
  lit: string[];
  seams: string[];
}

// The static isometric drawing of the same lattice, for reduced motion or no WebGL.
export function drawStaticSvg(model: LatticeModel, state: LatticeState): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const W = 900;
  const H = 506;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Programme lattice (static)");
  const padX = 120;
  const padY = 70;
  const iso = (x: number, z: number, y: number): [number, number] => {
    const px = padX + x * (W - padX * 2) + z * 60;
    const py = H - padY - z * (H - padY * 2) * 0.7 - y * 120;
    return [px, py];
  };
  model.days.forEach((day, z) => {
    const t = z / Math.max(1, model.days.length - 1);
    const [x0, y0] = iso(0, t, 0);
    const [x1, y1] = iso(1, t, 0);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    rect.setAttribute("points", `${x0},${y0} ${x1},${y1 - 40} ${x1 + 30},${y1 - 20} ${x0 + 30},${y0 + 20}`);
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "#d8f23a");
    rect.setAttribute("stroke-width", "1.5");
    svg.append(rect);
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const [lx, ly] = iso(0, t, 0.9);
    label.setAttribute("x", String(lx));
    label.setAttribute("y", String(ly));
    label.setAttribute("fill", "#d8f23a");
    label.setAttribute("font-size", "16");
    label.textContent = day.label;
    svg.append(label);
  });
  model.venues.forEach((v, i) => {
    const x = i / Math.max(1, model.venues.length - 1);
    const [bx, by] = iso(x, 0, 1.2);
    const [tx, ty] = iso(x, 1, 1.2);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(bx));
    line.setAttribute("y1", String(by));
    line.setAttribute("x2", String(tx));
    line.setAttribute("y2", String(ty));
    line.setAttribute("stroke", "#f4efe4");
    line.setAttribute("stroke-width", "1");
    svg.append(line);
    void v;
  });
  for (const bar of model.sessions) {
    const colour = DISCIPLINE_COLOURS[bar.session.discipline] ?? [0.85, 0.95, 0.23];
    const lit = state.lit.includes(bar.session.id);
    const cancelled = bar.session.status === "cancelled";
    const [x0, y0] = iso(bar.x, bar.z, 0.1);
    const [x1, y1] = iso(bar.x + 0.12, bar.z, 0.1);
    const box = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    const h = 26 * Math.max(0.2, bar.w);
    box.setAttribute("points", `${x0},${y0} ${x1},${y1 - 10} ${x1},${y1 - 10 - h} ${x0},${y0 - h}`);
    box.setAttribute("fill", cancelled ? "none" : rgb(colour));
    box.setAttribute("stroke", cancelled ? "#e33d1f" : rgb(colour));
    box.setAttribute("stroke-width", "1.5");
    box.setAttribute("opacity", lit ? "1" : "0.75");
    svg.append(box);
  }
  svg.setAttribute("data-raised", state.raised.join(","));
  svg.setAttribute("data-lit", state.lit.join(","));
  svg.setAttribute("data-seams", state.seams.join(","));
  return svg;
}

export interface LatticeCallbacks {
  onSelect: (kind: "day" | "venue" | "discipline", id: string) => void;
}

export interface LatticeView {
  figure: HTMLElement;
  setState: (state: LatticeState) => void;
  destroy: () => void;
}

const FRAGMENT = `
precision mediump float;
varying vec4 v_colour;
void main() { gl_FragColor = v_colour; }
`;

const VERTEX = `
attribute vec3 a_pos;
attribute vec4 a_colour;
uniform mat4 u_mvp;
varying vec4 v_colour;
void main() {
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  v_colour = a_colour;
}
`;

function mat4mul(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + j] * b[i * 4 + k];
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

function perspective(fov: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan(fov / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}

function lookAt(eye: number[], centre: number[], up: number[]): number[] {
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a: number[]) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const z = norm(sub(eye, centre));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ];
}

interface Bar {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  colour: [number, number, number];
  cancelled: boolean;
  id: string;
}

// The moving lattice: opening camera move, pointer tilt, scroll flight and
// selection raise, all drawn from programme data by real WebGL.
export function createLattice(model: LatticeModel, callbacks: LatticeCallbacks, reducedMotion: boolean): LatticeView | null {
  const figure = document.createElement("figure");
  figure.setAttribute("role", "figure");
  figure.setAttribute("aria-label", "Programme lattice");

  const bars: Bar[] = model.sessions.map((b) => ({
    x: b.x,
    y: 0.1,
    z: b.z,
    w: 0.045,
    h: Math.max(0.2, b.w) * 1.4,
    colour: DISCIPLINE_COLOURS[b.session.discipline] ?? [0.85, 0.95, 0.23],
    cancelled: b.session.status === "cancelled",
    id: b.session.id,
  }));

  const state: LatticeState = { raised: [], lit: [], seams: [] };
  if (reducedMotion) return null;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("tabindex", "-1");
  figure.append(canvas);
  const gl = canvas.getContext("webgl", { antialias: true });
  if (!gl) return null;

  const compile = (type: number, src: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      return null;
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.useProgram(program);
  const posLoc = gl.getAttribLocation(program, "a_pos");
  const colLoc = gl.getAttribLocation(program, "a_colour");
  const mvpLoc = gl.getUniformLocation(program, "u_mvp");

  // One interleaved buffer of cubes: day slabs, venue pillars and session bars.
  interface Cube { x: number; y: number; z: number; w: number; h: number; d: number; colour: [number, number, number]; outlineOnly?: boolean; id?: string; kind?: "day" | "venue" | "discipline" | "session"; }
  const cubes: Cube[] = [];
  model.days.forEach((d, i) => {
    const z = i / Math.max(1, model.days.length - 1);
    cubes.push({ x: 0.5, y: 0, z, w: 1.35, h: 0.02, d: 0.14, colour: [0.09, 0.08, 0.07], id: d.id, kind: "day" });
  });
  model.venues.forEach((v, i) => {
    const x = i / Math.max(1, model.venues.length - 1);
    cubes.push({ x, y: 0.9, z: 0.5, w: 0.02, h: 1.8, d: 1.0, colour: [0.2, 0.2, 0.2], id: v.id, kind: "venue" });
  });
  model.disciplines.forEach((d, i) => {
    const x = 1.05 + i * 0.06;
    cubes.push({ x, y: 0.05, z: -0.08, w: 0.03, h: 0.03, d: 0.03, colour: DISCIPLINE_COLOURS[d.id] ?? [0.9, 0.9, 0.9], id: d.id, kind: "discipline" });
  });
  for (const b of bars) {
    cubes.push({ x: b.x, y: b.y + b.h / 2, z: b.z, w: b.w, h: b.h, d: 0.05, colour: b.colour, outlineOnly: b.cancelled, id: b.id, kind: "session" });
  }

  const verts: number[] = [];
  const faces = [
    [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]],
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
    [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
    [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
  ];
  for (const cube of cubes) {
    for (const face of faces) {
      for (const p of face) {
        verts.push(
          cube.x + (p[0] * cube.w) / 2,
          cube.y + (p[1] * cube.h) / 2,
          cube.z + (p[2] * cube.d) / 2,
          cube.colour[0], cube.colour[1], cube.colour[2],
          1,
        );
      }
    }
  }
  const vertexData = new Float32Array(verts);
  const glBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
  const indexData: number[] = [];
  let vbase = 0;
  for (const cube of cubes) {
    for (const quad of [0, 1, 2, 3, 0, 2, 4, 5, 6, 7, 4, 6, 8, 9, 10, 11, 8, 10, 12, 13, 14, 15, 12, 14, 16, 17, 18, 19, 16, 18, 20, 21, 22, 23, 20, 22]) {
      indexData.push(vbase + quad);
    }
    vbase += 24;
  }
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indexData), gl.STATIC_DRAW);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // Camera state: opening move over 1.4s, then scroll-linked flight.
  const bootTime = performance.now();
  let yaw = 0;
  let pitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let scrollProgress = 0;
  let raise = 0;
  let raiseTarget = 0;

  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    targetYaw = (nx - 0.5) * 16;
    targetPitch = (0.5 - ny) * 10;
  });
  canvas.addEventListener("pointerleave", () => {
    targetYaw = 0;
    targetPitch = 0;
  });
  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    // Slabs cover the depth axis; pillars the width; swatches the far edge.
    if (nx > 0.78) {
      const idx = Math.min(model.disciplines.length - 1, Math.max(0, Math.floor((nx - 0.8) / 0.033)));
      callbacks.onSelect("discipline", model.disciplines[idx].id);
    } else if (ny > 0.62) {
      const idx = Math.min(model.days.length - 1, Math.max(0, Math.floor((1 - ny) * model.days.length * 1.4)));
      const day = model.days[Math.min(model.days.length - 1, idx)];
      callbacks.onSelect("day", day.id);
    } else {
      const idx = Math.min(model.venues.length - 1, Math.max(0, Math.floor(nx * model.venues.length)));
      callbacks.onSelect("venue", model.venues[idx].id);
    }
  });
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      const rect = canvas.getBoundingClientRect();
      const nx = (e.touches[0].clientX - rect.left) / rect.width;
      const ny = (e.touches[0].clientY - rect.top) / rect.height;
      if (nx > 0.78) {
        const idx = Math.min(model.disciplines.length - 1, Math.max(0, Math.floor((nx - 0.8) / 0.033)));
        callbacks.onSelect("discipline", model.disciplines[idx].id);
      } else if (ny > 0.62) {
        const idx = Math.min(model.days.length - 1, Math.max(0, Math.floor((1 - ny) * model.days.length * 1.4)));
        callbacks.onSelect("day", model.days[Math.min(model.days.length - 1, idx)].id);
      } else {
        const idx = Math.min(model.venues.length - 1, Math.max(0, Math.floor(nx * model.venues.length)));
        callbacks.onSelect("venue", model.venues[idx].id);
      }
    }
  }, { passive: true });

  const onScroll = (e: Event): void => {
    const y = (e as CustomEvent).detail as number;
    scrollProgress = Math.min(1, y / 900);
  };
  document.addEventListener("kerf:scroll", onScroll);

  let raf = 0;
  const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

  const draw = (): void => {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.07, 0.067, 0.059, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const t = (performance.now() - bootTime) / 1400;
    const intro = t >= 1 ? 1 : easeOut(t);
    yaw += (targetYaw - yaw) * 0.25;
    pitch += (targetPitch - pitch) * 0.25;
    raise += (raiseTarget - raise) * 0.2;

    const eyeHeight = 2.6 - intro * 0.8 - scrollProgress * 1.1;
    const eyeZ = -1.6 + intro * 0.9 + scrollProgress * 2.2;
    const eye: number[] = [0 + Math.sin((yaw * Math.PI) / 180) * 3, eyeHeight + pitch / 12, eyeZ];
    const centre = [0.5, 0.35, 0.5];
    const proj = perspective((55 * Math.PI) / 180, w / h, 0.1, 30);
    const view = lookAt(eye, centre, [0, 1, 0]);
    const mvp = mat4mul(proj, view);
    gl.uniformMatrix4fv(mvpLoc, false, new Float32Array(mvp));

    gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 28, 0);
    gl.vertexAttribPointer(colLoc, 4, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(posLoc);
    gl.enableVertexAttribArray(colLoc);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

    void raise;
    gl.drawElements(gl.TRIANGLES, cubes.length * 36, gl.UNSIGNED_SHORT, 0);
    figure.setAttribute("data-intro", t >= 1 ? "done" : "running");
    figure.setAttribute("data-camera-progress", scrollProgress.toFixed(2));
    figure.setAttribute("data-camera-day", String(Math.min(4, Math.floor(scrollProgress * 4) + 1)));
    figure.setAttribute("data-yaw", yaw.toFixed(1));
    figure.setAttribute("data-pitch", pitch.toFixed(1));
    figure.setAttribute("data-raised", state.raised.join(","));
    figure.setAttribute("data-lit", state.lit.join(","));
    figure.setAttribute("data-seams", state.seams.join(","));
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  return {
    figure,
    setState(next: LatticeState) {
      state.raised = next.raised;
      state.lit = next.lit;
      state.seams = next.seams;
      raiseTarget = next.raised.length > 0 ? 0.35 : 0;
    },
    destroy() {
      cancelAnimationFrame(raf);
      document.removeEventListener("kerf:scroll", onScroll);
    },
  };
}
