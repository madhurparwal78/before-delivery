/**
 * The coat stack — a procedural top-down car plan with 12 panels, the stage
 * scrubber, the selected panel's cross-section and the total film build.
 * The browser only draws values the server derived. Motion follows the
 * published three phases: panel wipe, cross-section, numeral.
 */
import { h } from '../ui.ts';
import { PANELS, BAND_LABELS, type Band } from '../../shared/coat.ts';
import { filmDisplay } from '../../shared/units.ts';
import { stageAnnouncement, stagePositionLabel } from '../../shared/copy.ts';

export interface CoatStage {
  index: number;
  name: string;
  logged_at: string;
  panels: {
    panel: string;
    film_um: number | null;
    band: Band | null;
    layers: { stage: string; um: number }[];
  }[];
}

export interface CoatData {
  job_id: string;
  panels: { id: string; name: string; order: number }[];
  stages: CoatStage[];
}

const BAND_TINTS: Record<Band, string> = {
  thin: 'var(--thin-tint)',
  factory: 'var(--factory-tint)',
  refinished: 'var(--refinish-tint)',
  filler_suspected: 'var(--filler-tint)',
};
const BAND_PATTERNS: Record<Band, string> = {
  thin: 'p-dots',
  factory: 'p-horizontal',
  refinished: 'p-diagonal',
  filler_suspected: 'p-cross',
};

/** Panel rectangles in a 100×100 plan; the front is at the top. */
const PLAN: Record<string, { x: number; y: number; w: number; h: number }> = {
  front_valance: { x: 46, y: 3, w: 8, h: 9 },
  bonnet: { x: 42, y: 13, w: 16, h: 16 },
  front_wing_l: { x: 36, y: 13, w: 5, h: 16 },
  front_wing_r: { x: 59, y: 13, w: 5, h: 16 },
  door_l: { x: 36, y: 30, w: 5, h: 16 },
  door_r: { x: 59, y: 30, w: 5, h: 16 },
  sill_l: { x: 33, y: 46, w: 4, h: 15 },
  sill_r: { x: 63, y: 46, w: 4, h: 15 },
  roof: { x: 42, y: 46, w: 16, h: 15 },
  rear_quarter_l: { x: 36, y: 62, w: 5, h: 15 },
  rear_quarter_r: { x: 59, y: 62, w: 5, h: 15 },
  boot_lid: { x: 42, y: 78, w: 16, h: 15 },
};

export interface CoatStackOptions {
  data: CoatData;
  filmUnit: 'um' | 'mil';
  initialStage: number;
  initialPanel: string;
  onSelection: (stage: number, panel: string) => void;
  onOpenHistory: (panel: string) => void;
}

export interface CoatStack {
  root: HTMLElement;
  update(data: CoatData, stage: number, panel: string, direction: 1 | -1): void;
  announceStep(stage: number, panel: string): void;
}

