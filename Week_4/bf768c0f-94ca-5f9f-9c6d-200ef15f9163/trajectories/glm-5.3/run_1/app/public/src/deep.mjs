// The deep board: WebGL2, hardware-lit, camera from the viewer's own side,
// drag to orbit, wheel to zoom, pieces travelling between squares.
// Every deep piece type has its own silhouette: a horse-head knight with muzzle
// and ears, a rook with battlements, a king with a cross, a queen with a crown.

const FILES = 'abcdefgh';
const sqName = (f, r) => FILES[f] + (r + 1);

// ---- mesh helpers -------------------------------------------------------
function pushTri(out, a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }

function lathe(profile, segments = 18) {
  // profile: array of [radius, y] revolved around the Y axis
  const out = [];
  const n = profile.length;
  for (let i = 0; i < n - 1; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    for (let s = 0; s < segments; s++) {
      const a0 = (s / segments) * Math.PI * 2, a1 = ((s + 1) / segments) * Math.PI * 2;
      const p00 = [Math.cos(a0) * r0, y0, Math.sin(a0) * r0];
      const p01 = [Math.cos(a1) * r0, y0, Math.sin(a1) * r0];
      const p10 = [Math.cos(a0) * r1, y1, Math.sin(a0) * r1];
      const p11 = [Math.cos(a1) * r1, y1, Math.sin(a1) * r1];
      pushTri(out, p00, p01, p11);
      pushTri(out, p00, p11, p10);
    }
  }
  return out;
}

function boxMesh(x0, y0, z0, x1, y1, z1) {
  const out = [];
  const quads = [
    [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
    [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]],
    [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]],
    [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]],
    [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]],
  ];
  for (const q of quads) {
    pushTri(out, q[0], q[1], q[2]);
    pushTri(out, q[0], q[2], q[3]);
  }
  return out;
}

// Extruded silhouette: a 2D outline (x,y) with thickness along z.
function extrude(points, thickness) {
  const out = [];
  const n = points.length;
  const h = thickness / 2;
  for (let i = 0; i < n; i++) {
    const p0 = points[i], p1 = points[(i + 1) % n];
    // side wall
    pushTri(out, [p0[0], p0[1], -h], [p1[0], p1[1], -h], [p1[0], p1[1], h]);
    pushTri(out, [p0[0], p0[1], -h], [p1[0], p1[1], h], [p0[0], p0[1], h]);
  }
  return out;
}

