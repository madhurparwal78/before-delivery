// Bench chrome: shared element builders and styles.

export const CSS = `
:root {
  --ground: #171a2b;
  --ground-2: #1c2036;
  --surface: #262b45;
  --surface-2: #2d3350;
  --border: #3a4062;
  --border-hi: #4a5178;
  --ink: #eceaf7;
  --muted: #9a98b8;
  --accent: #a5b0f5;
  --accent-ink: #1b2140;
  --go: #7fe0a8;
  --go-ink: #12281c;
  --publish: #cbb8ef;
  --publish-tint: rgba(203,184,239,0.08);
  --warning: #f2dd9a;
  --danger: #f2a3b8;
  --sky: #8fc7ee;
  --grass: #6fae6e;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
  --sans: 'Inter', system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  background: var(--ground);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 13px;
  line-height: 1.4;
  overflow-x: hidden;
}
a { color: var(--accent); }
.app-root { min-height: 100vh; display: flex; flex-direction: column; }
.ground-area { flex: 1; display: flex; flex-direction: column; }

/* toolbar */
.bench-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  width: max-content;
  min-width: 100%;
  padding: 6px 10px;
  background: var(--ground-2);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.bench-toolbar::-webkit-scrollbar { display: none; }
.tb-divider { width: 1px; height: 18px; background: var(--border); flex: 0 0 auto; }
.tb-spacer { flex: 1 0 auto; }

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 2px 9px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.1s, background-color 0.1s, color 0.1s;
}
.chip:hover:not(:disabled) { border-color: var(--border-hi); color: #fff; }
.chip:disabled { opacity: 0.5; cursor: default; }
.chip[aria-pressed="true"], .chip.pressed { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.chip.go { background: var(--go); color: var(--go-ink); border-color: var(--go); }
.chip.publish-chip { color: var(--publish); border-color: rgba(203,184,239,0.4); background: var(--publish-tint); min-height: 26px; }
.chip.locked { opacity: 0.5; }

.account-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: #12141f;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 10px 2px 3px;
  min-height: 26px;
  color: var(--ink);
  cursor: pointer;
  font: inherit;
}
.avatar-disc { width: 18px; height: 18px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; }
.wordmark { color: var(--muted); font-size: 13px; letter-spacing: 0.02em; white-space: nowrap; }

.menu { position: absolute; z-index: 60; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 4px; min-width: 180px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
.menu-item { display: flex; width: 100%; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 4px; background: transparent; border: none; color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
.menu-item:hover { background: var(--surface-2); }

/* dock panels */
.dock-panel {
  background: var(--ground);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.35);
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.dock-panel-head { display: flex; align-items: center; padding: 5px 8px; gap: 6px; }
.panel-title { text-transform: uppercase; font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; color: var(--accent); flex: 1; }
.panel-title::before { content: ''; }
.glyph-btn { background: transparent; border: none; color: var(--muted); font-family: var(--mono); font-size: 12px; cursor: pointer; padding: 1px 4px; border-radius: 4px; }
.glyph-btn:hover { color: var(--ink); background: var(--surface-2); }
.dock-panel-body { padding: 4px 8px 8px; overflow: auto; }

/* rows and fields */
.row { display: flex; align-items: center; gap: 8px; min-height: 26px; padding: 2px 6px; border-radius: 4px; }
.row:hover { background: var(--surface); }
.row.selected { background: rgba(165,176,245,0.10); box-shadow: inset 2px 0 0 var(--accent); }
.row.dim { opacity: 0.5; }
.field-line { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
.field-label { color: var(--muted); min-width: 120px; font-size: 12px; }
input[type="text"], input[type="password"], select, .num-input {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--ink);
  border-radius: 5px;
  padding: 3px 7px;
  font: inherit;
  font-size: 12.5px;
  min-height: 24px;
}
input:focus-visible, select:focus-visible, button:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.field-error { color: var(--danger); font-size: 11.5px; margin: 1px 0 3px; }
input[aria-invalid="true"] { border-color: var(--danger); }

.empty-state, .loading-state { color: var(--muted); text-align: center; padding: 16px 8px; }

/* dialog */
.dialog-backdrop { position: fixed; inset: 0; background: rgba(10,11,20,0.55); display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh; z-index: 100; }
.dialog { background: var(--ground-2); border: 1px solid var(--border); border-radius: 8px; min-width: 320px; max-width: 480px; padding: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
.dialog h2 { margin: 0 0 10px; font-size: 14px; }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }

/* tables */
table.bench { width: 100%; border-collapse: collapse; }
table.bench th { text-align: left; color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 6px; }
table.bench td { padding: 4px 6px; border-top: 1px solid var(--border); }

/* live regions */
.status-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.banner-alert { background: rgba(242,221,154,0.12); border-bottom: 1px solid var(--warning); color: var(--warning); padding: 5px 10px; font-size: 12px; }

/* stage */
.stage-root { position: relative; flex: 1; min-height: 0; overflow: hidden; }
.stage-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.telemetry-card {
  position: absolute; top: 38px; left: 8px; z-index: 20;
  background: rgba(22,26,38,0.88);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 6px 9px;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink);
}
.telemetry-card .fps-go { color: var(--go); }
.telemetry-card .fps-warn { color: var(--warning); }
.telemetry-card .fps-bad { color: var(--danger); }
.telemetry-card .expander { position: absolute; top: 2px; right: 4px; }
.mode-pill {
  position: absolute; top: 40px; left: 50%; transform: translateX(-50%); z-index: 25;
  background: #10131e; color: var(--go); border-radius: 999px; padding: 2px 12px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
}
.centre-mark { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; transform: translate(-50%, -50%); z-index: 15; pointer-events: none; }
.centre-mark::before, .centre-mark::after { content: ''; position: absolute; background: rgba(255,255,255,0.55); }
.centre-mark::before { left: 6px; top: 0; width: 2px; height: 14px; }
.centre-mark::after { top: 6px; left: 0; height: 2px; width: 14px; }
.camera-widget { position: absolute; top: 38px; right: 8px; z-index: 20; background: rgba(26,30,46,0.82); border: 1px solid var(--border); border-radius: 7px; padding: 5px; }
.camera-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px; }
.cam-btn { position: relative; background: var(--surface); color: var(--ink); border: 1px solid var(--border); border-radius: 4px; font: inherit; font-size: 11px; padding: 2px 8px; min-height: 22px; cursor: pointer; }
.cam-btn::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; border-radius: 4px 0 0 4px; background: var(--stripe, var(--border)); }
.cam-btn.stripe-y { --stripe: var(--go); }
.cam-btn.stripe-z { --stripe: var(--accent); }
.cam-btn.stripe-x { --stripe: var(--danger); }
.cam-iso { grid-column: 1 / -1; width: 100%; }

.cursor-tag { position: absolute; z-index: 30; pointer-events: none; transform: translate(-3px, -3px); }
.cursor-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 2px rgba(165,176,245,0.35); }
.cursor-name { position: absolute; left: 8px; top: -8px; background: rgba(22,26,38,0.9); border: 1px solid var(--border); border-radius: 4px; padding: 0 5px; font-size: 10.5px; white-space: nowrap; }

/* floating panels layout */
.editor-floating { position: absolute; inset: 0; pointer-events: none; z-index: 10; }
.editor-floating .dock-panel { position: absolute; pointer-events: auto; }
.panel-outline { left: 8px; top: 120px; width: 220px; height: 32%; }
.panel-props { left: 8px; top: calc(120px + 32% + 8px); width: 220px; max-height: calc(100% - 120px - 32% - 16px); }
.panel-inspector { right: 8px; top: 130px; width: 280px; max-height: 55%; }
.panel-assets { left: 236px; right: 296px; bottom: 8px; min-width: 300px; max-height: 30%; }

/* docked layout */
.editor-docked { position: absolute; top: 36px; right: 0; bottom: 0; width: 40%; z-index: 10; display: flex; flex-direction: column; gap: 6px; padding: 8px; overflow: auto; pointer-events: auto; }
.editor-docked .dock-panel { max-height: none; flex: 0 0 auto; }

/* phone layout */
.editor-phone { position: absolute; left: 0; right: 0; bottom: 0; max-height: 60%; z-index: 12; display: flex; flex-direction: column; pointer-events: auto; }
.phone-tabs { display: flex; gap: 2px; background: var(--ground-2); border-bottom: 1px solid var(--border); padding: 4px; }
.phone-tabs button { flex: 1; min-height: 44px; background: transparent; border: none; color: var(--muted); font: inherit; text-transform: uppercase; font-size: 10.5px; letter-spacing: 0.06em; font-weight: 700; cursor: pointer; border-radius: 4px; }
.phone-tabs button[aria-selected="true"] { color: var(--accent); box-shadow: inset 0 -2px 0 var(--accent); }
.phone-sheet { background: var(--ground); border-top: 1px solid var(--border); overflow: auto; flex: 1; min-height: 0; }

/* tablists (generic) */
.tab-row { display: flex; gap: 12px; border-bottom: 1px solid var(--border); margin-bottom: 6px; }
.tab-row button { background: transparent; border: none; color: var(--muted); font: inherit; text-size-adjust: none; font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 4px 2px; cursor: pointer; }
.tab-row button[aria-selected="true"] { color: var(--accent); box-shadow: inset 0 -2px 0 var(--accent); }

/* tiles */
.tile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.tile { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; font: inherit; color: var(--ink); }
.tile:hover { border-color: var(--accent); }
.tile-glyph { font-family: var(--mono); font-size: 16px; color: var(--accent); }
.tile-label { font-size: 11px; }

/* readouts */
.readout-rows { font-family: var(--mono); font-size: 11.5px; color: var(--ink); }
.readout-rows .unit { color: var(--muted); }

/* landing */
.landing-section { min-height: 1000px; position: relative; z-index: 2; }
.landing-copy { max-width: 420px; background: rgba(23,26,43,0.88); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
.landing-name { position: absolute; left: 4vw; bottom: 6vh; font-size: min(14vw, 210px); font-weight: 800; color: #fff; text-shadow: 0 2px 40px rgba(0,0,0,0.25); margin: 0; line-height: 0.95; z-index: 3; }

/* touch sizing */
@media (pointer: coarse) {
  .chip, .chip.publish-chip, .bench-toolbar button, .bench-toolbar a, .glyph-btn, .cam-btn, input[type="text"], input[type="password"], input[type="search"], input[type="range"], select, .num-input, .row, .tile, .menu-item, button { min-height: 44px; min-width: 44px; }
  input[type="range"] { accent-color: var(--accent); }
  .telemetry-card .expander { min-height: 44px; min-width: 44px; }
}
@media (max-width: 599px) {
  .chip, .chip.publish-chip, .bench-toolbar button, .bench-toolbar a, .glyph-btn, .cam-btn, input[type="text"], input[type="password"], input[type="search"], input[type="range"], select, .num-input, .row, .tile, .menu-item { min-height: 44px; min-width: 44px; }
  .telemetry-card .expander { min-height: 44px; min-width: 44px; }
  .bench-toolbar { padding: 6px; }
  .tb-divider { height: 26px; }
  input[type="range"] { accent-color: var(--accent); }
  .field-label { min-width: 100px; }
  table.bench tr { display: block; }
  table.bench td { display: block; border-top: none; }
  table.bench th { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .chip { transition: none; }
}
`;

