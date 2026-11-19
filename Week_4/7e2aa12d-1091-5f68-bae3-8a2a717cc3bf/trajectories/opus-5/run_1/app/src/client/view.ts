import { generateCss, generateHtml } from '../shared/generate.js';
import { getScopeGrid, scopeLabel, sortedBreakpoints } from '../shared/grid.js';
import type { LayoutObject, LayoutState, Scope } from '../shared/types.js';
import { Canvas } from './canvas.js';
import { clear, h } from './dom.js';
import { PreviewPane, roundHalfUp } from './preview.js';
import { tabStrip } from './tabs.js';

const LIVE_PAUSED = 'Live updates are paused. Your changes are still saved.';

interface Boot {
  token: string;
  layout: LayoutObject;
}

function stateOf(layout: LayoutObject): LayoutState {
  return {
    columns: layout.columns,
    rows: layout.rows,
    gap: layout.gap,
    areas: layout.areas,
    breakpoints: layout.breakpoints,
  };
}

/** The read-only view page: no editing control, and no key changes anything. */
export function mountView(root: HTMLElement, boot: Boot): void {
  let layout = boot.layout;
  let previewWidth = 1280;
  let livePaused = !layout.live;

  const scopeInEffect = (): Scope => {
    const below = sortedBreakpoints(stateOf(layout)).filter((item) => item.min_width <= previewWidth);
    const nearest = below[below.length - 1];
    return nearest ? nearest.min_width : 'base';
  };
  let shownScope: Scope = scopeInEffect();

  const updates = h('div', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Layout updates', class: 'updates' });
  const liveStatus = h('div', { role: 'status', 'aria-label': 'Live status', class: 'live-status' });
  const breakpointTabsHolder = h('div', { class: 'breakpoint-tabs' });
  const canvas = new Canvas({
    editable: false,
    nameArea: () => undefined,
    clearCells: () => undefined,
    trackCommand: () => undefined,
    setTrackSize: () => undefined,
    fieldProblem: () => undefined,
  });

  const preview = new PreviewPane();
  const widthReadout = h('output', { class: 'width-readout numeric' });
  const widthSlider = h('input', {
    type: 'range',
    min: '320',
    max: '1440',
    step: '1',
    class: 'width-slider',
    'aria-label': 'Preview width',
  }) as HTMLInputElement;

  const cssField = h('textarea', {
    class: 'code-field numeric',
    'aria-label': 'Layout CSS',
    readonly: true,
    spellcheck: 'false',
  }) as HTMLTextAreaElement;
  const htmlField = h('textarea', {
    class: 'code-field numeric',
    'aria-label': 'Layout HTML',
    readonly: true,
    spellcheck: 'false',
  }) as HTMLTextAreaElement;
  const cssPanel = h('div', { role: 'tabpanel', id: 'panel-css', 'aria-label': 'CSS', class: 'code-panel' }, cssField);
  const htmlPanel = h('div', { role: 'tabpanel', id: 'panel-html', 'aria-label': 'HTML', class: 'code-panel' }, htmlField);
  htmlPanel.hidden = true;
  const codeTabs = tabStrip(
    'Code',
    [
      { id: 'css', label: 'CSS' },
      { id: 'html', label: 'HTML' },
    ],
    'css',
    (id) => {
      cssPanel.hidden = id !== 'css';
      htmlPanel.hidden = id !== 'html';
    },
  );

  const canvasPane = h(
    'div',
    { class: 'pane canvas-pane', role: 'tabpanel', id: 'panel-grid', 'aria-label': 'Grid' },
    breakpointTabsHolder,
    canvas.element,
  );
  const previewPane = h(
    'div',
    { class: 'pane preview-pane', role: 'tabpanel', id: 'panel-preview', 'aria-label': 'Preview' },
    h('div', { class: 'preview-controls' }, h('label', { text: 'Preview width' }), widthSlider, widthReadout),
    h('div', { class: 'preview-frame-holder' }, preview.frame),
  );
  const codePane = h(
    'div',
    { class: 'pane code-pane', role: 'tabpanel', id: 'panel-code', 'aria-label': 'Code' },
    codeTabs.list,
    cssPanel,
    htmlPanel,
  );

  const paneTabs = tabStrip(
    'Editor panes',
    [
      { id: 'grid', label: 'Grid' },
      { id: 'preview', label: 'Preview' },
      { id: 'code', label: 'Code' },
    ],
    'grid',
    (id) => showPane(id),
  );

  root.append(
    h(
      'div',
      { class: 'editor view-page' },
      h('header', { class: 'top-bar' }, h('h1', { text: layout.name })),
      h('div', { class: 'notice-area' }, liveStatus, updates),
      h('div', { class: 'pane-tabs' }, paneTabs.list),
      h('div', { class: 'panes' }, canvasPane, h('div', { class: 'side' }, previewPane, codePane)),
    ),
  );

  function showPane(id: string): void {
    const phone = window.innerWidth < 700;
    for (const [key, pane] of [
      ['grid', canvasPane],
      ['preview', previewPane],
      ['code', codePane],
    ] as [string, HTMLElement][]) {
      pane.hidden = phone && key !== id;
    }
  }

  function render(): boolean {
    const scope = scopeInEffect();
    const moved = scope !== shownScope;
    shownScope = scope;
    if (!layout.live) livePaused = true;
    liveStatus.textContent = livePaused ? LIVE_PAUSED : '';

    clear(breakpointTabsHolder);
    const scopes: Scope[] = ['base', ...sortedBreakpoints(stateOf(layout)).map((item) => item.min_width)];
    breakpointTabsHolder.append(
      tabStrip(
        'Breakpoints',
        scopes.map((item) => ({ id: String(item), label: scopeLabel(item), focusKey: `breakpoint-tab-${item}` })),
        String(shownScope),
        (id) => setPreviewWidth(id === 'base' ? 375 : Number(id)),
      ).list,
    );

    const state = stateOf(layout);
    preview.update(generateCss(state), generateHtml(state), previewWidth);
    widthSlider.value = String(previewWidth);
    widthSlider.setAttribute('aria-valuetext', `${previewWidth}px`);
    widthReadout.textContent = `${previewWidth}px`;
    cssField.value = layout.css;
    htmlField.value = layout.html;

    showPane(paneTabs.selected());
    const grid = getScopeGrid(state, shownScope);
    if (grid) {
      canvas.render(
        { columns: grid.columns, rows: grid.rows, areas: grid.areas },
        preview.resolvedColumns().map(roundHalfUp),
        moved,
      );
    }
    return moved;
  }

  function setPreviewWidth(width: number): void {
    const next = Math.min(Math.max(Math.round(width), 320), 1440);
    if (next === previewWidth) return;
    previewWidth = next;
    if (render()) updates.textContent = `Showing ${scopeLabel(shownScope)} at ${previewWidth}px.`;
  }

  widthSlider.addEventListener('input', () => setPreviewWidth(Number(widthSlider.value)));
  widthSlider.addEventListener('keydown', (event) => {
    const edges = [320, ...sortedBreakpoints(stateOf(layout)).map((item) => item.min_width), 1440];
    const key = event.key;
    if (key === 'ArrowRight' || key === 'ArrowUp') {
      event.preventDefault();
      setPreviewWidth(previewWidth + 10);
    } else if (key === 'ArrowLeft' || key === 'ArrowDown') {
      event.preventDefault();
      setPreviewWidth(previewWidth - 10);
    } else if (key === 'Home') {
      event.preventDefault();
      setPreviewWidth(320);
    } else if (key === 'End') {
      event.preventDefault();
      setPreviewWidth(1440);
    } else if (key === 'PageUp') {
      event.preventDefault();
      const above = edges.filter((edge) => edge > previewWidth);
      if (above.length > 0) setPreviewWidth(Math.min(...above));
    } else if (key === 'PageDown') {
      event.preventDefault();
      const below = edges.filter((edge) => edge < previewWidth);
      if (below.length > 0) setPreviewWidth(Math.max(...below));
    }
  });

  window.addEventListener('resize', () => showPane(paneTabs.selected()));

  function connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/view/${boot.token}/live`);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as {
        type: string;
        revision?: number;
        state?: LayoutState;
      };
      if (message.type !== 'change' || !message.state || message.revision === undefined) return;
      if (message.revision <= layout.revision) return;
      layout = {
        ...layout,
        revision: message.revision,
        ...message.state,
        css: generateCss(message.state),
        html: generateHtml(message.state),
      };
      render();
      updates.textContent = 'Layout updated.';
    });
    socket.addEventListener('close', () => window.setTimeout(connect, 2000));
  }

  render();
  connect();
}
