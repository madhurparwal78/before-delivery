/* Chain lattice: WebGL2 orbit or still frame, same verdict either way (DP-90, DP-91). */
(function () {
  WL.renderLattice = async function (docketEl, inspectorEl) {
    document.title = 'Chain lattice — Wardline';
    docketEl.innerHTML = `
      <div role="region" aria-label="Lattice" id="lattice-region"
           data-lattice-path="webgl2" data-lattice-state="verifying"
           data-node-count="0" data-edge-count="0" data-broken-link=""
           data-fault-count="" data-camera-yaw="30" data-camera-pitch="20" data-idle="false">
        <div class="section-heading">Lattice</div>
        <div id="lattice-layout" style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;padding:24px">
          <div class="lattice-canvas-wrap"><canvas id="lattice-canvas" class="lattice" tabindex="0"
            role="application" aria-label="Chain lattice" style="width:832px;height:560px;max-width:100%"></canvas></div>
          <div style="flex:1 1 300px;min-width:300px;max-width:376px">
            <div role="status" aria-label="Lattice verdict" id="lattice-verdict">Verifying links.</div>
            <div role="status" aria-label="Lattice camera" id="lattice-camera">Yaw 30 degrees, pitch 20 degrees.</div>
            <div role="status" aria-label="Lattice path notice" id="lattice-path"></div>
            <div class="actions-row">
              <button id="reset-view" class="ghost">Reset view</button>
              <button id="link-details" class="ghost">Link details</button>
            </div>
            <a href="/ledger">Chain Walk</a>
          </div>
        </div>
      </div>`;
    inspectorEl.innerHTML = '';

    const region = document.getElementById('lattice-region');
    const canvas = document.getElementById('lattice-canvas');
    const verdictEl = document.getElementById('lattice-verdict');
    const cameraEl = document.getElementById('lattice-camera');
    const pathEl = document.getElementById('lattice-path');

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function applyViewportLayout() {
      const w = window.innerWidth;
      const layout = document.getElementById('lattice-layout');
      if (!layout) return;
      if (w >= 1280) {
        layout.style.flexWrap = 'nowrap';
        layout.style.padding = '24px';
        canvas.style.width = '832px'; canvas.style.height = '560px';
      } else if (w >= 768) {
        layout.style.flexWrap = 'wrap';
        layout.style.padding = '24px';
        canvas.style.width = '720px'; canvas.style.height = '480px';
      } else {
        layout.style.flexWrap = 'wrap';
        layout.style.padding = '16px';
        canvas.style.width = '343px'; canvas.style.height = '343px';
      }
      sizeBackingStore();
    }

    function sizeBackingStore() {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    // ---- read and verify every link (Breaks rule, remembered links included)
    const remembered = WL.readRemembered();
    const entries = [];
    let count = 0;
    const computed = {};
    let breakAt = null;

    async function loadAll() {
      let after = 0;
      while (true) {
        const res = await WL.api('GET', `/api/ledger?after=${after}&limit=1000`);
        if (!res.ok) break;
        count = res.data.count;
        entries.push(...res.data.entries);
        if (!res.data.entries.length || res.data.entries.length < 1000) break;
        after = entries[entries.length - 1].seq;
      }
    }

    async function verifyAll() {
      if (!WL.hasCrypto) {
        region.dataset.latticeState = 'unverified';
        verdictEl.textContent = WL.copy.noCrypto;
        return;
      }
      let prev = WL.ZERO_DIGEST;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const seq = i + 1;
        if (e.seq !== (i === 0 ? 1 : entries[i - 1].seq + 1)) {
          breakAt = entries[i - 1].seq + 1;
          break;
        }
        const canonical = WL.entryCanonical(e);
        const digest = await WL.digestFor(prev, canonical);
        computed[seq] = digest;
        if (e.digest !== digest) { breakAt = seq; break; }
        if (e.prev_digest !== prev) { breakAt = seq; break; }
        const rem = remembered[seq];
        if (rem && rem !== digest) { breakAt = seq; break; }
        prev = digest;
      }
      const beyond = Object.keys(remembered).map(Number).filter((s) => s > entries.length && !Number.isNaN(s));
      if (!breakAt && beyond.length) breakAt = Math.min(...beyond);
      region.dataset.latticeState = breakAt ? 'broken' : 'verified';
      const faultCount = breakAt ? Math.max(0, entries.length - (breakAt - 1)) : '';
      region.dataset.faultCount = String(faultCount === '' ? '' : faultCount);
      region.dataset.brokenLink = breakAt ? String(breakAt) : '';
      if (breakAt) {
        verdictEl.textContent = `Break at link ${breakAt}. ${faultCount} links drawn in fault.`;
      } else {
        verdictEl.textContent = `All ${entries.length} links verified.`;
      }
    }

    // ---- drawing
    let gl = null;
    let program = null;
    let nodes = [];
    let camera = { yaw: 30, pitch: 20 };
    let idle = !reduced;
    let lastInputAt = 0;

    function nodePositions() {
      const n = entries.length;
      const positions = [];
      for (let i = 0; i < n; i++) {
        const angle = (i / Math.max(1, n)) * Math.PI * 6;
        const y = (i - n / 2) * 0.2;
        positions.push([Math.cos(angle) * 2, y, Math.sin(angle) * 2]);
      }
      return positions;
    }

    function cameraText() {
      const yaw = Math.round(((camera.yaw % 360) + 360) % 360);
      const pitch = Math.round(camera.pitch);
      cameraEl.textContent = `Yaw ${yaw} degrees, pitch ${pitch} degrees.`;
      region.dataset.cameraYaw = String(Math.round(((camera.yaw % 360) + 360) % 360 * 10) / 10);
      region.dataset.cameraPitch = String(Math.round(camera.pitch * 10) / 10);
    }

    function drawStill() {
      const ctx = canvas.getContext('2d');
      region.dataset.latticePath = 'still';
      pathEl.textContent = '3D view unavailable in this browser. This still frame shows the same verdict and link count.';
      sizeBackingStore();
      ctx.fillStyle = 'rgb(241, 238, 230)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const positions = nodePositions();
      const cx = canvas.width / 2, cy = canvas.height / 2;
      const scale = Math.min(canvas.width, canvas.height) / (positions.length ? Math.max(6, positions.length * 0.35) : 6);
      const pts = positions.map(([x, y, z]) => [cx + x * scale, cy + y * scale * 0.5]);
      for (let i = 1; i < pts.length; i++) {
        ctx.strokeStyle = colourFor(i, true);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
        ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
      for (let i = 0; i < pts.length; i++) {
        ctx.fillStyle = colourFor(i, false);
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function colourFor(index, edge) {
      const INK = 'rgb(20,20,15)';
      const GREEN = 'rgb(31,92,69)';
      const VERMILION = 'rgb(200,50,26)';
      const seq = index + 1;
      if (breakAt && seq >= breakAt) return VERMILION;
      if (computed[seq]) return GREEN;
      return INK;
    }

    function initGL() {
      gl = canvas.getContext('webgl2', { antialias: true });
      if (!gl) { drawStill(); return false; }
      region.dataset.latticePath = 'webgl2';
      const vs = `#version 300 es
        in vec3 aPos; in vec3 aCol;
        uniform mat4 uMvp; uniform float uSize;
        void main() { gl_Position = uMvp * vec4(aPos, 1.0); gl_PointSize = uSize; }`;
      const fs = `#version 300 es
        precision mediump float; in vec3 aCol; out vec4 frag;
        void main() { frag = vec4(aCol, 1.0); }`;
      function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        return s;
      }
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(program);
      gl.useProgram(program);
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        setTimeout(() => { initGL(); if (!gl) drawStill(); }, 500);
      });
      return true;
    }

    function mvp() {
      const yawR = camera.yaw * Math.PI / 180;
      const pitchR = camera.pitch * Math.PI / 180;
      const cy = Math.cos(yawR), sy = Math.sin(yawR);
      const cp = Math.cos(pitchR), sp = Math.sin(pitchR);
      // simple look-at from a fixed radius
      const r = Math.max(6, entries.length * 0.4);
      const eye = [r * cp * sy, r * sp, r * cp * cy];
      const f = normalize([-eye[0], -eye[1], -eye[2]]);
      const up = [0, 1, 0];
      const s = normalize(cross(f, up));
      const u = cross(s, f);
      const view = [
        s[0], u[0], -f[0], 0,
        s[1], u[1], -f[1], 0,
        s[2], u[2], -f[2], 0,
        -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
      ];
      const fov = Math.PI / 4;
      const aspect = canvas.width / Math.max(1, canvas.height);
      const near = 0.1, far = 1000;
      const t = 1 / Math.tan(fov / 2);
      const proj = [
        t / aspect, 0, 0, 0,
        0, t, 0, 0,
        0, 0, (far + near) / (near - far), -1,
        0, 0, 2 * far * near / (near - far), 0,
      ];
      return multiply(proj, view);
    }

    function normalize(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
    function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
    function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
    function multiply(a, b) {
      const out = new Array(16).fill(0);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + j] * b[i * 4 + k];
        out[i * 4 + j] = sum;
      }
      return out;
    }

    function drawGL() {
      sizeBackingStore();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(241 / 255, 238 / 255, 230 / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const positions = nodePositions();
      if (!positions.length) return;
      // nodes + edges in one buffer
      const verts = [];
      const cols = [];
      const ink = [20/255, 20/255, 15/255];
      const green = [31/255, 92/255, 69/255];
      const verm = [200/255, 50/255, 26/255];
      for (let i = 0; i < positions.length; i++) {
        const seq = i + 1;
        let col = computed[seq] ? green : ink;
        if (breakAt && seq >= breakAt) col = verm;
        verts.push(...positions[i]); cols.push(...col);
      }
      const edgeVerts = [];
      const edgeCols = [];
      for (let i = 1; i < positions.length; i++) {
        const seq = i + 1;
        let col = computed[seq] ? green : ink;
        if (breakAt && seq >= breakAt) col = verm;
        edgeVerts.push(...positions[i - 1], ...positions[i]);
        edgeCols.push(...col, ...col);
      }
      const uMvp = mvp();
      const mvpLoc = gl.getUniformLocation(program, 'uMvp');
      const sizeLoc = gl.getUniformLocation(program, 'uSize');
      const posLoc = gl.getAttribLocation(program, 'aPos');
      const colLoc = gl.getAttribLocation(program, 'aCol');

      function upload(vs, cs, mode, count, size) {
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vs), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
        const cbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, cbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cs), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(colLoc);
        gl.vertexAttribPointer(colLoc, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(mvpLoc, false, new Float32Array(uMvp));
        gl.uniform1f(sizeLoc, size);
        gl.drawArrays(mode, 0, count);
      }
      if (edgeVerts.length) upload(edgeVerts, edgeCols, gl.LINES, edgeVerts.length / 3, 1.0);
      upload(verts, cols, gl.POINTS, verts.length / 3, 4.0);
    }

    let rafId = null;
    function frame() {
      if (idle && !reduced) {
        camera.yaw = (camera.yaw + 0.09) % 360;
        region.dataset.cameraYaw = String(Math.round(((camera.yaw % 360) + 360) % 360 * 10) / 10);
      }
      if (gl) drawGL();
      rafId = requestAnimationFrame(frame);
    }

    function stopIdle() {
      idle = false;
      region.dataset.idle = 'false';
    }

    // camera inputs
    canvas.addEventListener('focus', stopIdle);
    canvas.addEventListener('pointerdown', (e) => {
      stopIdle();
      const startX = e.clientX, startY = e.clientY;
      const start = { yaw: camera.yaw, pitch: camera.pitch };
      const move = (ev) => {
        camera.yaw = start.yaw + (ev.clientX - startX) * 0.5;
        camera.pitch = Math.max(-80, Math.min(80, start.pitch + (ev.clientY - startY) * 0.5));
        cameraText();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    canvas.addEventListener('keydown', (e) => {
      stopIdle();
      if (e.key === 'ArrowRight') camera.yaw += 5;
      else if (e.key === 'ArrowLeft') camera.yaw -= 5;
      else if (e.key === 'ArrowUp') camera.pitch = Math.min(80, camera.pitch + 5);
      else if (e.key === 'ArrowDown') camera.pitch = Math.max(-80, camera.pitch - 5);
      else if (e.key === 'r' || e.key === 'R') { if (!e.ctrlKey && !e.altKey && !e.metaKey) resetView(); }
      else if (e.key === 'd' || e.key === 'D') { if (!e.ctrlKey && !e.altKey && !e.metaKey) linkDetails(); }
      else return;
      e.preventDefault();
      cameraText();
    });
    region.addEventListener('keydown', (e) => {
      if (document.activeElement === canvas) return;
      if (e.key === 'r' || e.key === 'R') { if (!e.ctrlKey && !e.altKey && !e.metaKey) resetView(); }
      else if (e.key === 'd' || e.key === 'D') { if (!e.ctrlKey && !e.altKey && !e.metaKey) linkDetails(); }
    });

    function resetView() {
      camera = { yaw: 30, pitch: 20 };
      cameraText();
    }
    document.getElementById('reset-view').addEventListener('click', () => { stopIdle(); resetView(); });

    function linkDetails() {
      const start = breakAt || entries.length;
      const dlg = WL.dialog.open({
        name: 'Link details',
        build: (form) => {
          form.innerHTML = `
            <label class="field-label">Link number</label>
            <input type="text" name="link" aria-label="Link number" value="${start}">
            <div class="actions-row">
              <button type="button" data-show>Show link</button>
            </div>
            <div role="status" aria-label="Link details status"></div>`;
          const status = form.querySelector('[role="status"]');
          form.querySelector('[data-show]').addEventListener('click', () => {
            const raw = form.querySelector('input[name="link"]').value.trim();
            if (!/^\d+$/.test(raw)) { status.textContent = 'Enter a link number.'; return; }
            const n = parseInt(raw, 10);
            if (n < 1 || n > entries.length) {
              status.textContent = `There is no link ${n} in this chain.`;
              return;
            }
            if (breakAt && n >= breakAt) status.textContent = n === breakAt ? `Link ${n}: break.` : `Link ${n}: in fault.`;
            else status.textContent = `Link ${n}: verified.`;
          });
        },
        firstFocus: 'input[name="link"]',
      });
    }
    document.getElementById('link-details').addEventListener('click', linkDetails);

    window.addEventListener('resize', applyViewportLayout);

    await loadAll();
    region.dataset.nodeCount = String(count);
    region.dataset.edgeCount = String(Math.max(0, count - 1));
    applyViewportLayout();
    await verifyAll();
    region.dataset.idle = String(idle && !reduced);
    if (WL.hasCrypto && initGL()) {
      cameraText();
      frame();
    } else {
      drawStill();
    }
    if (!WL.hasCrypto) pathEl.textContent = '';
  };
})();
