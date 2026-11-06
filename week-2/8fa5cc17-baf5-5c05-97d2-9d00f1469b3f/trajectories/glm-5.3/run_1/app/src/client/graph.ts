// The three-dimensional link graph: a raw WebGL scene with the seeded
// layout, the force integrator, the camera, labels, pins and the fallback
// list. The single home of the graph scene in the browser.

import { api, type GraphJson, type ShareLinkJson, ApiFailure } from "./api.js";
import { h, clearChildren, announce, alertMessage, clearAlert, reducedMotion } from "./dom.js";
import { state, screens, mainEl, navigate, updateTopbarTitle } from "./app.js";
import { GRAPH, MOTION, QUIRE_CURVE, LIVE_DELAY } from "./constants.js";
import { THEMES } from "../shared/theme.js";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Node3 {
  id: string;
  title: string;
  typeIndex: number;
  backlinks: number;
  pos: Vec3;
  vel: Vec3;
  force: Vec3;
  size: number;
  pinned: boolean;
  inScope: boolean;
}

interface Edge3 {
  id: number;
  from: string;
  to: string;
  newAt: number | null; // timestamp while drawing in
}

// mat4 helpers, column-major
type Mat4 = Float32Array;

function matIdentity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

function matMultiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function matTranslate(x: number, y: number, z: number): Mat4 {
  const m = matIdentity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

function matScale(s: number): Mat4 {
  const m = matIdentity();
  m[0] = s; m[5] = s; m[10] = s;
  return m;
}

function matPerspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function matLookAt(eye: Vec3, target: Vec3): Mat4 {
  // up (0, 1, 0)
  let zx = eye.x - target.x;
  let zy = eye.y - target.y;
  let zz = eye.z - target.z;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx = zz * 1 - 0; // cross(up, z)
  let xy = 0;
  let xz = -(0 * zx - 1 * zy);
  // cross((0,1,0), (zx,zy,zz)) = (1*zz - 0*zy, 0*zx - 0*zz, 0*zy - 1*zx) = (zz, 0, -zx)
  xx = zz; xy = 0; xz = -zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[4] = xy; m[8] = xz;
  m[1] = yx; m[5] = yy; m[9] = yz;
  m[2] = zx; m[6] = zy; m[10] = zz;
  m[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
  m[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  m[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
  m[15] = 1;
  return m;
}

/** The FNV-1a hash of a node id, per the published rule. */
function nodeHash(id: string): number {
  let a = 2166136261;
  const lower = id.toLowerCase();
  for (let i = 0; i < lower.length; i += 1) {
    a ^= lower.charCodeAt(i);
    a = Math.imul(a, 16777619) >>> 0;
  }
  return a >>> 0;
}

/** The jitter generator. */
function jitter(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 1831565813) >>> 0;
    let q = (a ^ (a >>> 15)) >>> 0;
    q = Math.imul(q, a | 1) >>> 0;
    q = (q + Math.imul(q ^ (q >>> 7), q | 61)) >>> 0 ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

const VERTEX_SHADER = `#version 300 es
in vec3 a_position;
in vec3 a_normal;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
out vec3 v_normal;
out float v_eye_depth;
void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  vec4 eye = u_view * world;
  gl_Position = u_projection * eye;
  v_normal = mat3(u_model) * a_normal;
  v_eye_depth = -eye.z;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 v_normal;
in float v_eye_depth;
uniform vec3 u_color;
uniform float u_opacity;
uniform float u_fog_near;
uniform float u_fog_far;
uniform vec3 u_fog_color;
out vec4 frag;
void main() {
  float lit = 0.55 + 0.45 * abs(dot(normalize(v_normal), normalize(vec3(0.4, 0.8, 0.5))));
  vec3 base = u_color * lit;
  float fog = clamp((v_eye_depth - u_fog_near) / (u_fog_far - u_fog_near), 0.0, 1.0);
  vec3 color = mix(base, u_fog_color, fog);
  frag = vec4(color, u_opacity);
}`;

const LINE_VERTEX = `#version 300 es
in vec3 a_position;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
out float v_eye_depth;
void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  vec4 eye = u_view * world;
  gl_Position = u_projection * eye;
  v_eye_depth = -eye.z;
}`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
in float v_eye_depth;
uniform vec3 u_color;
uniform float u_opacity;
uniform float u_fog_near;
uniform float u_fog_far;
uniform vec3 u_fog_color;
out vec4 frag;
void main() {
  float fog = clamp((v_eye_depth - u_fog_near) / (u_fog_far - u_fog_near), 0.0, 1.0);
  vec3 color = mix(u_color, u_fog_color, fog);
  frag = vec4(color, u_opacity);
}`;

/** A unit icosphere with subdivision 1 (42 vertices, 80 faces). */
function buildIcosphere(): { vertices: Float32Array; normals: Float32Array; indices: Uint16Array } {
  const t = (1 + Math.sqrt(5)) / 2;
  const base: Array<[number, number, number]> = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l] as [number, number, number];
  });
  const faces: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const midpointCache = new Map<string, number>();
  const vertices: Array<[number, number, number]> = [...base];
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const hit = midpointCache.get(key);
    if (hit !== undefined) return hit;
    const va = vertices[a];
    const vb = vertices[b];
    const m: [number, number, number] = [(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2];
    const l = Math.hypot(m[0], m[1], m[2]);
    vertices.push([m[0] / l, m[1] / l, m[2] / l]);
    const idx = vertices.length - 1;
    midpointCache.set(key, idx);
    return idx;
  };
  const newFaces: Array<[number, number, number]> = [];
  for (const f of faces) {
    const a = midpoint(f[0], f[1]);
    const b = midpoint(f[1], f[2]);
    const c = midpoint(f[2], f[0]);
    newFaces.push([f[0], a, c], [f[1], b, a], [f[2], c, b], [a, b, c]);
  }
  const flat: number[] = [];
  for (const v of vertices) flat.push(v[0], v[1], v[2]);
  const idx: number[] = [];
  for (const f of newFaces) idx.push(f[0], f[1], f[2]);
  return {
    vertices: new Float32Array(flat),
    normals: new Float32Array(flat),
    indices: new Uint16Array(idx),
  };
}

export function openGraphScreen(query: URLSearchParams): void {
  const onEvent = (ev: Event): void => {
    const detail = (ev as CustomEvent).detail as { event: string; data: Record<string, unknown> };
    if (detail.event === "backlinks.changed" || detail.event === "object.saved" || detail.event === "object.removed" || detail.event === "share_link.changed") {
      scheduleRefetch();
    }
  };
  document.addEventListener("quire-event", onEvent);
  const main = mainEl();
  clearChildren(main);
  clearAlert();
  updateTopbarTitle("Graph");

  // filters from the address
  let typeFilter = query.get("type") ?? "";
  let collectionFilter = query.get("collection") ?? "";
  let shareLinkId = "";

  const typeSel = h("select", { "aria-label": "Show type" });
  const collectionSel = h("select", { "aria-label": "Show collection" });
  const scopeSel = h("select", { "aria-label": "Share scope" });
  const margin = document.getElementById("margin");
  const backlinksRegion = h("section", { "aria-label": "Backlinks", id: "graph-backlinks" }, h("h2", { text: "Backlinks" }));
  const graphGroup = h("div", { role: "group", "aria-label": "Link graph", class: "graph-group", tabindex: "0" });
  main.append(typeSel, collectionSel, scopeSel, graphGroup);
  if (margin !== null) {
    clearChildren(margin);
    margin.append(backlinksRegion);
  }

  let data: GraphJson | null = null;
  let nodes: Node3[] = [];
  let edges: Edge3[] = [];
  let running = true;
  let dirty = false;
  const pins = new Set<string>();
  let selected: string | null = null;
  interface CamPose { yaw: number; pitch: number; dist: number; target: Vec3 }
  const homePose = (): CamPose => ({ yaw: GRAPH.homeYaw, pitch: GRAPH.homePitch, dist: GRAPH.homeDistance, target: { x: 0, y: 0, z: 0 } });
  let cam: CamPose = homePose();
  let fly: { from: CamPose; to: CamPose; start: number } | null = null;
  let lastInput = performance.now();
  let refetchTimer = 0;

  const scheduleRefetch = (): void => {
    window.clearTimeout(refetchTimer);
    refetchTimer = window.setTimeout(() => void refetch(), Math.min(2000, LIVE_DELAY));
  };

  const fillFilters = (): void => {
    const types = state.app?.types ?? [];
    typeSel.replaceChildren(h("option", { value: "" }, "All types"));
    for (const t of types) typeSel.append(h("option", { value: t.id, selected: t.id === typeFilter }, t.name));
    const collections = state.app?.collections ?? [];
    collectionSel.replaceChildren(h("option", { value: "" }, "All collections"));
    for (const c of collections) collectionSel.append(h("option", { value: c.id, selected: c.id === collectionFilter }, c.name));
    void refreshScopeOptions();
  };

  const refreshScopeOptions = async (): Promise<void> => {
    scopeSel.replaceChildren(h("option", { value: "" }, "None"));
    for (const c of state.app?.collections ?? []) {
      try {
        const res = await api<{ share_links: ShareLinkJson[] }>("GET", `/api/collections/${c.id}/share-links`);
        for (const link of res.share_links.filter((l) => l.status === "active")) {
          scopeSel.append(h("option", { value: link.id, selected: link.id === shareLinkId }, `${c.name}, until ${link.expires_at_display}`));
        }
      } catch {
        // skip collections without links
      }
    }
  };

  typeSel.addEventListener("change", () => {
    typeFilter = typeSel.value;
    pushFilters();
  });
  collectionSel.addEventListener("change", () => {
    collectionFilter = collectionSel.value;
    pushFilters();
  });
  scopeSel.addEventListener("change", () => {
    shareLinkId = scopeSel.value;
    void refetch().then(() => {
      void refreshScopeOptions();
    });
  });

  const pushFilters = (): void => {
    const params = new URLSearchParams();
    if (typeFilter !== "") params.set("type", typeFilter);
    if (collectionFilter !== "") params.set("collection", collectionFilter);
    history.pushState(null, "", `/graph${params.toString().length > 0 ? `?${params.toString()}` : ""}`);
  };

  // webgl setup
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.classList.add("graph-canvas");
  const gl = canvas.getContext("webgl2", { antialias: true }) ?? canvas.getContext("webgl", { antialias: true });
  let fallbackList: HTMLElement | null = null;
  if (gl === null) {
    // the published node list fallback
    canvas.remove();
    fallbackList = h("ul", { class: "graph-fallback", "aria-label": "Graph nodes" });
    graphGroup.append(fallbackList);
  } else {
    graphGroup.append(canvas);
  }
  const isWebgl2 = gl !== null && (gl as WebGL2RenderingContext).createVertexArray !== undefined;

  let progSphere: WebGLProgram | null = null;
  let progLine: WebGLProgram | null = null;
  let sphereBuffers: { vbo: WebGLBuffer; nbo: WebGLBuffer; ibo: WebGLBuffer; count: number } | null = null;

  if (gl !== null) {
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (sh === null) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };
    const link = (vs: string, fs: string): WebGLProgram | null => {
      const v = compile(gl.VERTEX_SHADER, vs);
      const f = compile(gl.FRAGMENT_SHADER, fs);
      if (v === null || f === null) return null;
      const p = gl.createProgram();
      if (p === null) return null;
      gl.attachShader(p, v);
      gl.attachShader(p, f);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
      return p;
    };
    progSphere = link(VERTEX_SHADER, FRAGMENT_SHADER);
    progLine = link(LINE_VERTEX, LINE_FRAGMENT);
    const sphere = buildIcosphere();
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, sphere.vertices, gl.STATIC_DRAW);
    const nbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
    gl.bufferData(gl.ARRAY_BUFFER, sphere.normals, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.indices, gl.STATIC_DRAW);
    sphereBuffers = { vbo, nbo, ibo, count: sphere.indices.length };
  }

  const resize = (): void => {
    if (gl === null) return;
    const dpr = window.devicePixelRatio || 1;
    const w = graphGroup.clientWidth;
    const height = window.innerWidth < 768 ? 480 : 560;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    dirty = true;
  };
  window.addEventListener("resize", resize);
  resize();

  // seeded layout
  const libraryOrder = (): string[] => (state.app?.types ?? []).map((t) => t.id);

  const seededStart = (id: string, typeIndex: number, indexInType: number, countInType: number): Vec3 => {
    const R = GRAPH.shellBase + GRAPH.shellStep * typeIndex;
    const y = 1 - (2 * (indexInType + 0.5)) / countInType;
    const rho = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = (indexInType * GRAPH.jitterTheta * Math.PI) / 180;
    const gen = jitter(nodeHash(id));
    const u1 = gen();
    const u2 = gen();
    const u3 = gen();
    return {
      x: R * rho * Math.cos(theta) + (u1 - 0.5),
      y: R * y + (u2 - 0.5),
      z: R * rho * Math.sin(theta) + (u3 - 0.5),
    };
  };

  const nodeSize = (backlinks: number): number => Math.min(GRAPH.sizeMax, GRAPH.sizeBase + GRAPH.sizePerBacklink * backlinks);

  const buildNodes = (d: GraphJson, previous: Map<string, Node3>): { nodes: Node3[]; edges: Edge3[]; reheat: boolean } => {
    const order = libraryOrder();
    const byType = new Map<string, number>();
    d.nodes.forEach((n) => {
      const ti = order.indexOf(n.type_id);
      if (!byType.has(n.type_id)) byType.set(n.type_id, 0);
    });
    const counts = new Map<string, number>();
    for (const n of d.nodes) counts.set(n.type_id, (counts.get(n.type_id) ?? 0) + 1);
    const indexInType = new Map<string, number>();
    const sortedNodes = [...d.nodes].sort((a, b) => {
      const ta = order.indexOf(a.type_id);
      const tb = order.indexOf(b.type_id);
      if (ta !== tb) return ta - tb;
      const ca = a.title.toLowerCase();
      const cb = b.title.toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    const out: Node3[] = [];
    let structuralChange = false;
    for (const n of sortedNodes) {
      const ti = order.indexOf(n.type_id);
      const idx = indexInType.get(n.type_id) ?? 0;
      indexInType.set(n.type_id, idx + 1);
      const prev = previous.get(n.id);
      const pos = prev !== undefined ? prev.pos : seededStart(n.id, ti, idx, counts.get(n.type_id) ?? 1);
      if (prev === undefined) structuralChange = true;
      if (prev !== undefined && prev.backlinks !== n.backlinks) structuralChange = true;
      out.push({
        id: n.id,
        title: n.title,
        typeIndex: ti,
        backlinks: n.backlinks,
        pos,
        vel: prev !== undefined ? prev.vel : { x: 0, y: 0, z: 0 },
        force: { x: 0, y: 0, z: 0 },
        size: nodeSize(n.backlinks),
        pinned: pins.has(n.id),
        inScope: n.in_scope ?? true,
      });
    }
    if (out.length !== previous.size) structuralChange = true;
    const edgeSet = new Set(d.edges.map((e) => e.id));
    if (edgeSet.size !== previousEdges.size || [...edgeSet].some((id2) => !previousEdges.has(id2))) structuralChange = true;
    const edgesOut: Edge3[] = d.edges.map((e) => {
      const old = previousEdges.get(e.id);
      return { id: e.id, from: e.from, to: e.to, newAt: old !== undefined ? old.newAt : reducedMotion() ? null : performance.now() };
    });
    return { nodes: out, edges: edgesOut, reheat: structuralChange };
  };

  const previousEdges = new Map<number, Edge3>();

  // forces
  const computeForces = (): void => {
    for (const n of nodes) {
      n.force.x = 0; n.force.y = 0; n.force.z = 0;
    }
    // repulsion, every pair
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dz = b.pos.z - a.pos.z;
        const len = Math.hypot(dx, dy, dz);
        const ux = len === 0 ? 1 : dx / len;
        const uy = len === 0 ? 0 : dy / len;
        const uz = len === 0 ? 0 : dz / len;
        const strength = GRAPH.repulsion / Math.pow(Math.max(len, GRAPH.repulsionMin), 2);
        a.force.x -= ux * strength;
        a.force.y -= uy * strength;
        a.force.z -= uz * strength;
        b.force.x += ux * strength;
        b.force.y += uy * strength;
        b.force.z += uz * strength;
      }
    }
    // springs, every edge in ascending id order
    const byId = [...edges].sort((a, b) => a.id - b.id);
    for (const e of byId) {
      const a = nodes.find((n) => n.id === e.from);
      const b = nodes.find((n) => n.id === e.to);
      if (a === undefined || b === undefined) continue;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const dz = b.pos.z - a.pos.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const uz = dz / len;
      const strength = GRAPH.springStrength * (len - GRAPH.springLength);
      a.force.x += ux * strength;
      a.force.y += uy * strength;
      a.force.z += uz * strength;
      b.force.x -= ux * strength;
      b.force.y -= uy * strength;
      b.force.z -= uz * strength;
    }
    // shells
    for (const n of nodes) {
      const R = GRAPH.shellBase + GRAPH.shellStep * n.typeIndex;
      const len = Math.hypot(n.pos.x, n.pos.y, n.pos.z);
      if (len === 0) continue;
      const strength = -GRAPH.shellStrength * (len - R) / len;
      n.force.x += n.pos.x * strength;
      n.force.y += n.pos.y * strength;
      n.force.z += n.pos.z * strength;
    }
  };

  const step = (): boolean => {
    // velocity verlet
    const oldForces = nodes.map((n) => ({ x: n.force.x, y: n.force.y, z: n.force.z }));
    for (const n of nodes) {
      if (n.pinned) continue;
      n.pos.x += n.vel.x * GRAPH.step + 0.5 * n.force.x * GRAPH.step * GRAPH.step;
      n.pos.y += n.vel.y * GRAPH.step + 0.5 * n.force.y * GRAPH.step * GRAPH.step;
      n.pos.z += n.vel.z * GRAPH.step + 0.5 * n.force.z * GRAPH.step * GRAPH.step;
    }
    computeForces();
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i];
      if (n.pinned) continue;
      n.vel.x = (n.vel.x + 0.5 * (oldForces[i].x + n.force.x) * GRAPH.step) * GRAPH.damping;
      n.vel.y = (n.vel.y + 0.5 * (oldForces[i].y + n.force.y) * GRAPH.step) * GRAPH.damping;
      n.vel.z = (n.vel.z + 0.5 * (oldForces[i].z + n.force.z) * GRAPH.step) * GRAPH.damping;
    }
    let maxSpeed = 0;
    for (const n of nodes) {
      if (n.pinned) continue;
      const speed = Math.hypot(n.vel.x, n.vel.y, n.vel.z);
      if (speed > maxSpeed) maxSpeed = speed;
    }
    return maxSpeed < GRAPH.restSpeed;
  };

  let reheatRemaining = 0;
  let reheatCarry = 0;
  let lastFrame = performance.now();
  let scopeTimer = 0;

  const refetch = async (): Promise<void> => {
    let d: GraphJson;
    const scopeParam = shareLinkId !== "" ? `?share_link_id=${shareLinkId}` : "";
    try {
      d = await api<GraphJson>("GET", `/api/graph${scopeParam}`);
    } catch (e) {
      if (e instanceof ApiFailure && shareLinkId !== "") {
        // the chosen link stopped being active
        shareLinkId = "";
        scopeSel.value = "";
        alertMessage("That share link is no longer active.");
        void refetch();
        return;
      }
      return;
    }
    const prev = new Map(nodes.map((n) => [n.id, n]));
    const built = buildNodes(d, prev);
    data = d;
    nodes = built.nodes;
    edges = built.edges;
    previousEdges.clear();
    for (const e of edges) previousEdges.set(e.id, e);
    if (built.reheat) {
      if (reducedMotion()) {
        for (let i = 0; i < GRAPH.reheatSteps; i += 1) {
          if (step()) break;
        }
      } else {
        reheatRemaining = GRAPH.reheatSteps;
        reheatCarry = 0;
      }
    }
    dirty = true;
    buildLabels();
    if (fallbackList !== null) buildFallbackList();
  };

  // visibility by the filters
  const visibleNodes = (): Node3[] => nodes.filter((n) => {
    const meta = data?.nodes.find((x) => x.id === n.id);
    if (meta === undefined) return false;
    if (typeFilter !== "" && meta.type_id !== typeFilter) return false;
    if (collectionFilter !== "" && !meta.collection_ids.includes(collectionFilter)) return false;
    return true;
  });

  // labels: a button per node, laid over the canvas
  const labelHost = h("div", { class: "graph-labels" });
  graphGroup.append(labelHost);
  const labelPositions = new Map<string, { x: number; y: number; opacity: number }>();

  const buildLabels = (): void => {
    labelHost.replaceChildren();
    const vis = visibleNodes().slice().sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : a.id < b.id ? -1 : 1));
    for (const n of vis) {
      const btn = h("button", { class: "graph-node-label", "data-node-id": n.id, style: { position: "absolute" } });
      btn.addEventListener("focus", () => {
        select(n.id, true);
      });
      btn.addEventListener("click", (e) => {
        if (dragMoved) return;
        select(n.id, false);
        e.preventDefault();
      });
      btn.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void navigate(`/o/${n.id}`);
        } else if (e.key.toLowerCase() === "p") {
          e.preventDefault();
          togglePin(n);
        }
      });
      labelHost.append(btn);
    }
    updateLabelButtons();
  };

  const updateLabelButtons = (): void => {
    for (const n of visibleNodes()) {
      const btn = labelHost.querySelector(`[data-node-id="${n.id}"]`);
      if (btn === null) continue;
      const suffix = !n.inScope ? `, not shared` : "";
      btn.textContent = `${n.title}${suffix}`;
      btn.setAttribute("aria-label", `${n.title}, ${n.backlinks} ${n.backlinks === 1 ? "backlink" : "backlinks"}${!n.inScope ? ", not shared" : ""}${n.pinned ? ", pinned" : ""}`);
    }
  };

  const project = (p: Vec3, view: Mat4, proj: Mat4): { x: number; y: number; depth: number; behind: boolean } => {
    const ex = view[0] * p.x + view[4] * p.y + view[8] * p.z + view[12];
    const ey = view[1] * p.x + view[5] * p.y + view[9] * p.z + view[13];
    const ez = view[2] * p.x + view[6] * p.y + view[10] * p.z + view[14];
    if (ez >= 0) return { x: 0, y: 0, depth: ez, behind: true };
    const cx = proj[0] * ex;
    const cy = proj[5] * ey;
    const cw = -ez;
    const ndcX = cx / cw;
    const ndcY = cy / cw;
    return {
      x: (ndcX * 0.5 + 0.5) * canvas.clientWidth,
      y: (1 - (ndcY * 0.5 + 0.5)) * canvas.clientHeight,
      depth: -ez,
      behind: false,
    };
  };

  const select = (id: string, focusOnly: boolean): void => {
    selected = id;
    updateLabelButtons();
    const n = nodes.find((x) => x.id === id);
    if (n === undefined) return;
    lastInput = performance.now();
    if (focusOnly === false) {
      // the fly-to pose
      const target = { ...n.pos };
      const yaw = (Math.atan2(n.pos.x, n.pos.z) * 180) / Math.PI;
      const d = GRAPH.flyDistanceBase + GRAPH.flyDistancePerSize * n.size;
      if (reducedMotion()) {
        cam = { yaw, pitch: GRAPH.flyPitch, dist: d, target };
      } else {
        fly = { from: { ...cam, target: { ...cam.target } }, to: { yaw, pitch: GRAPH.flyPitch, dist: d, target }, start: performance.now() };
      }
    }
    void renderBacklinks(id);
  };

  const dragMoved = { value: false };

  const flyHome = (): void => {
    selected = null;
    updateLabelButtons();
    const home = homePose();
    if (reducedMotion()) {
      cam = home;
      return;
    }
    fly = { from: { ...cam, target: { ...cam.target } }, to: home, start: performance.now() };
  };

  const togglePin = (n: Node3): void => {
    n.pinned = !n.pinned;
    if (n.pinned) pins.add(n.id);
    else pins.delete(n.id);
    announce(n.pinned ? `Pinned ${n.title}.` : `Unpinned ${n.title}.`);
    updateLabelButtons();
  };

  const renderBacklinks = async (id: string): Promise<void> => {
    try {
      const res = await api<{ count: number; backlinks: Array<{ from_title: string; kind: string }> }>("GET", `/api/objects/${id}/backlinks`);
      backlinksRegion.replaceChildren(h("h2", {}, `Backlinks ${res.count}`));
      const list = h("ul", { "aria-label": "Backlinks list" });
      for (const b of res.backlinks) {
        list.append(h("li", {}, `${b.from_title} ${b.kind === "quote" ? "quoted" : ""}`));
      }
      backlinksRegion.append(list);
    } catch {
      // leave the previous list
    }
  };

  // picking: a ray against each node sphere
  const pick = (mx: number, my: number): string | null => {
    const eye = camEye();
    const view = camView();
    const proj = matPerspective((GRAPH.fov * Math.PI) / 180, canvas.clientWidth / canvas.clientHeight, GRAPH.near, GRAPH.far);
    const inv = invertView(view);
    // ray through the pixel
    const ndcX = (mx / canvas.clientWidth) * 2 - 1;
    const ndcY = 1 - (my / canvas.clientHeight) * 2;
    const tanHalf = Math.tan((GRAPH.fov * Math.PI / 180) / 2);
    const dirCam = { x: ndcX * tanHalf * (canvas.clientWidth / canvas.clientHeight), y: ndcY * tanHalf, z: -1 };
    // camera basis
    let zx = eye.x - cam.target.x, zy = eye.y - cam.target.y, zz = eye.z - cam.target.z;
    const zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;
    const xx = zz, xy = 0, xz = -zx;
    const xl = Math.hypot(xx, xy, xz) || 1;
    const fx = xx / xl, fy = 0, fz = xz / xl;
    const ux = zy * fz - zz * fy;
    const uy = zz * fx - zx * fz;
    const uz = zx * fy - zy * fx;
    const dir = {
      x: fx * dirCam.x + ux * dirCam.y - zx * dirCam.z,
      y: fy * dirCam.x + uy * dirCam.y - zy * dirCam.z,
      z: fz * dirCam.x + uz * dirCam.y - zz * dirCam.z,
    };
    void inv;
    let best: { id: string; t: number } | null = null;
    for (const n of visibleNodes()) {
      const ox = n.pos.x - eye.x;
      const oy = n.pos.y - eye.y;
      const oz = n.pos.z - eye.z;
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const c = ox * ox + oy * oy + oz * oz - n.size * n.size;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && (best === null || t < best.t)) best = { id: n.id, t };
    }
    return best?.id ?? null;
  };

  const invertView = (view: Mat4): Mat4 => {
    void view;
    return matIdentity();
  };

  const camEye = (): Vec3 => {
    const psi = (cam.pitch * Math.PI) / 180;
    const phi = (cam.yaw * Math.PI) / 180;
    return {
      x: cam.target.x + cam.dist * Math.cos(psi) * Math.sin(phi),
      y: cam.target.y + cam.dist * Math.sin(psi),
      z: cam.target.z + cam.dist * Math.cos(psi) * Math.cos(phi),
    };
  };

  const camView = (): Mat4 => matLookAt(camEye(), cam.target);

  // pointer input
  let dragging: "none" | "orbit" | "node" = "none";
  let dragNode: Node3 | null = null;
  let lastPointer = { x: 0, y: 0 };
  let downPointer = { x: 0, y: 0 };
  graphGroup.addEventListener("pointerdown", (e: PointerEvent) => {
    const rect = graphGroup.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    lastPointer = { x: e.clientX, y: e.clientY };
    downPointer = { x: e.clientX, y: e.clientY };
    dragMoved.value = false;
    lastInput = performance.now();
    const hit = pick(mx, my);
    if (hit !== null) {
      const n = nodes.find((x) => x.id === hit) ?? null;
      dragNode = n;
      dragging = "node";
      if (n !== null) {
        selected = n.id;
        updateLabelButtons();
        void renderBacklinks(n.id);
      }
    } else {
      dragging = "orbit";
      fly = null;
    }
  });
  window.addEventListener("pointermove", (e: PointerEvent) => {
    if (dragging === "none") return;
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    lastPointer = { x: e.clientX, y: e.clientY };
    if (Math.hypot(e.clientX - downPointer.x, e.clientY - downPointer.y) >= 4) dragMoved.value = true;
    lastInput = performance.now();
    if (dragging === "orbit") {
      cam.yaw += dx * GRAPH.dragDegreesPerPixel;
      cam.pitch = Math.max(GRAPH.pitchMin, Math.min(GRAPH.pitchMax, cam.pitch + dy * GRAPH.dragDegreesPerPixel));
      dirty = true;
    } else if (dragging === "node" && dragNode !== null && dragMoved.value) {
      // the node sits where the ray meets the plane through its position
      // at the press, facing the camera
      if (!dragNode.pinned) {
        dragNode.pinned = true;
        pins.add(dragNode.id);
        announce(`Pinned ${dragNode.title}.`);
        reheatRemaining = GRAPH.reheatSteps;
      }
      const eye = camEye();
      const viewDir = { x: cam.target.x - eye.x, y: cam.target.y - eye.y, z: cam.target.z - eye.z };
      const planePoint = dragNode.pos;
      const denom = viewDir.x * 0 + viewDir.y * 0 + viewDir.z * 0 + 1;
      void planePoint;
      void denom;
      // approximate: move in the camera plane
      const scale = 0.05 * cam.dist;
      dragNode.pos.x += dx * scale * Math.cos((cam.yaw * Math.PI) / 180) + dy * scale * Math.sin((cam.pitch * Math.PI) / 180) * Math.sin((cam.yaw * Math.PI) / 180);
      dragNode.pos.z -= dx * scale * Math.sin((cam.yaw * Math.PI) / 180) - dy * scale * Math.sin((cam.pitch * Math.PI) / 180) * Math.cos((cam.yaw * Math.PI) / 180);
      dragNode.pos.y += dy * scale * Math.cos((cam.pitch * Math.PI) / 180);
      dirty = true;
    }
  });
  window.addEventListener("pointerup", (e: PointerEvent) => {
    if (dragging === "node" && dragNode !== null && !dragMoved.value) {
      // a click on the node selects it
      select(dragNode.id, false);
    } else if (dragging === "orbit" && !dragMoved.value) {
      // a click on empty canvas flies home
      flyHome();
    }
    if (dragging === "node" && dragMoved.value && e.altKey && dragNode !== null) {
      dragNode.pinned = false;
      pins.delete(dragNode.id);
      announce(`Unpinned ${dragNode.title}.`);
      reheatRemaining = GRAPH.reheatSteps;
      updateLabelButtons();
    }
    dragging = "none";
    dragNode = null;
  });
  graphGroup.addEventListener("wheel", (e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? canvas.clientHeight : e.deltaY;
    cam.dist = Math.max(GRAPH.distanceMin, Math.min(GRAPH.distanceMax, cam.dist + GRAPH.wheelDistanceFactor * delta));
    lastInput = performance.now();
    dirty = true;
  }, { passive: false });
  graphGroup.addEventListener("keydown", (e: KeyboardEvent) => {
    lastInput = performance.now();
    const onNode = document.activeElement?.classList.contains("graph-node-label") === true;
    if (!onNode) return;
    if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const s = e.key === "ArrowLeft" ? -GRAPH.keyYaw : e.key === "ArrowRight" ? GRAPH.keyYaw : 0;
      const p = e.key === "ArrowUp" ? GRAPH.keyPitch : e.key === "ArrowDown" ? -GRAPH.keyPitch : 0;
      cam.yaw += s;
      cam.pitch = Math.max(GRAPH.pitchMin, Math.min(GRAPH.pitchMax, cam.pitch + p));
      dirty = true;
      return;
    }
    if (e.key === "+" || e.key === "=" || e.key === "-") {
      e.preventDefault();
      const d = e.key === "-" ? GRAPH.keyDistance : -GRAPH.keyDistance;
      cam.dist = Math.max(GRAPH.distanceMin, Math.min(GRAPH.distanceMax, cam.dist + d));
      dirty = true;
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      flyHome();
      return;
    }
    // node navigation
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const vis = visibleNodes().slice().sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : a.id < b.id ? -1 : 1));
      if (vis.length === 0) return;
      const current = document.activeElement?.getAttribute("data-node-id") ?? null;
      let idx = vis.findIndex((n) => n.id === current);
      if (idx === -1) idx = 0;
      if (e.key === "Home") idx = 0;
      else if (e.key === "End") idx = vis.length - 1;
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") idx = (idx + 1) % vis.length;
      else idx = (idx - 1 + vis.length) % vis.length;
      const btn = labelHost.querySelector(`[data-node-id="${vis[idx].id}"]`) as HTMLElement | null;
      if (btn !== null) btn.focus();
      return;
    }
  });

  const buildFallbackList = (): void => {
    if (fallbackList === null) return;
    const vis = visibleNodes().slice().sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : a.id < b.id ? -1 : 1));
    fallbackList.replaceChildren();
    for (const n of vis) {
      const linked = edges.filter((e) => e.from === n.id).map((e) => nodes.find((x) => x.id === e.to)?.title ?? "").filter((t) => vis.some((v) => v.title === t)).sort();
      const btn = h("button", { class: "graph-node-label", "aria-label": `${n.title}, ${n.backlinks} ${n.backlinks === 1 ? "backlink" : "backlinks"}${!n.inScope ? ", not shared" : ""}${n.pinned ? ", pinned" : ""}` }, n.title);
      btn.addEventListener("click", () => void navigate(`/o/${n.id}`));
      fallbackList.append(h("li", {}, btn, ` links to ${linked.length > 0 ? linked.join(", ") : "nothing"}`));
    }
  };

  // the render loop
  const drawFrame = (): void => {
    if (!running) return;
    requestAnimationFrame(drawFrame);
    // reheats
    const now = performance.now();
    if (reheatRemaining > 0) {
      reheatCarry += now - lastFrame;
      let stepsThisFrame = Math.min(8, Math.floor(reheatCarry / 16));
      reheatCarry -= stepsThisFrame * 16;
      stepsThisFrame = Math.min(stepsThisFrame, reheatRemaining);
      for (let i = 0; i < stepsThisFrame; i += 1) {
        reheatRemaining -= 1;
        if (step()) {
          reheatRemaining = 0;
          break;
        }
      }
      dirty = true;
    }
    lastFrame = now;
    // idle turn
    if (selected === null && !reducedMotion() && performance.now() - lastInput > GRAPH.idleResume && dragging === "none") {
      cam.yaw += GRAPH.idleTurnRate / 60;
      dirty = true;
    }
    // fly-to
    if (fly !== null) {
      const t = Math.min(1, (performance.now() - fly.start) / MOTION.flyTime);
      const eased = cubicBezier(t);
      const yawFrom = fly.from.yaw;
      const yawTo = nearestYaw(yawFrom, fly.to.yaw);
      cam.yaw = yawFrom + (yawTo - yawFrom) * eased;
      cam.pitch = fly.from.pitch + (fly.to.pitch - fly.from.pitch) * eased;
      cam.dist = fly.from.dist + (fly.to.dist - fly.from.dist) * eased;
      cam.target.x = fly.from.target.x + (fly.to.target.x - fly.from.target.x) * eased;
      cam.target.y = fly.from.target.y + (fly.to.target.y - fly.from.target.y) * eased;
      cam.target.z = fly.from.target.z + (fly.to.target.z - fly.from.target.z) * eased;
      if (t >= 1) fly = null;
      dirty = true;
    }
    if (gl === null) return;
    if (!dirty) return;
    dirty = false;
    const theme = document.documentElement.dataset.theme === "lamplight" ? "lamplight" : "paper";
    const tokens = THEMES[theme];
    gl.clearColor(tokens.paper[0] / 255, tokens.paper[1] / 255, tokens.paper[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const eye = camEye();
    const view = camView();
    const proj = matPerspective((GRAPH.fov * Math.PI) / 180, canvas.clientWidth / canvas.clientHeight, GRAPH.near, GRAPH.far);
    const fogNear = Math.hypot(eye.x - cam.target.x, eye.y - cam.target.y, eye.z - cam.target.z);
    const fogFar = fogNear + GRAPH.fogRange;
    const fogColor: [number, number, number] = [tokens.paper[0] / 255, tokens.paper[1] / 255, tokens.paper[2] / 255];
    const inkColor: [number, number, number] = [tokens.ink[0] / 255, tokens.ink[1] / 255, tokens.ink[2] / 255];
    const linkColor: [number, number, number] = [tokens.link[0] / 255, tokens.link[1] / 255, tokens.link[2] / 255];
    const ruleColor: [number, number, number] = [tokens.rule[0] / 255, tokens.rule[1] / 255, tokens.rule[2] / 255];

    const setCommon = (prog: WebGLProgram, color: [number, number, number], opacity: number): void => {
      const uView = gl.getUniformLocation(prog, "u_view");
      const uProj = gl.getUniformLocation(prog, "u_projection");
      const uModel = gl.getUniformLocation(prog, "u_model");
      const uColor = gl.getUniformLocation(prog, "u_color");
      const uOpacity = gl.getUniformLocation(prog, "u_opacity");
      const uFogNear = gl.getUniformLocation(prog, "u_fog_near");
      const uFogFar = gl.getUniformLocation(prog, "u_fog_far");
      const uFogColor = gl.getUniformLocation(prog, "u_fog_color");
      gl.uniformMatrix4fv(uView, false, view);
      gl.uniformMatrix4fv(uProj, false, proj);
      gl.uniformMatrix4fv(uModel, false, matIdentity());
      gl.uniform3f(uColor, color[0], color[1], color[2]);
      gl.uniform1f(uOpacity, opacity);
      gl.uniform1f(uFogNear, fogNear);
      gl.uniform1f(uFogFar, fogFar);
      gl.uniform3f(uFogColor, fogColor[0], fogColor[1], fogColor[2]);
    };

    // edges first (batched by look)
    if (progLine !== null) {
      gl.useProgram(progLine);
      setCommon(progLine, ruleColor, 1);
      const batches: Array<{ color: [number, number, number]; opacity: number; pairs: Array<[Node3, Node3]> }> = [
        { color: ruleColor, opacity: 1, pairs: [] }, // plain
        { color: linkColor, opacity: 1, pairs: [] }, // selected
        { color: ruleColor, opacity: 0.25, pairs: [] }, // out of scope
      ];
      const vis = new Set(visibleNodes().map((n) => n.id));
      const drawIns: Edge3[] = [];
      for (const e of edges) {
        if (!vis.has(e.from) || !vis.has(e.to)) continue;
        const a = nodes.find((n) => n.id === e.from);
        const b = nodes.find((n) => n.id === e.to);
        if (a === undefined || b === undefined) continue;
        if (e.newAt !== null) {
          drawIns.push(e);
          continue;
        }
        const aOut = !a.inScope;
        const bOut = !b.inScope;
        if (aOut || bOut) batches[2].pairs.push([a, b]);
        else if (selected !== null && (e.from === selected || e.to === selected)) batches[1].pairs.push([a, b]);
        else batches[0].pairs.push([a, b]);
      }
      const posLoc = gl.getAttribLocation(progLine, "a_position");
      for (const batch of batches) {
        if (batch.pairs.length === 0) continue;
        setCommon(progLine, batch.color, batch.opacity);
        const verts = new Float32Array(batch.pairs.length * 6);
        batch.pairs.forEach((p, i) => {
          verts[i * 6] = p[0].pos.x; verts[i * 6 + 1] = p[0].pos.y; verts[i * 6 + 2] = p[0].pos.z;
          verts[i * 6 + 3] = p[1].pos.x; verts[i * 6 + 4] = p[1].pos.y; verts[i * 6 + 5] = p[1].pos.z;
        });
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, batch.pairs.length * 2);
        gl.deleteBuffer(vbo);
      }
      // edges drawing in: one 2-vertex draw each
      for (const e of drawIns) {
        const a = nodes.find((n) => n.id === e.from);
        const b = nodes.find((n) => n.id === e.to);
        if (a === undefined || b === undefined) continue;
        const t = Math.min(1, (performance.now() - (e.newAt ?? performance.now())) / MOTION.edgeDrawIn);
        const eased = cubicBezier(t);
        const verts = new Float32Array([0, 0, 0, b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z]);
        setCommon(progLine, ruleColor, 1);
        const uModel = gl.getUniformLocation(progLine, "u_model");
        const model = matMultiply(matTranslate(a.pos.x, a.pos.y, a.pos.z), matScale(eased));
        gl.uniformMatrix4fv(uModel, false, model);
        const posLoc = gl.getAttribLocation(progLine, "a_position");
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, 2);
        gl.deleteBuffer(vbo);
        if (t >= 1) e.newAt = null;
      }
    }

    // nodes: one indexed draw per visible node
    if (progSphere !== null && sphereBuffers !== null) {
      gl.useProgram(progSphere);
      const posLoc = gl.getAttribLocation(progSphere, "a_position");
      const normLoc = gl.getAttribLocation(progSphere, "a_normal");
      gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffers.vbo);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, sphereBuffers.nbo);
      gl.enableVertexAttribArray(normLoc);
      gl.vertexAttribPointer(normLoc, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereBuffers.ibo);
      const uModel = gl.getUniformLocation(progSphere, "u_model");
      const uView = gl.getUniformLocation(progSphere, "u_view");
      const uProj = gl.getUniformLocation(progSphere, "u_projection");
      const uColor = gl.getUniformLocation(progSphere, "u_color");
      const uOpacity = gl.getUniformLocation(progSphere, "u_opacity");
      const uFogNear = gl.getUniformLocation(progSphere, "u_fog_near");
      const uFogFar = gl.getUniformLocation(progSphere, "u_fog_far");
      const uFogColor = gl.getUniformLocation(progSphere, "u_fog_color");
      gl.uniformMatrix4fv(uView, false, view);
      gl.uniformMatrix4fv(uProj, false, proj);
      gl.uniform1f(uFogNear, fogNear);
      gl.uniform1f(uFogFar, fogFar);
      gl.uniform3f(uFogColor, fogColor[0], fogColor[1], fogColor[2]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      for (const n of visibleNodes()) {
        const model = matMultiply(matTranslate(n.pos.x, n.pos.y, n.pos.z), matScale(n.size));
        gl.uniformMatrix4fv(uModel, false, model);
        const color = selected === n.id ? linkColor : inkColor;
        gl.uniform3f(uColor, color[0], color[1], color[2]);
        gl.uniform1f(uOpacity, n.inScope ? 1 : 0.25);
        gl.drawElements(gl.TRIANGLES, sphereBuffers.count, gl.UNSIGNED_SHORT, 0);
      }
      gl.disable(gl.BLEND);
    }

    // labels follow the projected points
    for (const n of visibleNodes()) {
      const btn = labelHost.querySelector(`[data-node-id="${n.id}"]`) as HTMLElement | null;
      if (btn === null) continue;
      const p = project(n.pos, view, proj);
      const isFocused = document.activeElement === btn;
      const projectedRadius = (n.size * (canvas.clientHeight / 2)) / (Math.tan((GRAPH.fov * Math.PI / 180) / 2) * p.depth);
      const detail = projectedRadius >= GRAPH.labelMinRadius || selected === n.id || isFocused ? 1 : 0;
      const scopeFactor = n.inScope ? 1 : 0.25;
      const opacity = p.behind ? (isFocused ? 1 : 0) : detail * scopeFactor;
      if (opacity > 0 && !p.behind && p.x >= 0 && p.x <= canvas.clientWidth && p.y >= 0 && p.y <= canvas.clientHeight) {
        btn.style.left = `${p.x + GRAPH.labelOffset}px`;
        btn.style.top = `${p.y}px`;
        btn.style.transform = "translateY(-50%)";
        btn.style.opacity = String(opacity);
      } else if (isFocused) {
        btn.style.opacity = "1";
      } else {
        btn.style.opacity = String(opacity);
      }
    }
  };

  const cubicBezier = (t: number): number => {
    // cubic bezier (0.2, 0)(0, 1): solve numerically
    // B(t) = 3(1-t)^2 t * P0x... use a simple approximation of the curve
    const p1x = 0.2, p2x = 0;
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      const x = 3 * (1 - mid) * (1 - mid) * mid * p1x + 3 * (1 - mid) * mid * mid * p2x + mid * mid * mid;
      if (x < t) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const nearestYaw = (from: number, to: number): number => {
    let delta = ((to - from) % 360 + 540) % 360 - 180;
    return from + delta;
  };

  const settled = (): boolean => {
    if (reheatRemaining > 0) return false;
    let maxSpeed = 0;
    for (const n of nodes) {
      if (n.pinned) continue;
      const s = Math.hypot(n.vel.x, n.vel.y, n.vel.z);
      if (s > maxSpeed) maxSpeed = s;
    }
    return maxSpeed < GRAPH.restSpeed;
  };

  // the initial settle runs before the first frame
  const initialSettle = (): boolean => {
    for (let i = 0; i < GRAPH.maxSteps; i += 1) {
      if (step()) return true;
    }
    return false;
  };

  fillFilters();
  void refetch().then(() => {
    initialSettle();
    requestAnimationFrame(drawFrame);
  });

  // the scope refresh while a share link is chosen: at least every five seconds
  scopeTimer = window.setInterval(() => {
    if (shareLinkId !== "") void refetch();
  }, 5000);

  screens.current = {
    dispose: () => {
      document.removeEventListener("quire-event", onEvent);
      running = false;
      window.clearInterval(scopeTimer);
    },
  };
}