// ---- piece geometry: each type its own recognisable silhouette -------------
function pieceMesh(type) {
  switch (type) {
    case 'p': {   // pawn: base, stem, collar, ball head
      const m = lathe([[0.34, 0], [0.30, 0.05], [0.30, 0.16], [0.16, 0.22], [0.15, 0.42], [0.21, 0.46], [0.15, 0.50]]);
      // ball head as a low-poly sphere
      const cx = 0, cy = 0.60, cz = 0, R = 0.13, seg = 10;
      for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
        const t0 = (i / seg) * Math.PI - Math.PI / 2, t1 = ((i + 1) / seg) * Math.PI - Math.PI / 2;
        const p0 = (j / seg) * Math.PI * 2, p1 = ((j + 1) / seg) * Math.PI * 2;
        const v = (t, p) => [cx + Math.cos(t) * Math.sin(p) * R, cy + Math.sin(t) * R, cz + Math.cos(t) * Math.cos(p) * R];
        pushTri(m, v(t0, p0), v(t0, p1), v(t1, p1));
        pushTri(m, v(t0, p0), v(t1, p1), v(t1, p0));
      }
      return m;
    }
    case 'r': {   // rook: base, body, flared top with battlements
      const m = lathe([[0.36, 0], [0.32, 0.06], [0.24, 0.10], [0.20, 0.48], [0.26, 0.54], [0.28, 0.62], [0.26, 0.68], [0.24, 0.62], [0.22, 0.60]]);
      // battlements: four merlons around the rim
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const x = Math.cos(a) * 0.26, z = Math.sin(a) * 0.26;
        const t = 0.11, h = 0.14;
        m.push(...boxMesh(x - t / 2, 0.60, z - t / 2, x + t / 2, 0.60 + h, z + t / 2));
      }
      return m;
    }
    case 'n': {   // knight: a horse head with muzzle and ears, extruded silhouette
      const outline = [
        [0.00, 0.10], [0.34, 0.08], [0.30, 0.30], [0.24, 0.42], [0.26, 0.52],
        [0.34, 0.62], [0.30, 0.72], [0.18, 0.62], [0.10, 0.68], [0.06, 0.78],
        [-0.02, 0.66], [-0.12, 0.52], [-0.18, 0.34], [-0.14, 0.10],
      ];
      const m = extrude(outline.map(([x, y]) => [x - 0.08, y + 0.02, 0]), 0.16);
      // base cylinder
      m.push(...lathe([[0.34, 0], [0.30, 0.04], [0.28, 0.10], [0.26, 0.12]]));
      return m;
    }
    case 'b': {   // bishop: mitre with a cut and a ball finial
      const m = lathe([[0.34, 0], [0.30, 0.06], [0.26, 0.10], [0.17, 0.16], [0.13, 0.40], [0.19, 0.50], [0.10, 0.62], [0.02, 0.66]]);
      // mitre slit: a thin dark box through the bulb
      m.push(...boxMesh(-0.02, 0.46, -0.02, 0.20, 0.52, 0.02));
      const seg = 8, R = 0.07, cy = 0.74;
      for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
        const t0 = (i / seg) * Math.PI - Math.PI / 2, t1 = ((i + 1) / seg) * Math.PI - Math.PI / 2;
        const p0 = (j / seg) * Math.PI * 2, p1 = ((j + 1) / seg) * Math.PI * 2;
        const v = (t, p) => [Math.cos(t) * Math.sin(p) * R, cy + Math.sin(t) * R, Math.cos(t) * Math.cos(p) * R];
        pushTri(m, v(t0, p0), v(t0, p1), v(t1, p1));
        pushTri(m, v(t0, p0), v(t1, p1), v(t1, p0));
      }
      return m;
    }
    case 'q': {   // queen: coronet with a ring of points, ball finial
      const m = lathe([[0.36, 0], [0.32, 0.06], [0.26, 0.12], [0.16, 0.34], [0.22, 0.44], [0.24, 0.50], [0.10, 0.60], [0.08, 0.66]]);
      // crown of points: eight small balls around the coronet
      const seg = 6, R = 0.055;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const cx = Math.cos(a) * 0.23, cz = Math.sin(a) * 0.23, cy = 0.53;
        for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
          const t0 = (i / seg) * Math.PI - Math.PI / 2, t1 = ((i + 1) / seg) * Math.PI - Math.PI / 2;
          const p0 = (j / seg) * Math.PI * 2, p1 = ((j + 1) / seg) * Math.PI * 2;
          const v = (t, p) => [cx + Math.cos(t) * Math.sin(p) * R, cy + Math.sin(t) * R, cz + Math.cos(t) * Math.cos(p) * R];
          pushTri(m, v(t0, p0), v(t0, p1), v(t1, p1));
          pushTri(m, v(t0, p0), v(t1, p1), v(t1, p0));
        }
      }
      // finial
      const R2 = 0.08, cy2 = 0.78;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        const t0 = (i / 8) * Math.PI - Math.PI / 2, t1 = ((i + 1) / 8) * Math.PI - Math.PI / 2;
        const p0 = (j / 8) * Math.PI * 2, p1 = ((j + 1) / 8) * Math.PI * 2;
        const v = (t, p) => [Math.cos(t) * Math.sin(p) * R2, cy2 + Math.sin(t) * R2, Math.cos(t) * Math.cos(p) * R2];
        pushTri(m, v(t0, p0), v(t0, p1), v(t1, p1));
        pushTri(m, v(t0, p0), v(t1, p1), v(t1, p0));
      }
      return m;
    }
    case 'k': {   // king: orb with a cross on top
      const m = lathe([[0.38, 0], [0.34, 0.06], [0.28, 0.12], [0.18, 0.40], [0.24, 0.52], [0.26, 0.58], [0.12, 0.70], [0.10, 0.78]]);
      // the cross: two boxes
      m.push(...boxMesh(-0.025, 0.78, -0.025, 0.025, 1.02, 0.025));
      m.push(...boxMesh(-0.10, 0.84, -0.025, 0.10, 0.90, 0.025));
      return m;
    }
  }
  return [];
}

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aOffset;
uniform mat4 uProj, uView, uModel;
uniform vec3 uTint;
out vec3 vNormal;
out vec3 vWorld;
out vec3 vTint;
void main() {
  vec4 world = uModel * vec4(aPos + aOffset, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vTint = uTint;
  gl_Position = uProj * uView * world;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in vec3 vTint;
uniform vec3 uLight;
uniform vec3 uEye;
uniform float uAlpha;
out vec4 frag;
void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLight - vWorld);
  float diff = max(dot(N, L), 0.0);
  float amb = 0.34;
  vec3 V = normalize(uEye - vWorld);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 42.0) * 0.5;
  vec3 col = vTint * (amb + diff) + vec3(spec);
  frag = vec4(col, uAlpha);
}`;

const BOARD_VERT = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uProj, uView;
uniform vec2 uCell;
uniform vec3 uColour;
out vec3 vColour;
void main() {
  vColour = uColour;
  gl_Position = uProj * uView * vec4(aPos.x + uCell.x, 0.0, aPos.y + uCell.y, 1.0);
}`;

