// /audit/chain: the ledger as an orbitable lattice, coloured only from the browser's own hashes.

import { ConnectionLost, field, figure, h, reducedMotion, setFigure } from '../core.js';
import { hasWebCrypto } from '../chain.js';
import { openDialog } from '../dialogs.js';
import { NO_WEB_CRYPTO } from '../chain.js';
import { ChainCheck } from './verify.js';

const START = { yaw: 30, pitch: 20 };
const KEY_DEGREES = 5;
const DRAG_DEGREES_PER_PX = 0.5;
const PITCH_LIMIT = 80;
const IDLE_DEGREES_PER_MS = 360 / 50000;
const RESET_MS = 300;
const POLL_MS = 3000;
const FIT_MS = 500;
const SPHERE_MARGIN_PX = 16;
const STILL_NOTICE = '3D view unavailable in this browser. This still frame shows the same verdict and link count.';

const VERTEX_SHADER = `#version 300 es
in vec3 position;
in vec3 color;
uniform mat3 turn;
uniform float reach;
uniform vec2 aspect;
uniform float pointSize;
out vec3 flat_color;
void main() {
  vec3 turned = turn * position;
  gl_Position = vec4(turned.xy * reach * aspect, 0.0, 1.0);
  gl_PointSize = pointSize;
  flat_color = color;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 flat_color;
uniform bool round_point;
out vec4 fragment;
void main() {
  if (round_point && length(gl_PointCoord - vec2(0.5)) > 0.5) discard;
  fragment = vec4(flat_color, 1.0);
}`;

function tokenColour(name) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value.match(/\d+/g).slice(0, 3).map(Number);
}

// Link i of n on one evenly spaced spiral wound pole to pole round a unit sphere, so no two nodes coincide
// and the chain fills the canvas the same way at every camera angle.
function coilPoint(index, total) {
  const polar = Math.acos(1 - (2 * index) / Math.max(total - 1, 1));
  const around = Math.sqrt(Math.PI * total) * polar;
  return [Math.sin(polar) * Math.cos(around), Math.cos(polar), Math.sin(polar) * Math.sin(around)];
}

function turnMatrix(yaw, pitch) {
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  const [cy, sy, cp, sp] = [Math.cos(y), Math.sin(y), Math.cos(p), Math.sin(p)];
  return [
    cy, sy * sp, -sy * cp,
    0, cp, sp,
    sy, -cy * sp, cy * cp,
  ];
}

function nodeSize(total) {
  return Math.min(Math.max(210 / Math.sqrt(Math.max(total, 1)), 3), 10);
}

