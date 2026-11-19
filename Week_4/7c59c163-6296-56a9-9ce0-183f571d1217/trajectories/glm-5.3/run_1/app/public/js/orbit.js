const REDUCED = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function mat4Perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}
function mat4LookAt(ex, ey, ez, cx, cy, cz) {
    // Simplified look-at for a camera always pointing at origin with up = +Y.
    let zx = ex - cx, zy = ey - cy, zz = ez - cz;
    const zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl;
    zy /= zl;
    zz /= zl;
    let xx = zz, xy = 0, xz = -zx; // up=(0,1,0) cross z
    const xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl;
    xz /= xl;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    const m = new Float32Array(16);
    m[0] = xx;
    m[1] = yx;
    m[2] = zx;
    m[3] = 0;
    m[4] = xy;
    m[5] = yy;
    m[6] = zy;
    m[7] = 0;
    m[8] = xz;
    m[9] = yz;
    m[10] = zz;
    m[11] = 0;
    m[12] = -(xx * ex + xy * ey + xz * ez);
    m[13] = -(yx * ex + yy * ey + yz * ez);
    m[14] = -(zx * ex + zy * ey + zz * ez);
    m[15] = 1;
    return m;
}
const VS = `
attribute vec3 aPos;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
void main() {
  gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
}
`;
const FS = `
precision mediump float;
uniform vec4 uColor;
void main() {
  gl_FragColor = uColor;
}
`;
function torusGeometry(majorSegments, minorSegments) {
    const verts = [];
    const indices = [];
    const R = 1, r = 0.18;
    for (let i = 0; i <= majorSegments; i += 1) {
        const u = (i / majorSegments) * Math.PI * 2;
        for (let j = 0; j <= minorSegments; j += 1) {
            const v = (j / minorSegments) * Math.PI * 2;
            const cx = Math.cos(u), sx = Math.sin(u);
            const cvo = Math.cos(v), svo = Math.sin(v);
            verts.push((R + r * cvo) * cx, r * svo, (R + r * cvo) * sx);
        }
    }
    for (let i = 0; i < majorSegments; i += 1) {
        for (let j = 0; j < minorSegments; j += 1) {
            const a = i * (minorSegments + 1) + j;
            const b = a + minorSegments + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    return { vertices: new Float32Array(verts), indices: new Uint16Array(indices) };
}
function cylinderGeometry(segments) {
    const verts = [];
    const indices = [];
    for (let i = 0; i <= segments; i += 1) {
        const u = (i / segments) * Math.PI * 2;
        const c = Math.cos(u), s = Math.sin(u);
        verts.push(0.09 * c, -1.6, 0.09 * s);
        verts.push(0.09 * c, 1.6, 0.09 * s);
    }
    for (let i = 0; i < segments; i += 1) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    return { vertices: new Float32Array(verts), indices: new Uint16Array(indices) };
}
export class Orbit {
    canvas;
    gl = null;
    program = null;
    torus = null;
    spindle = null;
    rings = [];
    camera = { elevation: 35, yaw: 0 };
    dragging = false;
    lastX = 0;
    yawTarget = 0;
    book = null;
    canvasWidth = 0;
    canvasHeight = 0;
    raf = 0;
    destroyed = false;
    onHighlight = null;
    constructor(canvas, onHighlight) {
        this.canvas = canvas;
        this.onHighlight = onHighlight;
        const gl = canvas.getContext('webgl', { antialias: true });
        if (!gl)
            return;
        this.gl = gl;
        const vs = this.compile(gl.VERTEX_SHADER, VS);
        const fs = this.compile(gl.FRAGMENT_SHADER, FS);
        if (!vs || !fs)
            return;
        const program = gl.createProgram();
        if (!program)
            return;
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            return;
        this.program = program;
        const torus = torusGeometry(36, 12);
        this.torus = { buffer: this.makeBuffer(torus.vertices), count: torus.indices.length };
        this.setupIndices(torus.indices);
        const cyl = cylinderGeometry(24);
        this.spindle = { buffer: this.makeBuffer(cyl.vertices), count: cyl.indices.length };
        canvas.addEventListener('pointerdown', (e) => {
            this.dragging = true;
            this.lastX = e.clientX;
            canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!this.dragging)
                return;
            const dx = e.clientX - this.lastX;
            this.lastX = e.clientX;
            this.yawTarget = Math.max(-20, Math.min(20, this.yawTarget + dx / 6));
        });
        const end = () => {
            this.dragging = false;
            this.yawTarget = 0;
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('click', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            for (const ring of this.rings) {
                if (Math.abs(ring.x - x) <= Math.max(14, ring.radius) && Math.abs(ring.y - y) <= Math.max(14, ring.radius)) {
                    this.onHighlight?.(ring.level);
                    return;
                }
            }
            this.onHighlight?.(null);
        });
        this.loop();
    }
    indexBuffer = null;
    setupIndices(indices) {
        const gl = this.gl;
        if (!gl)
            return;
        const buf = gl.createBuffer();
        if (!buf)
            return;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        this.indexBuffer = buf;
    }
    makeBuffer(vertices) {
        const gl = this.gl;
        const buf = gl?.createBuffer() ?? null;
        if (!gl || !buf)
            throw new Error('no gl');
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
        return buf;
    }
    compile(type, source) {
        const gl = this.gl;
        if (!gl)
            return null;
        const shader = gl.createShader(type);
        if (!shader)
            return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            return null;
        return shader;
    }
    setBook(book) {
        this.book = book;
        const maxQty = Math.max(1, ...book.asks.map((l) => l.quantity), ...book.bids.map((l) => l.quantity));
        const mid = computeMid(book);
        const levels = [
            ...book.asks.map((l) => ({ key: `ask:${l.price}`, level: l, side: 'ask' })),
            ...book.bids.map((l) => ({ key: `bid:${l.price}`, level: l, side: 'bid' })),
        ];
        const next = [];
        for (const item of levels) {
            const existing = this.rings.find((r) => r.level === item.key);
            const radius = 0.32 + (item.level.quantity / maxQty) * 0.85;
            const distance = Math.abs(mid - item.level.price) / Math.max(1, mid);
            const height = item.side === 'ask' ? 0.25 + distance * 5.5 : -(0.25 + distance * 5.5);
            if (existing && !REDUCED) {
                existing.targetRadius = radius;
                existing.targetHeight = height;
                existing.quantity = item.level.quantity;
                next.push(existing);
            }
            else {
                next.push({
                    level: item.key,
                    x: 0, y: 0, targetX: 0, targetY: 0,
                    radius: REDUCED ? radius : existing?.radius ?? radius,
                    targetRadius: radius,
                    height: REDUCED ? height : existing?.height ?? height,
                    targetHeight: height,
                    quantity: item.level.quantity,
                });
            }
        }
        this.rings = next;
    }
    setElevation(elevation) {
        this.camera.elevation = elevation;
    }
    attrs() {
        const settled = this.rings.every((r) => Math.abs(r.radius - r.targetRadius) <= 0.5 && Math.abs(r.height - r.targetHeight) <= 0.5);
        const rings = this.rings.map((r) => ({
            level: r.level,
            x: Math.round(r.x),
            y: Math.round(r.y),
        }));
        return {
            elevation: this.camera.elevation.toFixed(1),
            yaw: this.camera.yaw.toFixed(1),
            settled: settled ? 'true' : 'false',
            highlight: '',
            rings: JSON.stringify(rings),
        };
    }
    setHighlight(level) {
        if (!level) {
            this.highlight = null;
            return;
        }
        this.highlight = level;
    }
    highlight = null;
    destroy() {
        this.destroyed = true;
        if (this.raf)
            cancelAnimationFrame(this.raf);
    }
    loop = () => {
        if (this.destroyed)
            return;
        this.render();
        this.syncAttributes();
        this.raf = requestAnimationFrame(this.loop);
    };
    syncAttributes() {
        const attrs = this.attrs();
        const c = this.canvas;
        c.setAttribute('data-elevation', attrs.elevation);
        c.setAttribute('data-yaw', attrs.yaw);
        c.setAttribute('data-settled', attrs.settled);
        c.setAttribute('data-highlight', this.highlight ?? '');
        c.setAttribute('data-rings', attrs.rings);
    }
    render() {
        const gl = this.gl;
        const program = this.program;
        if (!gl || !program || !this.torus || !this.spindle)
            return;
        const canvas = this.canvas;
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        this.canvasWidth = canvas.clientWidth;
        this.canvasHeight = canvas.clientHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        if (!REDUCED) {
            for (const ring of this.rings) {
                ring.radius += (ring.targetRadius - ring.radius) * 0.16;
                ring.height += (ring.targetHeight - ring.height) * 0.16;
            }
            this.camera.yaw += (this.yawTarget - this.camera.yaw) * 0.18;
        }
        else {
            for (const ring of this.rings) {
                ring.radius = ring.targetRadius;
                ring.height = ring.targetHeight;
            }
            this.camera.yaw = this.yawTarget;
        }
        const elev = (this.camera.elevation * Math.PI) / 180;
        const yaw = (this.camera.yaw * Math.PI) / 180;
        const dist = 4.6;
        const eyeX = dist * Math.cos(elev) * Math.sin(yaw);
        const eyeY = dist * Math.sin(elev);
        const eyeZ = dist * Math.cos(elev) * Math.cos(yaw);
        const proj = mat4Perspective((45 * Math.PI) / 180, this.canvasWidth / Math.max(1, this.canvasHeight), 0.1, 100);
        const view = mat4LookAt(eyeX, eyeY, eyeZ, 0, 0, 0);
        gl.useProgram(program);
        const projLoc = gl.getUniformLocation(program, 'uProj');
        const viewLoc = gl.getUniformLocation(program, 'uView');
        const modelLoc = gl.getUniformLocation(program, 'uModel');
        const colorLoc = gl.getUniformLocation(program, 'uColor');
        gl.uniformMatrix4fv(projLoc, false, proj);
        gl.uniformMatrix4fv(viewLoc, false, view);
        const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        gl.uniformMatrix4fv(modelLoc, false, identity);
        this.draw(this.spindle, [0.29, 0.33, 0.42, 1]);
        for (const ring of this.rings) {
            const model = new Float32Array([
                ring.radius, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, ring.radius, 0,
                0, ring.height, 0, 1,
            ]);
            gl.uniformMatrix4fv(modelLoc, false, model);
            const isAsk = ring.level.startsWith('ask:');
            const lit = this.highlight === ring.level;
            if (isAsk) {
                gl.uniform4fv(colorLoc, lit ? [0.85, 0.55, 0.5, 1] : [0.73, 0.51, 0.47, 1]);
            }
            else {
                gl.uniform4fv(colorLoc, lit ? [0.5, 0.6, 0.42, 1] : [0.38, 0.48, 0.32, 1]);
            }
            this.draw(this.torus, undefined);
        }
        // Project the ring's near edge point to CSS pixels for data-rings, so a
        // click or tap at that point selects this ring.
        for (const ring of this.rings) {
            const view = mat4LookAt(eyeX, eyeY, eyeZ, 0, 0, 0);
            const vm = multiply(view, new Float32Array([
                ring.radius, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, ring.radius, 0,
                0, ring.height, 0, 1,
            ]));
            const world = new Float32Array([ring.radius, 0, 0, 1]);
            const eye = multiply(vm, world);
            const clip = multiply(proj, eye);
            const w = clip[3];
            if (!w || !Number.isFinite(w) || w === 0) {
                ring.x = this.canvasWidth / 2;
                ring.y = this.canvasHeight / 2;
                continue;
            }
            const ndcX = (clip[0] ?? 0) / w;
            const ndcY = (clip[1] ?? 0) / w;
            ring.x = ((ndcX + 1) / 2) * this.canvasWidth;
            ring.y = ((1 - ndcY) / 2) * this.canvasHeight;
        }
    }
    draw(mesh, _color) {
        const gl = this.gl;
        const program = this.program;
        if (!gl || !program)
            return;
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
        const pos = gl.getAttribLocation(program, 'aPos');
        gl.enableVertexAttribArray(pos);
        gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 0, 0);
        if (this.indexBuffer) {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
            gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
        }
    }
}
function multiply(a, b) {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i += 1) {
        for (let j = 0; j < 4; j += 1) {
            const ai = a[i * 4] ?? 0;
            const ai1 = a[i * 4 + 1] ?? 0;
            const ai2 = a[i * 4 + 2] ?? 0;
            const ai3 = a[i * 4 + 3] ?? 0;
            out[i * 4 + j] = ai * (b[j] ?? 0) + ai1 * (b[4 + j] ?? 0) + ai2 * (b[8 + j] ?? 0) + ai3 * (b[12 + j] ?? 0);
        }
    }
    return out;
}
export function computeMid(book) {
    const bestBid = book.bids[0]?.price ?? 50;
    const bestAsk = book.asks[0]?.price ?? 50;
    return (bestBid + bestAsk) / 2;
}
export function hasWebGL() {
    try {
        const canvas = document.createElement('canvas');
        return Boolean(canvas.getContext('webgl'));
    }
    catch {
        return false;
    }
}
export function prefersReducedMotion() {
    return REDUCED;
}
