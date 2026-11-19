// The top-down panel diagram: a plan view of the car with the thirteen panel rectangles laid over
// it. The owner places a finding on it, the inspector pins one on it, and it is the picture inside
// the condition report.

interface PanelRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DIAGRAM_WIDTH = 300;
export const DIAGRAM_HEIGHT = 540;

const PANEL_RECTS: readonly PanelRect[] = [
  { id: 'front-bumper', x: 70, y: 20, width: 160, height: 34 },
  { id: 'bonnet', x: 78, y: 58, width: 144, height: 96 },
  { id: 'os-front-wing', x: 228, y: 58, width: 30, height: 96 },
  { id: 'ns-front-wing', x: 42, y: 58, width: 30, height: 96 },
  { id: 'os-door', x: 228, y: 158, width: 30, height: 120 },
  { id: 'ns-door', x: 42, y: 158, width: 30, height: 120 },
  { id: 'os-sill', x: 262, y: 158, width: 24, height: 190 },
  { id: 'ns-sill', x: 14, y: 158, width: 24, height: 190 },
  { id: 'roof', x: 90, y: 190, width: 120, height: 130 },
  { id: 'os-rear-quarter', x: 228, y: 282, width: 30, height: 110 },
  { id: 'ns-rear-quarter', x: 42, y: 282, width: 30, height: 110 },
  { id: 'boot-lid', x: 78, y: 396, width: 144, height: 90 },
  { id: 'rear-bumper', x: 70, y: 490, width: 160, height: 34 },
];

export function rectOf(panelId: string): PanelRect | undefined {
  return PANEL_RECTS.find((item) => item.id === panelId);
}

/** Where a panel-local anchor lands on the diagram. */
export function pinAt(panelId: string, u: number, v: number): { x: number; y: number } | null {
  const rect = rectOf(panelId);
  if (!rect) return null;
  return { x: rect.x + u * rect.width, y: rect.y + v * rect.height };
}

interface DiagramPin {
  x: number;
  y: number;
  label: string;
  strong?: boolean;
}

/** A tyre, tucked under the body's edge rather than floating beside it. */
function wheel(x: number, y: number): string {
  return `<rect x="${x}" y="${y}" width="22" height="62" rx="8" fill="#140A3A" opacity="0.86"/>`;
}

/** A lamp at the nose or the tail, drawn in the stage's own light. */
function lamp(x: number, y: number, colour: string): string {
  return `<rect x="${x}" y="${y}" width="34" height="11" rx="5" fill="${colour}" opacity="0.62"/>`;
}

/** The drawn car. `pins` are already in diagram coordinates. */
export function diagramSvg(options: { pins?: DiagramPin[]; interactive?: boolean; title?: string } = {}): string {
  const pins = options.pins ?? [];
  const body = `
    <defs>
      <linearGradient id="ob-plan" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8FA6F5"/>
        <stop offset="0.55" stop-color="#5A5FD0"/>
        <stop offset="1" stop-color="#2B2272"/>
      </linearGradient>
      <linearGradient id="ob-glass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#C9D6FF"/>
        <stop offset="1" stop-color="#8FA6F5"/>
      </linearGradient>
    </defs>
    <ellipse cx="150" cy="276" rx="136" ry="256" fill="#1A0B54" opacity="0.12"/>
    ${wheel(38, 96)}${wheel(240, 96)}${wheel(38, 388)}${wheel(240, 388)}
    <path d="M104 16 H196 C226 16 240 40 243 76 L248 170 L248 356 L243 450
             C240 492 224 524 194 524 H106 C76 524 60 492 57 450 L52 356 L52 170 L57 76
             C60 40 74 16 104 16 Z"
          fill="url(#ob-plan)" stroke="#1A0B54" stroke-width="2"/>
    ${lamp(72, 24, '#FFF2DB')}${lamp(194, 24, '#FFF2DB')}
    ${lamp(72, 502, '#8A3F85')}${lamp(194, 502, '#8A3F85')}
    <path d="M96 160 L204 160 L214 186 L86 186 Z" fill="url(#ob-glass)" opacity="0.85"/>
    <path d="M86 322 L214 322 L204 350 L96 350 Z" fill="url(#ob-glass)" opacity="0.7"/>
    <rect x="90" y="186" width="120" height="136" rx="10" fill="#6E79E0" opacity="0.55"/>
    <path d="M52 176 l-13 7 l13 7 z" fill="#1A0B54" opacity="0.65"/>
    <path d="M248 176 l13 7 l-13 7 z" fill="#1A0B54" opacity="0.65"/>
    <path d="M78 58 L222 58 L222 154 L78 154 Z" fill="none" stroke="#FFFFFF" stroke-opacity="0.26"/>
    <path d="M78 396 L222 396 L222 486 L78 486 Z" fill="none" stroke="#FFFFFF" stroke-opacity="0.26"/>
    <path d="M70 54 L230 54 M70 490 L230 490" stroke="#FFFFFF" stroke-opacity="0.26"/>`;

  const rects = PANEL_RECTS.map(
    (rect) =>
      `<rect data-panel-id="${rect.id}" x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}"` +
      ` rx="4" fill="#FFFFFF" fill-opacity="0.04" stroke="#FFFFFF" stroke-opacity="0.34" stroke-width="1"` +
      `${options.interactive ? ' class="diagram-panel"' : ''}/>`,
  ).join('');

  const marks = pins
    .map(
      (pin) =>
        `<g class="diagram-pin"><circle cx="${pin.x.toFixed(1)}" cy="${pin.y.toFixed(1)}" r="9"` +
        ` fill="${pin.strong ? '#FFF2DB' : 'none'}" stroke="#FFF2DB" stroke-width="3"/>` +
        `<circle cx="${pin.x.toFixed(1)}" cy="${pin.y.toFixed(1)}" r="3" fill="#0E0339"/>` +
        `<title>${escapeText(pin.label)}</title></g>`,
    )
    .join('');

  return (
    `<svg viewBox="0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}" xmlns="http://www.w3.org/2000/svg"` +
    ` role="img" aria-label="${escapeText(options.title ?? 'Panel diagram')}">${body}${rects}${marks}</svg>`
  );
}

export function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
