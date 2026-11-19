import { DIAGRAM_VIEWBOX, PANELS } from './panels';

export interface DiagramPin {
  readonly panelId: string;
  readonly u: number;
  readonly v: number;
  readonly label: string;
  readonly kind: 'finding' | 'placing';
}

export interface DiagramOptions {
  readonly pins: readonly DiagramPin[];
  readonly activePanelId: string | null;
  readonly interactive: boolean;
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The top-down panel diagram. One geometry serves the screen and the rendered reports. */
export const panelDiagramSvg = (options: DiagramOptions): string => {
  const { x, y, width, height } = DIAGRAM_VIEWBOX;

  const rects = PANELS.map((panel) => {
    const active = panel.id === options.activePanelId;
    const substrateClass = `diagram-panel diagram-${panel.substrate}${active ? ' diagram-panel-active' : ''}`;
    return `<rect data-panel-id="${panel.id}" class="${substrateClass}" x="${panel.diagram.x}" y="${panel.diagram.y}" width="${panel.diagram.w}" height="${panel.diagram.h}" rx="3"><title>${escapeAttr(panel.label)}</title></rect>`;
  }).join('');

  const pins = options.pins
    .map((pin) => {
      const panel = PANELS.find((candidate) => candidate.id === pin.panelId);
      if (panel === undefined) return '';
      const cx = panel.diagram.x + pin.u * panel.diagram.w;
      const cy = panel.diagram.y + pin.v * panel.diagram.h;
      const radius = pin.kind === 'placing' ? 5 : 4;
      return `<circle class="diagram-pin diagram-pin-${pin.kind}" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius}"><title>${escapeAttr(pin.label)}</title></circle>`;
    })
    .join('');

  const pointer = options.interactive ? '' : ' pointer-events="none"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" class="panel-diagram"${pointer} preserveAspectRatio="xMidYMid meet"><g class="diagram-body"><rect class="diagram-ground" x="${x}" y="${y}" width="${width}" height="${height}" rx="10"/>${rects}${pins}</g></svg>`;
};