export function h(tag: string, attrs: Record<string, unknown> = {}, ...children: unknown[]): HTMLElement {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function applyAttrs(el: HTMLElement, attrs: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      el.className = String(value);
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value as Record<string, string>)) {
        el.dataset[dk] = dv;
      }
    } else if (key === 'style') {
      for (const [sk, sv] of Object.entries(value as Record<string, string>)) {
        el.style.setProperty(kebab(sk), sv);
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (key === 'text') {
      el.textContent = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
}

export function focusTrap(el: HTMLElement, onEscape: () => void): (e: KeyboardEvent) => void {
  const handler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = Array.from(el.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((n) => !n.hasAttribute('disabled'));
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  el.addEventListener('keydown', handler);
  return handler;
}

export function chip(label: string, opts: { pressed?: boolean | undefined; disabled?: boolean | undefined; title?: string | undefined; onClick?: (() => void) | undefined; extraClass?: string | undefined } = {}): HTMLButtonElement {
  const btn = h('button', { class: `chip ${opts.extraClass ?? ''}${opts.pressed ? ' pressed' : ''}`, type: 'button', ...(opts.disabled ? { disabled: true } : {}) }, label) as HTMLButtonElement;
  if (opts.title !== undefined) btn.title = opts.title;
  btn.setAttribute('aria-pressed', String(!!opts.pressed));
  if (opts.onClick) btn.addEventListener('click', opts.onClick);
  return btn;
}

export function liveStatus(name: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'status-live';
  div.setAttribute('role', 'status');
  div.setAttribute('aria-live', 'polite');
  div.id = `live-${slug(name)}`;
  div.textContent = '';
  return div;
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