function compile(gl, kind, source) {
  const shader = gl.createShader(kind);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

// The WebGL2 path. Colours and positions are rebuilt only when the chain changes; a camera move only redraws.
function webglPainter(canvas, palette) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, preserveDrawingBuffer: true });
  if (!gl) return null;
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  gl.useProgram(program);
  const place = gl.getUniformLocation(program, 'turn');
  const reach = gl.getUniformLocation(program, 'reach');
  const aspect = gl.getUniformLocation(program, 'aspect');
  const pointSize = gl.getUniformLocation(program, 'pointSize');
  const roundPoint = gl.getUniformLocation(program, 'round_point');
  const positionAt = gl.getAttribLocation(program, 'position');
  const colorAt = gl.getAttribLocation(program, 'color');
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(positionAt);
  gl.enableVertexAttribArray(colorAt);
  gl.vertexAttribPointer(positionAt, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribPointer(colorAt, 3, gl.FLOAT, false, 24, 12);
  gl.disable(gl.DEPTH_TEST);
  const ground = palette.paper.map((part) => part / 255);
  let edgeVertices = 0;
  let nodeVertices = 0;
  let total = 0;
  return {
    path: 'webgl2',
    setChain(nodes) {
      total = nodes.length;
      const data = new Float32Array((Math.max(total - 1, 0) * 2 + total) * 6);
      let at = 0;
      const put = (node, colour) => {
        data.set(node.point, at);
        data.set(colour.map((part) => part / 255), at + 3);
        at += 6;
      };
      nodes.slice(1).forEach((node, index) => {
        put(nodes[index], node.edge);
        put(node, node.edge);
      });
      edgeVertices = at / 6;
      for (const node of nodes) put(node, node.colour);
      nodeVertices = at / 6 - edgeVertices;
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    },
    draw(yaw, pitch, ratio) {
      const { width, height } = canvas;
      gl.viewport(0, 0, width, height);
      gl.clearColor(ground[0], ground[1], ground[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const radius = Math.min(width, height) / 2 - SPHERE_MARGIN_PX * ratio;
      gl.uniformMatrix3fv(place, false, turnMatrix(yaw, pitch));
      gl.uniform1f(reach, radius);
      gl.uniform2f(aspect, 2 / width, 2 / height);
      gl.uniform1f(pointSize, nodeSize(total) * ratio);
      gl.uniform1i(roundPoint, 0);
      gl.drawArrays(gl.LINES, 0, edgeVertices);
      gl.uniform1i(roundPoint, 1);
      gl.drawArrays(gl.POINTS, edgeVertices, nodeVertices);
    },
  };
}

// The still path: the same projection and colours from the start camera, once.
function stillPainter(canvas, palette) {
  const context = canvas.getContext('2d', { alpha: false });
  let nodes = [];
  const css = (colour) => `rgb(${colour.join(' ')})`;
  return {
    path: 'still',
    setChain(next) {
      nodes = next;
    },
    draw(_yaw, _pitch, ratio) {
      const { width, height } = canvas;
      const matrix = turnMatrix(START.yaw, START.pitch);
      const scale = Math.min(width, height) / 2 - SPHERE_MARGIN_PX * ratio;
      const project = ([x, y, z]) => [
        width / 2 + (matrix[0] * x + matrix[3] * y + matrix[6] * z) * scale,
        height / 2 - (matrix[1] * x + matrix[4] * y + matrix[7] * z) * scale,
      ];
      context.fillStyle = css(palette.paper);
      context.fillRect(0, 0, width, height);
      context.lineWidth = 1;
      nodes.slice(1).forEach((node, index) => {
        context.strokeStyle = css(node.edge);
        context.beginPath();
        context.moveTo(...project(nodes[index].point));
        context.lineTo(...project(node.point));
        context.stroke();
      });
      const radius = (nodeSize(nodes.length) * ratio) / 2;
      for (const node of nodes) {
        const [x, y] = project(node.point);
        context.fillStyle = css(node.colour);
        context.beginPath();
        context.arc(x, y, radius, 0, 2 * Math.PI);
        context.fill();
      }
    },
  };
}

export async function mount(screen, main) {
  const check = new ChainCheck(screen.signal);
  const canHash = hasWebCrypto();
  const palette = { paper: tokenColour('--paper'), ink: tokenColour('--ink'), green: tokenColour('--green'), vermilion: tokenColour('--vermilion') };

  let yaw = START.yaw;
  let pitch = START.pitch;
  let shownYaw = yaw;
  let shownPitch = pitch;
  let idle = !reducedMotion.matches;
  let idleFrame = 0;
  let idleLast = null;
  let glideFrame = 0;
  let drawFrame = 0;
  let drag = null;
  let details = null;

  const verdict = h('div', { role: 'status', 'aria-label': 'Lattice verdict', class: 'lattice-verdict' }, 'Verifying links.');
  const camera = h('div', { role: 'status', 'aria-label': 'Lattice camera', class: 'status-line mono' });
  const readout = h('p', { class: 'mono lattice-readout' });
  const pathNotice = h('div', { role: 'status', 'aria-label': 'Lattice path notice', class: 'status-line' });
  const count = figure('Links', 0);
  const resetButton = h('button', { type: 'button', class: 'btn', onclick: resetView }, 'Reset view');
  const detailsButton = h('button', { type: 'button', class: 'btn', onclick: () => openDetails(detailsButton) }, 'Link details');
  const stage = h('div', {
    class: 'lattice-stage', onkeydown: onCanvasKey, onpointerdown: onDragStart, onpointermove: onDragMove, onpointerup: onDragEnd, onpointercancel: onDragEnd, onfocusin: stopIdle,
  });
  const region = h('section', {
    role: 'region',
    'aria-label': 'Lattice',
    class: 'lattice',
    'data-lattice-state': 'verifying',
    'data-node-count': '0',
    'data-edge-count': '0',
    'data-broken-link': '',
    'data-fault-count': '',
    'data-camera-yaw': String(yaw),
    'data-camera-pitch': String(pitch),
    onkeydown: onShortcut,
  },
  h('div', { class: 'lattice-reading' }, count, verdict, pathNotice),
  stage,
  h('div', { class: 'lattice-controls' }, readout, camera,
    h('div', { class: 'button-row' }, resetButton, detailsButton, h('a', { href: '/ledger', class: 'walk-link' }, 'Chain Walk'))));
  main.className = 'page page-lattice';
  main.replaceChildren(region);
  publishCamera();

  function newCanvas() {
    return h('canvas', { role: 'application', 'aria-label': 'Chain lattice', tabindex: '0', class: 'lattice-canvas' });
  }

  let canvas = newCanvas();
  stage.append(canvas);
  let painter = webglPainter(canvas, palette);
  if (painter) {
    canvas.addEventListener('webglcontextlost', changeToStill);
  } else {
    canvas = replaceCanvas();
    painter = stillPainter(canvas, palette);
    pathNotice.textContent = STILL_NOTICE;
    idle = false;
  }
  region.dataset.latticePath = painter.path;
  region.dataset.idle = String(idle);
  if (!idle) announceCamera();
  if (idle) idleFrame = requestAnimationFrame(idleStep);

  function replaceCanvas() {
    const fresh = newCanvas();
    const hadFocus = document.activeElement === canvas;
    canvas.replaceWith(fresh);
    if (hadFocus) fresh.focus({ preventScroll: true });
    return fresh;
  }

  function changeToStill() {
    if (screen.stopped) return;
    stopIdle();
    cancelAnimationFrame(glideFrame);
    canvas = replaceCanvas();
    painter = stillPainter(canvas, palette);
    region.dataset.latticePath = 'still';
    pathNotice.textContent = STILL_NOTICE;
    rebuild();
  }

  function fit() {
    const ratio = devicePixelRatio;
    const box = canvas.getBoundingClientRect();
    const width = Math.round(box.width * ratio);
    const height = Math.round(box.height * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      drawNow();
    }
  }

  function drawNow() {
    painter.draw(shownYaw, shownPitch, devicePixelRatio);
  }

  function requestDraw() {
    if (drawFrame) return;
    drawFrame = requestAnimationFrame(() => {
      drawFrame = 0;
      drawNow();
    });
  }

  function publishCamera() {
    const wrapped = Math.round((((yaw % 360) + 360) % 360) * 10) / 10;
    region.dataset.cameraYaw = String(wrapped === 360 ? 0 : wrapped);
    region.dataset.cameraPitch = String(Math.round(pitch * 10) / 10);
    readout.textContent = `Yaw ${Math.round(Number(region.dataset.cameraYaw))}, pitch ${Math.round(pitch)}`;
  }

  function announceCamera() {
    const whole = (value) => Math.round(value);
    camera.textContent = `Yaw ${whole(Number(region.dataset.cameraYaw))} degrees, pitch ${whole(pitch)} degrees.`;
  }

  function setCamera(nextYaw, nextPitch) {
    cancelAnimationFrame(glideFrame);
    yaw = ((nextYaw % 360) + 360) % 360;
    pitch = Math.min(Math.max(nextPitch, -PITCH_LIMIT), PITCH_LIMIT);
    shownYaw = yaw;
    shownPitch = pitch;
    publishCamera();
    requestDraw();
  }

  function stopIdle() {
    if (!idle) return;
    idle = false;
    cancelAnimationFrame(idleFrame);
    region.dataset.idle = 'false';
  }

  function idleStep(now) {
    if (reducedMotion.matches) {
      stopIdle();
      return;
    }
    const elapsed = idleLast === null ? 0 : now - idleLast;
    idleLast = now;
    setCamera(yaw + elapsed * IDLE_DEGREES_PER_MS, pitch);
    idleFrame = requestAnimationFrame(idleStep);
  }

  function resetView() {
    stopIdle();
    if (painter.path === 'still') return;
    const fromYaw = shownYaw;
    const fromPitch = shownPitch;
    const turn = ((START.yaw - fromYaw + 540) % 360) - 180;
    yaw = START.yaw;
    pitch = START.pitch;
    publishCamera();
    announceCamera();
    cancelAnimationFrame(glideFrame);
    if (reducedMotion.matches) {
      shownYaw = yaw;
      shownPitch = pitch;
      requestDraw();
      return;
    }
    const started = performance.now();
    const glide = (now) => {
      const progress = Math.min(Math.max(now - started, 0) / RESET_MS, 1);
      const eased = 1 - (1 - progress) ** 4;
      shownYaw = fromYaw + turn * eased;
      shownPitch = fromPitch + (START.pitch - fromPitch) * eased;
      drawNow();
      if (progress < 1) glideFrame = requestAnimationFrame(glide);
    };
    glideFrame = requestAnimationFrame(glide);
  }

  function onCanvasKey(event) {
    const turn = { ArrowRight: [KEY_DEGREES, 0], ArrowLeft: [-KEY_DEGREES, 0], ArrowUp: [0, KEY_DEGREES], ArrowDown: [0, -KEY_DEGREES] }[event.key];
    if (!turn) return;
    event.preventDefault();
    stopIdle();
    if (painter.path === 'still') return;
    setCamera(yaw + turn[0], pitch + turn[1]);
    announceCamera();
  }

  function onDragStart(event) {
    if (event.button) return;
    stopIdle();
    if (painter.path === 'still') return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, yaw, pitch };
  }

  function onDragMove(event) {
    if (!drag) return;
    setCamera(drag.yaw + (event.clientX - drag.x) * DRAG_DEGREES_PER_PX, drag.pitch + (event.clientY - drag.y) * DRAG_DEGREES_PER_PX);
  }

  function onDragEnd() {
    if (!drag) return;
    drag = null;
    announceCamera();
  }

  function onShortcut(event) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 'r') {
      event.preventDefault();
      resetView();
    } else if (key === 'd') {
      event.preventDefault();
      openDetails(event.target);
    }
  }

  function linkVerdict(text) {
    const typed = text.trim();
    if (!/^[0-9]+$/.test(typed)) return 'Enter a link number.';
    const link = Number(typed);
    const state = check.stateOf(link);
    if (state === 'break') return `Link ${link}: break.`;
    if (link < 1 || link > check.count) return `There is no link ${link} in this chain.`;
    if (state === 'fault') return `Link ${link}: in fault.`;
    if (state === 'verified') return `Link ${link}: verified.`;
    return verdict.textContent;
  }

  function openDetails(opener) {
    if (details && !details.closed) return;
    const number = h('input', { type: 'text', class: 'identifier', inputmode: 'numeric', autocomplete: 'off', value: String(check.fault?.link ?? check.count) });
    const status = h('div', { role: 'status', 'aria-label': 'Link details status', class: 'status-line' });
    const show = (event) => {
      event.preventDefault();
      status.textContent = linkVerdict(number.value);
    };
    details = openDialog({
      name: 'Link details',
      opener,
      content: h('form', { class: 'stack', novalidate: true, onsubmit: show },
        field('Link number', number),
        h('div', { class: 'button-row' },
          h('button', { type: 'submit', class: 'btn' }, 'Show link'),
          h('button', { type: 'button', class: 'btn', onclick: () => details.close() }, 'Close details')),
        status),
    });
    number.focus();
    number.select();
  }

  function nodeColour(link) {
    const state = canHash ? check.stateOf(link) : 'unverified';
    if (state === 'verified') return palette.green;
    return state === 'unverified' ? palette.ink : palette.vermilion;
  }

  function rebuild() {
    const nodes = Array.from({ length: check.count }, (_, index) => ({
      point: coilPoint(index, check.count),
      colour: nodeColour(index + 1),
    }));
    nodes.forEach((node, index) => {
      if (index === 0) return;
      const before = nodes[index - 1].colour;
      node.edge = before === palette.vermilion && node.colour === palette.vermilion ? palette.vermilion
        : before === palette.green && node.colour === palette.green ? palette.green : palette.ink;
    });
    painter.setChain(nodes);
    fit();
    drawNow();
  }

  function publishChain() {
    const { count: links, fault } = check;
    region.dataset.nodeCount = String(links);
    region.dataset.edgeCount = String(Math.max(links - 1, 0));
    setFigure(count, links);
    if (!canHash) {
      region.dataset.latticeState = 'unverified';
      verdict.textContent = NO_WEB_CRYPTO;
    } else if (fault) {
      const faulted = Math.max(links - (fault.link - 1), 0);
      region.dataset.latticeState = 'broken';
      region.dataset.brokenLink = String(fault.link);
      region.dataset.faultCount = String(faulted);
      verdict.textContent = `Break at link ${fault.link}. ${faulted} links drawn in fault.`;
    } else if (check.verified < links) {
      region.dataset.latticeState = 'verifying';
      verdict.textContent = 'Verifying links.';
    } else {
      region.dataset.latticeState = 'verified';
      verdict.textContent = `All ${links} links verified.`;
    }
    rebuild();
  }

  async function verify() {
    check.loadMemory();
    while (await check.next());
    check.checkEnd();
  }

  async function poll() {
    let before;
    do {
      before = check.rows.length;
      await check.read({ background: true });
    } while (check.rows.length > before && check.rows.length < check.count);
    if (check.rows.length === before && !check.fault) return;
    if (canHash) await verify();
    if (!screen.stopped) publishChain();
  }

  fit();
  drawNow();
  screen.every(FIT_MS, fit, { now: false });
  screen.onCleanup(() => {
    cancelAnimationFrame(idleFrame);
    cancelAnimationFrame(glideFrame);
    cancelAnimationFrame(drawFrame);
    details?.close({ returnFocus: false });
  });

  if (!(await check.open()) || screen.stopped) return;
  region.dataset.nodeCount = String(check.count);
  region.dataset.edgeCount = String(Math.max(check.count - 1, 0));
  setFigure(count, check.count);
  rebuild();
  try {
    if (canHash) await verify();
  } catch (error) {
    if (!(error instanceof ConnectionLost) && error.name !== 'AbortError') throw error;
    return;
  }
  if (screen.stopped) return;
  publishChain();
  screen.every(POLL_MS, poll, { now: false });
}