export function buildCoatStack(options: CoatStackOptions): CoatStack {
  const data = options.data;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stageAnnouncer = h('p', { class: 'status-region', role: 'status', 'data-region': 'stage-announcer' });

  const planArea = h('div', { class: 'panelmap' });
  const svgHost = h('div', { style: 'position:relative;' });
  const buttonHost = h('div', { style: 'position:absolute;inset:0;display:grid;' });
  const scrubberArea = h('div');
  const crossSection = h('div', { class: 'cross-section' });
  const totalArea = h('div', { class: 'total-film' });
  const readingsBody = h('tbody');
  const historyArea = h('div');

  let currentStage = options.initialStage;
  let currentPanel = options.initialPanel;

  const stagePanels = (stage: number): CoatStage['panels'] =>
    data.stages[stage]?.panels ??
    PANELS.map((panel) => ({ panel: panel.id, film_um: null, band: null, layers: [] }));

  const panelReading = (stage: number, panel: string): CoatStage['panels'][number] | undefined =>
    stagePanels(stage).find((candidate) => candidate.panel === panel);

  const buildSvg = (): void => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = [
      '<pattern id="p-dots" width="2.5" height="2.5" patternUnits="userSpaceOnUse"><circle cx="0.9" cy="0.9" r="0.45" fill="var(--thin-ink)"/></pattern>',
      '<pattern id="p-horizontal" width="2.5" height="2.5" patternUnits="userSpaceOnUse"><line x1="0" y1="1" x2="2.5" y2="1" stroke="var(--factory-ink)" stroke-width="0.45"/></pattern>',
      '<pattern id="p-diagonal" width="2.5" height="2.5" patternUnits="userSpaceOnUse"><line x1="0" y1="2.5" x2="2.5" y2="0" stroke="var(--refinish-ink)" stroke-width="0.45"/></pattern>',
      '<pattern id="p-cross" width="2.5" height="2.5" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="2.5" y2="2.5" stroke="var(--filler-ink)" stroke-width="0.35"/><line x1="0" y1="2.5" x2="2.5" y2="0" stroke="var(--filler-ink)" stroke-width="0.35"/></pattern>',
    ].join('');
    svg.append(defs);
    for (const panel of PANELS) {
      const shape = PLAN[panel.id];
      const base = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      base.setAttribute('x', String(shape.x));
      base.setAttribute('y', String(shape.y));
      base.setAttribute('width', String(shape.w));
      base.setAttribute('height', String(shape.h));
      base.setAttribute('data-base', panel.id);
      base.setAttribute('stroke', 'var(--rule-strong)');
      base.setAttribute('stroke-width', '0.6');
      base.setAttribute('fill', 'var(--panel-plain)');
      base.setAttribute('stroke-dasharray', '1.4 1.1');
      svg.append(base);
      const hatch = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hatch.setAttribute('x', String(shape.x));
      hatch.setAttribute('y', String(shape.y));
      hatch.setAttribute('width', String(shape.w));
      hatch.setAttribute('height', String(shape.h));
      hatch.setAttribute('data-hatch', panel.id);
      hatch.setAttribute('fill', 'none');
      svg.append(hatch);
      const wipe = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      wipe.setAttribute('x', String(shape.x));
      wipe.setAttribute('y', String(shape.y));
      wipe.setAttribute('width', String(shape.w));
      wipe.setAttribute('height', String(shape.h));
      wipe.setAttribute('data-wipe', panel.id);
      wipe.setAttribute('fill', 'var(--panel-plain)');
      wipe.setAttribute('stroke-dasharray', '1.4 1.1');
      wipe.setAttribute('stroke', 'var(--rule-strong)');
      wipe.setAttribute('stroke-width', '0.6');
      wipe.setAttribute('style', 'display:none;');
      svg.append(wipe);
    }
    svgHost.replaceChildren(svg, buttonHost);
  };

  const paintPanel = (stage: number, panel: string): void => {
    const svg = svgHost.querySelector('svg');
    if (!svg) return;
    const base = svg.querySelector<SVGRectElement>(`[data-base="${panel}"]`);
    const hatch = svg.querySelector<SVGRectElement>(`[data-hatch="${panel}"]`);
    const reading = panelReading(stage, panel);
    if (reading?.band) {
      base?.setAttribute('fill', BAND_TINTS[reading.band]);
      base?.removeAttribute('stroke-dasharray');
      hatch?.setAttribute('fill', `url(#${BAND_PATTERNS[reading.band]})`);
    } else {
      base?.setAttribute('fill', 'var(--panel-plain)');
      base?.setAttribute('stroke-dasharray', '1.4 1.1');
      hatch?.setAttribute('fill', 'none');
    }
    if (panel === currentPanel) {
      base?.setAttribute('stroke', 'var(--ink)');
      base?.setAttribute('stroke-width', '1.4');
    } else {
      base?.setAttribute('stroke', 'var(--rule-strong)');
      base?.setAttribute('stroke-width', '0.6');
    }
  };

  /** Phase 1 — the wipe: old fill swept away front to rear per panel. */
  const wipePanels = (stage: number, direction: 1 | -1): void => {
    const svg = svgHost.querySelector('svg');
    if (!svg) return;
    const reduced = reducedMotion();
    PANELS.forEach((panel, order) => {
      const base = svg.querySelector<SVGRectElement>(`[data-base="${panel.id}"]`);
      const hatch = svg.querySelector<SVGRectElement>(`[data-hatch="${panel.id}"]`);
      const wipe = svg.querySelector<SVGRectElement>(`[data-wipe="${panel.id}"]`);
      if (!base || !wipe || !hatch) return;
      // capture the old look on the wipe overlay, then set the new fill underneath
      const previous = panelReading(direction < 0 ? stage + 1 : stage - 1, panel.id);
      wipe.setAttribute('fill', previous?.band ? BAND_TINTS[previous.band] : 'var(--panel-plain)');
      wipe.setAttribute('style', 'display:block;');
      paintPanel(stage, panel.id);
      if (reduced) {
        wipe.setAttribute('style', 'display:none;');
        return;
      }
      const shape = PLAN[panel.id];
      wipe.setAttribute('y', String(shape.y));
      wipe.setAttribute('height', String(shape.h));
      wipe.style.transition = 'none';
      wipe.setAttribute('y', String(direction >= 0 ? shape.y : shape.y + shape.h));
      wipe.setAttribute('height', String(direction >= 0 ? shape.h : 0));
      window.requestAnimationFrame(() => {
        wipe.style.transition = 'y 0.45s ease-out, height 0.45s ease-out';
        wipe.style.transitionDelay = `${order * 0.03}s`;
        if (direction >= 0) {
          wipe.setAttribute('y', String(shape.y + shape.h));
          wipe.setAttribute('height', '0');
        } else {
          wipe.setAttribute('y', String(shape.y));
          wipe.setAttribute('height', String(shape.h));
        }
      });
      window.setTimeout(() => wipe.setAttribute('style', 'display:none;'), 500 + order * 30);
    });
  };

  const panelButtonName = (panel: string): string => {
    const reading = panelReading(currentStage, panel);
    const def = PANELS.find((candidate) => candidate.id === panel);
    if (reading?.film_um != null && reading.band) {
      return `${def?.name}, ${filmDisplay(reading.film_um, options.filmUnit)}, ${BAND_LABELS[reading.band]}`;
    }
    return `${def?.name}, No reading`;
  };

  const buildPanelButtons = (): void => {
    const buttons = new Map<string, HTMLButtonElement>();
    for (const panel of PANELS) {
      const shape = PLAN[panel.id];
      const button = document.createElement('button');
      button.style.gridColumn = '1';
      button.style.gridRow = '1';
      button.style.justifySelf = 'stretch';
      button.style.alignSelf = 'stretch';
      button.style.opacity = '0';
      button.style.background = 'transparent';
      button.style.border = 'none';
      button.dataset.panelId = panel.id;
      button.setAttribute('aria-label', panelButtonName(panel.id));
      button.addEventListener('click', () => {
        if (currentPanel === panel.id) return;
        options.onSelection(currentStage, panel.id);
      });
      button.addEventListener('keydown', (event) => {
        const key = (event as KeyboardEvent).key;
        const order = PANELS.findIndex((candidate) => candidate.id === panel.id);
        if (key === 'ArrowRight' || key === 'ArrowDown') {
          event.preventDefault();
          const next = PANELS[Math.min(PANELS.length - 1, order + 1)];
          options.onSelection(currentStage, next.id);
        } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
          event.preventDefault();
          const previous = PANELS[Math.max(0, order - 1)];
          options.onSelection(currentStage, previous.id);
        } else if (key === 'Enter' || key === ' ') {
          event.preventDefault();
          options.onOpenHistory(panel.id);
        }
      });
      // position the hit area over the drawing
      button.style.margin = `${shape.y}% ${100 - shape.x - shape.w}% ${100 - shape.y - shape.h}% ${shape.x}%`;
      buttons.set(panel.id, button);
      buttonHost.append(button);
    }
    // single tab stop: the selected panel, or the first
    const initial = PANELS.some((panel) => panel.id === currentPanel) ? currentPanel : PANELS[0].id;
    for (const [id, button] of buttons) {
      button.tabIndex = id === initial ? 0 : -1;
      if (id === initial) button.setAttribute('aria-pressed', 'true');
    }
  };

  const updatePanelButtons = (): void => {
    for (const button of Array.from(buttonHost.querySelectorAll('button'))) {
      const id = button.dataset.panelId ?? '';
      button.setAttribute('aria-label', panelButtonName(id));
      button.setAttribute('aria-pressed', String(id === currentPanel));
      button.tabIndex = id === currentPanel ? 0 : -1;
    }
  };

  const buildScrubber = (): void => {
    const count = data.stages.length;
    const slider = h('div', {
      role: 'slider',
      'aria-label': 'Stage',
      'aria-valuemin': '0',
      'aria-valuemax': String(Math.max(0, count - 1)),
      'aria-valuenow': String(currentStage),
      'aria-valuetext': stagePositionLabel(data.stages[currentStage]?.name ?? '', currentStage + 1, count),
      tabindex: count > 0 ? '0' : '-1',
    });
    const ticks = h('div', { class: 'track' }, h('div', { class: 'ticks' },
      ...data.stages.map((stage, index) => h('button', {
        class: 'tick',
        'aria-current': index === currentStage ? 'true' : 'false',
        text: stage.name,
        tabindex: '-1',
        onclick: () => options.onSelection(index, currentPanel),
      }))));
    slider.append(ticks);
    slider.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      let next: number | null = null;
      if (key === 'ArrowRight' || key === 'ArrowUp') next = Math.min(count - 1, currentStage + 1);
      else if (key === 'ArrowLeft' || key === 'ArrowDown') next = Math.max(0, currentStage - 1);
      else if (key === 'Home') next = 0;
      else if (key === 'End') next = count - 1;
      if (next === null) return;
      event.preventDefault();
      options.onSelection(next, currentPanel);
    });
    let dragging = false;
    const nearest = (event: PointerEvent): number => {
      const targets = Array.from(ticks.querySelectorAll('.tick'));
      const bounds = ticks.getBoundingClientRect();
      const ratio = (event.clientX - bounds.left) / bounds.width;
      return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
    };
    ticks.addEventListener('pointerdown', (event) => {
      dragging = true;
      ticks.setPointerCapture((event as PointerEvent).pointerId);
      const target = event.target as HTMLElement;
      if (target.classList.contains('tick')) return;
      options.onSelection(nearest(event as PointerEvent), currentPanel);
    });
    ticks.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      options.onSelection(nearest(event as PointerEvent), currentPanel);
    });
    ticks.addEventListener('pointerup', () => {
      dragging = false;
    });
    scrubberArea.replaceChildren(slider);
  };

  /** Phase 2 — the cross-section layers grow from the bottom up. */
  const renderCrossSection = (stage: number, panel: string, direction: 1 | -1): void => {
    const reading = panelReading(stage, panel);
    const layers = reading?.layers ?? [];
    const reduced = reducedMotion();
    crossSection.replaceChildren();
    if (layers.length === 0) {
      crossSection.append(h('p', { class: 'small muted', text: 'No layers at this stage.' }));
    } else {
      const stack = h('div');
      layers.forEach((layer, index) => {
        const el = h('div', {
          class: 'layer',
          'aria-label': `${layer.stage} ${layer.um} µm`,
          style: `height:${Math.max(6, layer.um / 4)}px;`,
        });
        el.style.background = 'var(--panel-plain)';
        el.style.border = '1px solid var(--ink)';
        stack.append(el);
        if (!reduced) {
          el.style.height = direction >= 0 ? '0px' : `${Math.max(6, layer.um / 4)}px`;
          el.style.transition = 'height 0.2s ease-out';
          el.style.transitionDelay = `${0.2 + index * 0.2}s`;
          window.requestAnimationFrame(() => {
            el.style.height = `${Math.max(6, layer.um / 4)}px`;
          });
        }
      });
      crossSection.append(stack);
    }
  };

  /** Phase 3 — the numeral counts to the server value. */
  const renderTotal = (stage: number, panel: string): void => {
    const reading = panelReading(stage, panel);
    const value = reading?.film_um ?? null;
    const label = h('span', { class: 'label', text: 'Total film build' });
    const numeral = h('span', { class: 'value mono', text: filmDisplay(value, options.filmUnit) });
    totalArea.replaceChildren(label, numeral);
    if (value === null || reducedMotion()) return;
    const unit = options.filmUnit;
    const to = unit === 'um' ? value : Math.round((value / 25.4) * 10) / 10;
    const currentText = numeral.textContent ?? '';
    const parsed = Number(currentText.replace(/[^\d.]/g, ''));
    const from = Number.isFinite(parsed) ? parsed : 0;
    if (from === to) return;
    const start = performance.now();
    const duration = 700;
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      numeral.textContent = unit === 'um' ? `${Math.round(current)} µm` : `${current.toFixed(1)} mil`;
      if (progress < 1) window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  };

  const renderReadingsTable = (stage: number): void => {
    const rows = stagePanels(stage).map((reading) => {
      const def = PANELS.find((panel) => panel.id === reading.panel);
      return h('tr', null,
        h('td', { text: def?.name ?? reading.panel }),
        h('td', { class: 'num', text: reading.film_um !== null ? filmDisplay(reading.film_um, options.filmUnit) : '—' }),
        h('td', { text: reading.band ? BAND_LABELS[reading.band] : 'No reading' }));
    });
    readingsBody.replaceChildren(...rows);
  };

  buildSvg();
  buildPanelButtons();
  buildScrubber();
  renderCrossSection(currentStage, currentPanel, 1);
  renderTotal(currentStage, currentPanel);
  renderReadingsTable(currentStage);
  for (const panel of PANELS) paintPanel(currentStage, panel.id);
  updatePanelButtons();

  const update = (fresh: CoatData, stage: number, panel: string, direction: 1 | -1): void => {
    data.stages = fresh.stages;
    data.panels = fresh.panels;
    currentStage = stage;
    currentPanel = panel;
    wipePanels(stage, direction);
    buildScrubber();
    renderCrossSection(stage, panel, direction);
    renderTotal(stage, panel);
    renderReadingsTable(stage);
    updatePanelButtons();
  };

  const announceStep = (stage: number, panel: string): void => {
    const reading = panelReading(stage, panel);
    const def = PANELS.find((candidate) => candidate.id === panel);
    stageAnnouncer.textContent = '';
    window.requestAnimationFrame(() => {
      stageAnnouncer.textContent = stageAnnouncement(
        data.stages[stage]?.name ?? '',
        stage + 1,
        data.stages.length,
        def?.name ?? panel,
        reading?.film_um != null ? filmDisplay(reading.film_um, options.filmUnit) : null,
        reading?.band ? BAND_LABELS[reading.band] : null,
      );
    });
  };

  const root = h('div', { class: 'coat-stack' },
    h('div', { class: 'panelmap', role: 'group', 'aria-label': 'Panel map' }, svgHost),
    scrubberArea,
    crossSection,
    totalArea,
    historyArea,
    h('table', { class: 'sheet', 'aria-label': 'Panel readings' },
      h('thead', null, h('tr', null, h('th', { text: 'Panel' }), h('th', { text: 'Reading' }), h('th', { text: 'Band' }))),
      readingsBody),
    stageAnnouncer,
  );

  return { root, update, announceStep };
}

export { PANELS, BAND_LABELS };