const BOARD_FRAG = `#version 300 es
precision highp float;
in vec3 vColour;
out vec4 frag;
void main() { frag = vec4(vColour, 1.0); }`;

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}
function mat4LookAt(eye, centre, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
  const z = norm(sub(eye, centre));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1,
  ]);
}
function mat4Identity() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }

// theme colours: light square, dark square (matching the CSS themes)
const THEMES = {
  Walnut: { light: [0.91, 0.86, 0.78], dark: [0.29, 0.20, 0.13] },
  Slate: { light: [0.93, 0.93, 0.93], dark: [0.42, 0.42, 0.44] },
  Ocean: { light: [0.91, 0.93, 0.92], dark: [0.18, 0.29, 0.37] },
  Forest: { light: [0.90, 0.91, 0.85], dark: [0.12, 0.29, 0.18] },
  Neon: { light: [0.93, 0.93, 0.95], dark: [0.29, 0.23, 0.43] },
};

const SETS3D = {
  Marble: { white: [0.93, 0.90, 0.86], black: [0.24, 0.22, 0.20], alpha: 1.0, spec: 0.9 },
  Wood: { white: [0.96, 0.78, 0.55], black: [0.55, 0.36, 0.18], alpha: 1.0, spec: 0.4 },
  Glass: { white: [0.85, 0.92, 0.95], black: [0.35, 0.45, 0.55], alpha: 0.66, spec: 1.0 },
};

