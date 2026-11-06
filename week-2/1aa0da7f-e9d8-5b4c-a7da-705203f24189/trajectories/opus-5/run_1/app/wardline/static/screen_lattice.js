/** The chain lattice: one node per link, orbited in WebGL2 or drawn as a still frame. */

import { get } from './api.js';
import { hasCrypto, ZERO_DIGEST } from './canon.js';
import { linkVerdict } from './chain.js';
import { announce, clear, el, reducedMotion } from './dom.js';
import { openDialog } from './dialog.js';

const INK = [20 / 255, 20 / 255, 15 / 255];
const GREEN = [31 / 255, 92 / 255, 69 / 255];
const VERMILION = [200 / 255, 50 / 255, 26 / 255];
const PAPER = [241 / 255, 238 / 255, 230 / 255];
const START_YAW = 30;
const START_PITCH = 20;
const IDLE_DEGREES_PER_SECOND = 360 / 50;
const NO_CRYPTO =
  'Cannot verify in this browser. Open Wardline over HTTPS or on this machine.';
const STORE_KEY = 'wardline-walk';

const VERTEX = `#version 300 es
in vec2 spot;
in vec3 tone;
uniform float pointSize;
out vec3 shade;
void main() {
  shade = tone;
  gl_Position = vec4(spot, 0.0, 1.0);
  gl_PointSize = pointSize;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 shade;
out vec4 colour;
void main() {
  colour = vec4(shade, 1.0);
}`;

function canvasSize(width) {
  if (width >= 1200) return { width: 832, height: 560 };
  if (width >= 768) return { width: 720, height: 480 };
  return { width: 343, height: 343 };
}

function memory() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}');
    return { high: parsed.high || 0, digest: parsed.digest || null, anchors: parsed.anchors || {} };
  } catch (error) {
    return { high: 0, digest: null, anchors: {} };
  }
}

