// Smoke-runs the built client bundle with a minimal DOM, to catch load-time
// errors without a browser.
const fs = require('node:fs');

const code = fs.readFileSync('/tmp/client-check.js', 'utf8');

const fakeElement = () => {
  const el = {
    children: [],
    style: {},
    dataset: {},
    attributes: {},
    tagName: 'DIV',
    append(...n) {
      for (const x of n) {
        x.parentNode = this;
        this.children.push(x);
      }
    },
    appendChild(n) {
      this.children.push(n);
      return n;
    },
    insertBefore(n, ref) {
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i >= 0) this.children.splice(i, 0, n);
      else this.children.push(n);
      return n;
    },
    replaceWith(n) {
      if (this.parentNode) {
        const i = this.parentNode.children.indexOf(this);
        if (i >= 0) this.parentNode.children[i] = n;
      }
      n.parentNode = this.parentNode;
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    setAttribute(k, v) {
      this.attributes[k] = v;
    },
    getAttribute(k) {
      return this.attributes[k] ?? null;
    },
    addEventListener() {},
    removeEventListener() {},
    remove() {},
    focus() {},
    click() {},
    textContent: '',
    className: '',
    href: '',
    value: '',
    checked: false,
    selected: false,
    parentNode: null,
    parentElement: null,
    firstChild: null,
    firstElementChild: null,
    lastChild: null,
    scrollHeight: 100,
    clientWidth: 800,
    clientHeight: 600,
    innerHTML: '',
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, bottom: 600, right: 800 }),
    querySelector: () => null,
    querySelectorAll: () => [],
    contains: () => false,
    classList: { add() {}, remove() {} },
    getContext: (kind) => (kind === '2d' ? fake2dContext() : null),
    dispatchEvent() {},
    close() {},
    showModal() {},
  };
  return el;
};

globalThis.document = {
  createElement: (tag) => {
    const e = fakeElement();
    e.tagName = tag.toUpperCase();
    return e;
  },
  createElementNS: () => {
    const e = fakeElement();
    e.setAttribute = (k, v) => {
      e.attributes[k] = v;
    };
    return e;
  },
  createTextNode: (t) => ({ text: t }),
  getElementById: () => {
    const e = fakeElement();
    e.id = 'app';
    return e;
  },
  body: fakeElement(),
  addEventListener() {},
};

globalThis.window = {
  location: { pathname: process.env.CLIENT_ROUTE ?? '/', protocol: 'http:', host: '127.0.0.1:4173', search: '', href: 'http://127.0.0.1:4173/' },
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => undefined,
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 800,
  scrollY: 0,
  setTimeout,
};
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => undefined;
globalThis.CustomEvent = class {
  constructor(type, opts) {
    this.type = type;
    this.detail = opts?.detail;
  }
};
globalThis.WebSocket = class {
  constructor() {
    this.readyState = 0;
    this.OPEN = 1;
  }
  addEventListener() {}
  send() {}
};
globalThis.fetch = async (url) => {
  const path = String(url);
  if (path === '/api/me') {
    return {
      ok: true,
      status: 200,
      json: async () => ({ user: { id: 'u1', name: 'Ines Okafor', email: 'ines@lumenyard.test' }, workspaces: [{ id: 'ws1', name: 'Lumen Yard', role: 'owner' }] }),
    };
  }
  if (path === '/icons.json') return { ok: true, json: async () => ({}) };
  if (path.startsWith('/api/projects/') && !path.includes('/')) {
    return { ok: false, status: 404, text: async () => '', json: async () => ({}), headers: { get: () => null } };
  }
  if (path.startsWith('/api/embed/')) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  if (path === '/api/projects/prj_editor') {
    const doc = {
      project: { id: 'prj_editor', name: 'Lumen hero', workspaceId: 'ws1', status: 'active', role: 'Owner', layerCount: 4, liveVersion: null, editorCount: 1, viewerCount: 1, trashedAt: null, purgeAt: null },
      document: {
        schemaVersion: 3,
        name: 'Lumen hero',
        variables: [],
        presets: [],
        scenes: [{
          id: 'scn1',
          name: 'Main',
          background: '#0B0B0E',
          environment: 'Flat',
          durationMs: 5000,
          camera: { fov: 50, position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 }, near: 0.1, far: 100 },
          orbit: { enabled: true, startAngle: 0, endAngle: 90 },
          light: { enabled: true, sensitivity: 1, momentum: 1 },
          layers: [
            {
              id: 'lay1', name: 'Halo cube', kind: 'Primitive', parentId: null, order: 0,
              visible: true, locked: false, maskAbove: false, blendMode: 'Normal',
              props: {
                primitive: 'Cube',
                position: { x: 1, y: 2, z: 0 },
                rotation: { x: 0, y: 45, z: 0 },
                scale: { x: 2, y: 1, z: 1 },
                material: { kind: 'Matcap', matcap: 'Clay', color: '#FFFFFF', opacity: 1, refraction: 1, backFaceRefraction: false },
                depthTest: true, faces: 'front',
              },
              overrides: { tablet: { 'rotation.y': 30 }, mobile: {} },
              keyframes: [{ property: 'rotation.y', frame: 0, value: 0, easing: 'ease-out' }, { property: 'rotation.y', frame: 60, value: 90, easing: 'linear' }],
              events: { tilt: { enabled: true, maxTilt: 12, sensitivity: 1, momentum: 1 } },
              bindings: {},
            },
          ],
        }],
      },
      assets: [],
    };
    return { ok: true, status: 200, json: async () => doc, text: async () => JSON.stringify(doc), headers: { get: () => null } };
  }
  if (path === '/api/projects/prj_editor/members' || path === '/api/projects/prj_editor/versions') {
    return { ok: true, status: 200, json: async () => ({ members: [], invites: [], versions: [] }), headers: { get: () => null } };
  }
  return { ok: false, status: 404, text: async () => '', json: async () => ({}), headers: { get: () => null } };
};
globalThis.FormData = class FormData {};
globalThis.Blob = class Blob {};

function fake2dContext() {
  const grad = { addColorStop() {} };
  return {
    setTransform() {},
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    closePath() {},
    fill() {},
    stroke() {},
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    canvas: { width: 300, height: 150 },
  };
}
globalThis.Intl = globalThis.Intl ?? { DateTimeFormat: class { format() { return ''; } } };

try {
  new Function(code)();
  console.log('client bundle executed without throwing');
} catch (e) {
  console.error('CLIENT ERROR:', e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e);
  process.exit(1);
}