export class DeepBoard {
  constructor(canvas, { theme = 'Forest', set3d = 'Marble', viewerColour = 'white', onSelect = null, onSquareClick = null } = {}) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
    if (!this.gl) return;
    this.theme = THEMES[theme] || THEMES.Forest;
    this.set3d = SETS3D[set3d] || SETS3D.Marble;
    this.viewerColour = viewerColour;
    this.yaw = viewerColour === 'white' ? -Math.PI / 2 : Math.PI / 2;
    this.pitch = 0.62;
    this.zoom = 1.0;
    this.pieces = [];          // {square, type, colour, pos:[x,y,z], target:[x,y,z], animStart}
    this.selected = null;
    this.dests = [];
    this.lastMove = null;
    this.onSquareClick = onSquareClick;
    this._build();
    this._bind();
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  _build() {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const link = (vs, fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      return p;
    };
    this.prog = link(VERT, FRAG);
    this.boardProg = link(BOARD_VERT, BOARD_FRAG);
    gl.useProgram(this.prog);
    this.uProj = gl.getUniformLocation(this.prog, 'uProj');
    this.uView = gl.getUniformLocation(this.prog, 'uView');
    this.uModel = gl.getUniformLocation(this.prog, 'uModel');
    this.uLight = gl.getUniformLocation(this.prog, 'uLight');
    this.uEye = gl.getUniformLocation(this.prog, 'uEye');
    this.uTint = gl.getUniformLocation(this.prog, 'uTint');
    this.uAlpha = gl.getUniformLocation(this.prog, 'uAlpha');
    this.buProj = gl.getUniformLocation(this.boardProg, 'uProj');
    this.buView = gl.getUniformLocation(this.boardProg, 'uView');
    this.buCell = gl.getUniformLocation(this.boardProg, 'uCell');
    this.buColour = gl.getUniformLocation(this.boardProg, 'uColour');

    // piece meshes per type
    this.meshes = {};
    for (const t of ['p', 'n', 'b', 'r', 'q', 'k']) {
      const tris = pieceMesh(t);
      // compute flat normals
      const pos = new Float32Array(tris);
      const nrm = new Float32Array(tris.length);
      for (let i = 0; i < tris.length; i += 9) {
        const ax = tris[i+3]-tris[i], ay = tris[i+4]-tris[i+1], az = tris[i+5]-tris[i+2];
        const bx = tris[i+6]-tris[i], by = tris[i+7]-tris[i+1], bz = tris[i+8]-tris[i+2];
        let nx = ay*bz-az*by, ny = az*bx-ax*bz, nz = ax*by-ay*bx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx/=l; ny/=l; nz/=l;
        for (let k = 0; k < 3; k++) { nrm[i+k*3]=nx; nrm[i+k*3+1]=ny; nrm[i+k*3+2]=nz; }
      }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const pb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pb);
      gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const nb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, nb);
      gl.bufferData(gl.ARRAY_BUFFER, nrm, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      // offset attribute comes from a per-piece buffer
      const ob = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, ob);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(2, 1);
      gl.bindVertexArray(null);
      this.meshes[t] = { vao, count: pos.length / 3, offsetBuf: ob };
    }
    // board quad instance mesh
    this.boardVao = gl.createVertexArray();
    gl.bindVertexArray(this.boardVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.05, 0.04, 0.03, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  squareCentre(sq) {
    const f = FILES.indexOf(sq[0]);
    const r = parseInt(sq[1], 10) - 1;
    // board plane spans [-3.5, 3.5]
    return [f - 3.5, 0, r - 3.5];
  }

  setPosition(fen) {
    const pieces = [];
    const rows = fen.split(' ')[0].split('/');
    for (let r = 0; r < 8; r++) {
      const row = rows[7 - r];
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += parseInt(ch, 10); continue; }
        const type = ch.toLowerCase();
        const colour = ch === ch.toUpperCase() ? 'w' : 'b';
        pieces.push({ square: sqName(f, r), type, colour, pos: this.squareCentre(sqName(f, r)), anim: null });
        f++;
      }
    }
    // keep placements for pieces that simply moved; a piece replaced while its
    // travel animation is still running stands on its destination, not its origin
    const prev = this.pieces || [];
    for (const p of pieces) {
      const old = prev.find(o => o.square === p.square && o.type === p.type && o.colour === p.colour);
      if (old) p.pos = old.anim ? old.anim.to : (old.pos || p.pos);
    }
    this.pieces = pieces;
  }

  animateMove(uci) {
    const from = uci.slice(0, 2), to = uci.slice(2, 4);
    const mover = this.pieces.find(p => p.square === to);
    if (!mover) return;
    // find where it came from by geometry
    const start = this.squareCentre(from);
    mover.pos = start;
    mover.anim = { start: performance.now(), dur: 420, to: this.squareCentre(to), from: start, arc: mover.type === 'n' ? 1.4 : 0.55 };
  }

  setSelected(square, dests) {
    this.selected = square;
    this.dests = dests || [];
  }

  setLastMove(uci) {
    this.lastMove = uci;
  }

  _bind() {
    const canvas = this.canvas;
    let dragging = false, lastX = 0, lastY = 0, moved = 0;
    canvas.addEventListener('pointerdown', e => {
      dragging = true; moved = 0;
      lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      this.yaw -= dx * 0.008;
      this.pitch = Math.max(0.18, Math.min(1.35, this.pitch + dy * 0.005));
      lastX = e.clientX; lastY = e.clientY;
    });
    canvas.addEventListener('pointerup', e => {
      dragging = false;
      if (moved < 6 && this.onSquareClick) {
        const sq = this.pickSquare(e);
        if (sq) this.onSquareClick(sq);
      }
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoom = Math.max(0.55, Math.min(2.2, this.zoom * (e.deltaY > 0 ? 1.08 : 0.93)));
    }, { passive: false });
  }

  pickSquare(e) {
    // ray-plane intersection against the board plane (y = 0)
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const eye = this._eye();
    const fov = this._fov();
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const dir = [0, 0, 0];
    // build the ray through the camera basis
    const forward = [0 - eye[0], -eye[1], 0 - eye[2]];
    const fl = Math.hypot(...forward);
    forward[0] /= fl; forward[1] /= fl; forward[2] /= fl;
    const right = [forward[2], 0, -forward[0]];
    const rl = Math.hypot(...right) || 1;
    right[0] /= rl; right[2] /= rl;
    const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
    const tanF = Math.tan(fov / 2);
    dir[0] = forward[0] + right[0] * x * tanF * aspect + up[0] * y * tanF;
    dir[1] = forward[1] + right[1] * x * tanF * aspect + up[1] * y * tanF;
    dir[2] = forward[2] + right[2] * x * tanF * aspect + up[2] * y * tanF;
    if (dir[1] >= -0.001) return null;
    const t = -eye[1] / dir[1];
    const px = eye[0] + dir[0] * t, pz = eye[2] + dir[2] * t;
    const f = Math.round(px + 3.5), r = Math.round(pz + 3.5);
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return sqName(f, r);
  }

  _eye() {
    const dist = 8.6 * this.zoom;
    const cx = 0, cy = 0;
    const eyeY = Math.sin(this.pitch) * dist;
    const horiz = Math.cos(this.pitch) * dist;
    return [cx + Math.cos(this.yaw) * horiz, eyeY, cy + Math.sin(this.yaw) * horiz];
  }

  _fov() { return Math.PI / 4.6; }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(c.clientWidth * dpr));
    const h = Math.max(1, Math.floor(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  _frame(now) {
    const gl = this.gl;
    this.frames = (this.frames || 0) + 1;
    if (!gl) return;
    this.resize();
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const eye = this._eye();
    const proj = mat4Perspective(this._fov(), w / Math.max(1, h), 0.1, 60);
    const view = mat4LookAt(eye, [0, 0, 0], [0, 1, 0]);

    // board squares
    gl.useProgram(this.boardProg);
    gl.uniformMatrix4fv(this.buProj, false, proj);
    gl.uniformMatrix4fv(this.buView, false, view);
    gl.bindVertexArray(this.boardVao);
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const light = (f + r) % 2 === 1;
        const col = light ? this.theme.light : this.theme.dark;
        const name = sqName(f, r);
        let tint = col;
        const isLast = this.lastMove && (this.lastMove.slice(0, 2) === name || this.lastMove.slice(2, 4) === name);
        if (this.selected === name) tint = [col[0] * 0.55 + 0.45, col[1] * 0.55 + 0.40, col[2] * 0.55 + 0.15];
        else if (isLast) tint = [col[0] * 0.8 + 0.2, col[1] * 0.8 + 0.16, col[2] * 0.8 + 0.05];
        gl.uniform3fv(this.buColour, tint);
        gl.uniform2f(this.buCell, f - 3.5, r - 3.5);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
    // legal destination marks: teal discs
    for (const d of this.dests) {
      const c = this.squareCentre(d);
      gl.uniform3fv(this.buColour, [0.18, 0.62, 0.58]);
      gl.uniform2f(this.buCell, c[0], c[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindVertexArray(null);

    // pieces
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.uProj, false, proj);
    gl.uniformMatrix4fv(this.uView, false, view);
    gl.uniformMatrix4fv(this.uModel, false, mat4Identity());
    gl.uniform3fv(this.uLight, new Float32Array([4, 9, 6]));
    gl.uniform3fv(this.uEye, new Float32Array(eye));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const p of this.pieces) {
      const mesh = this.meshes[p.type];
      if (!mesh) continue;
      let offset = p.pos;
      if (p.anim && !reduce) {
        const t = Math.min(1, (now - p.anim.start) / p.anim.dur);
        const ease = t * t * (3 - 2 * t);
        const lift = Math.sin(t * Math.PI) * p.anim.arc;
        offset = [
          p.anim.from[0] + (p.anim.to[0] - p.anim.from[0]) * ease,
          lift,
          p.anim.from[2] + (p.anim.to[2] - p.anim.from[2]) * ease,
        ];
        if (t >= 1) { p.pos = p.anim.to; p.anim = null; offset = p.pos; }
      }
      const col = p.colour === 'w' ? this.set3d.white : this.set3d.black;
      gl.uniform3fv(this.uTint, new Float32Array(col));
      gl.uniform1f(this.uAlpha, this.set3d.alpha);
      gl.bindVertexArray(mesh.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.offsetBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(offset), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      gl.bindVertexArray(null);
    }
    requestAnimationFrame(this._frame);
  }
}