export default {
  async mount(context) {
    const host = context.page;
    const remembered = memory();
    const figure = el('span', { dataset: { figure: 'true' }, text: '0' });
    const verdict = el('p', {
      role: 'status',
      'aria-label': 'Lattice verdict',
      'aria-live': 'polite',
      text: 'Verifying links.',
    });
    const cameraStatus = el('p', {
      role: 'status',
      'aria-label': 'Lattice camera',
      'aria-live': 'polite',
    });
    const pathNotice = el('p', {
      role: 'status',
      'aria-label': 'Lattice path notice',
      'aria-live': 'polite',
    });
    const size = canvasSize(window.innerWidth);
    const canvas = el('canvas', {
      role: 'application',
      'aria-label': 'Chain lattice',
      tabIndex: 0,
      width: size.width,
      height: size.height,
      style: `width:${size.width}px;height:${size.height}px`,
    });
    const reset = el('button', {
      type: 'button',
      text: 'Reset view',
      on: { click: () => resetView() },
    });
    const detailsButton = el('button', {
      type: 'button',
      text: 'Link details',
      on: { click: () => openDetails() },
    });
    const side = el('div', { class: 'lattice-side' }, [
      verdict,
      cameraStatus,
      pathNotice,
      reset,
      detailsButton,
      el('a', { href: '/ledger', 'data-route': 'true', text: 'Chain Walk' }),
    ]);
    const row = el('div', { class: 'lattice-row' }, [canvas, side]);
    const region = el(
      'section',
      {
        role: 'region',
        'aria-label': 'Lattice',
        dataset: {
          latticePath: 'still',
          latticeState: 'verifying',
          nodeCount: '0',
          edgeCount: '0',
          brokenLink: '',
          faultCount: '',
          cameraYaw: String(START_YAW),
          cameraPitch: String(START_PITCH),
          idle: 'false',
        },
      },
      [
        figure,
        el('span', { dataset: { figureLabel: 'true' }, text: 'Links' }),
        el('h1', { text: 'Chain lattice' }),
        row,
      ]
    );
    host.append(region);

    let rows = [];
    let count = 0;
    let verified = 0;
    let brokenAt = null;
    let yaw = START_YAW;
    let pitch = START_PITCH;
    let idle = !reducedMotion();
    let idleFrame = null;
    let lastIdle = performance.now();
    let gl = null;
    let program = null;
    let buffers = null;
    let disposed = false;
    let restTimer = null;

    function layoutByWidth() {
      const next = canvasSize(window.innerWidth);
      canvas.style.width = next.width + 'px';
      canvas.style.height = next.height + 'px';
      if (window.innerWidth >= 1200) {
        row.className = 'lattice-row';
        if (row.firstChild !== canvas) row.prepend(canvas);
      } else {
        row.className = 'lattice-stack';
        if (window.innerWidth < 768 && row.firstChild !== side) row.prepend(side);
        if (window.innerWidth >= 768 && row.firstChild !== canvas) row.prepend(canvas);
      }
      fixBackingStore();
    }

    function fixBackingStore() {
      const ratio = window.devicePixelRatio || 1;
      const box = canvas.getBoundingClientRect();
      const width = Math.round(box.width * ratio);
      const height = Math.round(box.height * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      draw();
    }

    function startWebgl() {
      gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
      if (!gl) {
        region.dataset.latticePath = 'still';
        announce(
          pathNotice,
          '3D view unavailable in this browser. This still frame shows the same verdict and link count.'
        );
        return false;
      }
      const vertex = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vertex, VERTEX);
      gl.compileShader(vertex);
      const fragment = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fragment, FRAGMENT);
      gl.compileShader(fragment);
      program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      buffers = { spot: gl.createBuffer(), tone: gl.createBuffer() };
      region.dataset.latticePath = 'webgl2';
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        gl = null;
        region.dataset.latticePath = 'still';
        announce(
          pathNotice,
          '3D view unavailable in this browser. This still frame shows the same verdict and link count.'
        );
        draw();
      });
      return true;
    }

    function nodeColour(link) {
      if (brokenAt !== null && link >= brokenAt) return VERMILION;
      if (link <= verified) return GREEN;
      return INK;
    }

    function place(link, total) {
      const share = total <= 1 ? 0 : (link - 1) / (total - 1);
      const angle = share * Math.PI * 6;
      return [
        Math.cos(angle) * 0.6,
        share * 2 - 1,
        Math.sin(angle) * 0.6,
      ];
    }

    function project(point) {
      const yawRadians = (yaw * Math.PI) / 180;
      const pitchRadians = (pitch * Math.PI) / 180;
      const [x, y, z] = point;
      const rx = x * Math.cos(yawRadians) + z * Math.sin(yawRadians);
      const rz = -x * Math.sin(yawRadians) + z * Math.cos(yawRadians);
      const ry = y * Math.cos(pitchRadians) - rz * Math.sin(pitchRadians);
      return [rx * 0.5, ry * 0.5];
    }

    function draw() {
      const total = Math.max(0, count);
      if (gl) {
        drawWebgl(total);
        return;
      }
      drawStill(total);
    }

    function drawWebgl(total) {
      const spots = [];
      const tones = [];
      const lineSpots = [];
      const lineTones = [];
      for (let link = 1; link <= total; link += 1) {
        const [x, y] = project(place(link, total));
        const colour = nodeColour(link);
        spots.push(x, y);
        tones.push(...colour);
        if (link > 1) {
          const [px, py] = project(place(link - 1, total));
          const edgeColour =
            brokenAt !== null && link >= brokenAt ? VERMILION : nodeColour(link - 1);
          lineSpots.push(px, py, x, y);
          lineTones.push(...edgeColour, ...edgeColour);
        }
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      const spotIndex = gl.getAttribLocation(program, 'spot');
      const toneIndex = gl.getAttribLocation(program, 'tone');
      const sizeIndex = gl.getUniformLocation(program, 'pointSize');
      const feed = (data, index, width) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, index === spotIndex ? buffers.spot : buffers.tone);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
        gl.enableVertexAttribArray(index);
        gl.vertexAttribPointer(index, width, gl.FLOAT, false, 0, 0);
      };
      if (lineSpots.length) {
        feed(lineSpots, spotIndex, 2);
        feed(lineTones, toneIndex, 3);
        gl.uniform1f(sizeIndex, 1);
        gl.drawArrays(gl.LINES, 0, lineSpots.length / 2);
      }
      if (spots.length) {
        feed(spots, spotIndex, 2);
        feed(tones, toneIndex, 3);
        gl.uniform1f(sizeIndex, Math.max(3, 5 * (window.devicePixelRatio || 1)));
        gl.drawArrays(gl.POINTS, 0, spots.length / 2);
      }
    }

    function drawStill(total) {
      const context2d = canvas.getContext('2d');
      if (!context2d) return;
      const ratio = window.devicePixelRatio || 1;
      context2d.setTransform(1, 0, 0, 1, 0, 0);
      context2d.fillStyle = 'rgb(241, 238, 230)';
      context2d.fillRect(0, 0, canvas.width, canvas.height);
      const half = { x: canvas.width / 2, y: canvas.height / 2 };
      const scale = Math.min(canvas.width, canvas.height) / 2;
      const toPixels = (point) => {
        const [x, y] = project(point);
        return [half.x + x * scale, half.y - y * scale];
      };
      const asCss = (colour) =>
        `rgb(${Math.round(colour[0] * 255)}, ${Math.round(colour[1] * 255)}, ${Math.round(
          colour[2] * 255
        )})`;
      context2d.lineWidth = Math.max(1, ratio);
      for (let link = 2; link <= total; link += 1) {
        const [x1, y1] = toPixels(place(link - 1, total));
        const [x2, y2] = toPixels(place(link, total));
        context2d.strokeStyle = asCss(
          brokenAt !== null && link >= brokenAt ? VERMILION : nodeColour(link - 1)
        );
        context2d.beginPath();
        context2d.moveTo(x1, y1);
        context2d.lineTo(x2, y2);
        context2d.stroke();
      }
      const dot = Math.max(3, 5 * ratio);
      for (let link = 1; link <= total; link += 1) {
        const [x, y] = toPixels(place(link, total));
        context2d.fillStyle = asCss(nodeColour(link));
        context2d.fillRect(
          Math.round(x - dot / 2),
          Math.round(y - dot / 2),
          Math.round(dot),
          Math.round(dot)
        );
      }
    }

    function setCamera(nextYaw, nextPitch, announceNow) {
      yaw = ((nextYaw % 360) + 360) % 360;
      pitch = Math.max(-80, Math.min(80, nextPitch));
      region.dataset.cameraYaw = yaw.toFixed(1);
      region.dataset.cameraPitch = pitch.toFixed(1);
      draw();
      if (announceNow) {
        clearTimeout(restTimer);
        restTimer = setTimeout(() => {
          announce(
            cameraStatus,
            `Yaw ${Math.round(yaw)} degrees, pitch ${Math.round(pitch)} degrees.`
          );
        }, 120);
      }
    }

    function stopIdle() {
      if (!idle) return;
      idle = false;
      region.dataset.idle = 'false';
      if (idleFrame) cancelAnimationFrame(idleFrame);
      idleFrame = null;
    }

    function idleStep(now) {
      if (!idle || disposed) return;
      const elapsed = (now - lastIdle) / 1000;
      lastIdle = now;
      setCamera(yaw + IDLE_DEGREES_PER_SECOND * elapsed, pitch, false);
      idleFrame = requestAnimationFrame(idleStep);
    }

    function resetView() {
      stopIdle();
      setCamera(START_YAW, START_PITCH, true);
    }

    canvas.addEventListener('focus', stopIdle);
    canvas.addEventListener('keydown', (event) => {
      const steps = {
        ArrowRight: [5, 0],
        ArrowLeft: [-5, 0],
        ArrowUp: [0, 5],
        ArrowDown: [0, -5],
      };
      if (!(event.key in steps)) return;
      event.preventDefault();
      stopIdle();
      const [dy, dp] = steps[event.key];
      setCamera(yaw + dy, pitch + dp, true);
    });
    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      stopIdle();
      let lastX = event.clientX;
      let lastY = event.clientY;
      const move = (moveEvent) => {
        const dx = moveEvent.clientX - lastX;
        const dy = moveEvent.clientY - lastY;
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        setCamera(yaw + dx * 0.5, pitch + dy * 0.5, true);
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
    });
    region.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const tag = event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        resetView();
      } else if (event.key === 'd' || event.key === 'D') {
        event.preventDefault();
        openDetails();
      }
    });

    function openDetails() {
      const number = el('input', {
        type: 'text',
        'aria-label': 'Link number',
        value: String(brokenAt !== null ? brokenAt : count),
      });
      const detailStatus = el('p', {
        role: 'status',
        'aria-label': 'Link details status',
        'aria-live': 'polite',
      });
      const handle = openDialog({
        label: 'Link details',
        opener: detailsButton,
        build: (node) => {
          node.append(
            el('label', { text: 'Link number' }),
            number,
            el('button', { type: 'button', text: 'Show link', on: { click: show } }),
            detailStatus,
            el('button', {
              type: 'button',
              text: 'Close details',
              on: { click: () => handle.close() },
            })
          );
        },
      });
      number.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          show();
        }
      });
      setTimeout(() => number.focus(), 0);

      function show() {
        const raw = number.value.trim();
        if (!/^\d+$/.test(raw)) {
          announce(detailStatus, 'Enter a link number.');
          return;
        }
        const link = Number(raw);
        if (link < 1 || link > count) {
          announce(detailStatus, `There is no link ${link} in this chain.`);
          return;
        }
        if (brokenAt !== null && link === brokenAt) {
          announce(detailStatus, `Link ${link}: break.`);
          return;
        }
        if (brokenAt !== null && link > brokenAt) {
          announce(detailStatus, `Link ${link}: in fault.`);
          return;
        }
        announce(detailStatus, `Link ${link}: verified.`);
      }
    }

    async function loadAll() {
      rows = [];
      let after = 0;
      for (let page = 0; page < 200; page += 1) {
        const reply = await get(`/api/ledger?after=${after}&limit=1000`, {
          background: true,
        });
        if (reply.status !== 200) return;
        count = reply.body.count;
        if (!reply.body.entries.length) break;
        rows.push(...reply.body.entries);
        after = reply.body.entries[reply.body.entries.length - 1].seq;
        if (rows.length >= count) break;
      }
    }

    async function verify() {
      verified = 0;
      brokenAt = null;
      if (!hasCrypto()) {
        region.dataset.latticeState = 'unverified';
        announce(verdict, NO_CRYPTO);
        return;
      }
      let previousDigest = ZERO_DIGEST;
      let previousSeq = 0;
      for (let link = 1; link <= Math.max(count, rows.length); link += 1) {
        const entry = rows[link - 1];
        const result = await linkVerdict(
          link,
          entry,
          previousSeq,
          previousDigest,
          rememberedFor(link)
        );
        if (result.broken) {
          brokenAt = result.named;
          break;
        }
        verified = link;
        previousDigest = result.digest;
        previousSeq = entry.seq;
      }
      if (brokenAt === null && (remembered.high > count || anchorBeyond())) {
        brokenAt = count + 1;
      }
      applyVerdict();
    }

    function rememberedFor(link) {
      if (remembered.anchors[String(link)]) return remembered.anchors[String(link)];
      if (remembered.high === link && remembered.digest) return remembered.digest;
      return null;
    }

    function anchorBeyond() {
      return Object.keys(remembered.anchors).some((key) => Number(key) > count);
    }

    function applyVerdict() {
      figure.textContent = String(count);
      region.dataset.nodeCount = String(count);
      region.dataset.edgeCount = String(Math.max(0, count - 1));
      if (brokenAt === null) {
        region.dataset.latticeState = 'verified';
        region.dataset.brokenLink = '';
        region.dataset.faultCount = '';
        announce(verdict, `All ${count} links verified.`);
      } else {
        region.dataset.latticeState = 'broken';
        region.dataset.brokenLink = String(brokenAt);
        const faulted = Math.max(0, count - (brokenAt - 1));
        region.dataset.faultCount = String(faulted);
        announce(verdict, `Break at link ${brokenAt}. ${faulted} links drawn in fault.`);
      }
      draw();
    }

    startWebgl();
    layoutByWidth();
    region.dataset.idle = idle ? 'true' : 'false';
    if (idle) {
      lastIdle = performance.now();
      idleFrame = requestAnimationFrame(idleStep);
    }
    await loadAll();
    await verify();

    const onResize = () => layoutByWidth();
    window.addEventListener('resize', onResize);
    const pixelWatch = setInterval(fixBackingStore, 800);

    return {
      refresh: async () => {
        const reply = await get('/api/ledger?after=0&limit=1', { background: true });
        if (reply.status === 200 && reply.body.count !== count) {
          await loadAll();
          await verify();
        }
      },
      dispose: () => {
        disposed = true;
        stopIdle();
        clearInterval(pixelWatch);
        window.removeEventListener('resize', onResize);
      },
    };
  },
};
