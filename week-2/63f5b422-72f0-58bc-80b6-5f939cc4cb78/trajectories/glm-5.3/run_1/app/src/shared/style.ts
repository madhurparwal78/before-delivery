// One place that computes a node's rendered declarations: shared by the editor
// canvas and the published page, so their computed styles agree (DP-16).
import { resolveStyle, isTokenRef, type WorkspaceDocument, type DocumentNode, type Breakpoint, type StyleProperty } from './domain.js';

export const STYLE_PROPERTIES_ALL: readonly StyleProperty[] = [
  'color', 'background-color', 'font-size', 'padding', 'gap', 'width', 'text-align', 'display', 'flex-direction',
];

/** Per-type default declarations, identical in the editor and on published pages. */
export const TYPE_DEFAULTS: Record<DocumentNode['type'], string> = {
  page: '',
  section: 'padding:16px;display:block',
  stack: 'display:flex;flex-direction:column;gap:8px',
  heading: 'margin:0',
  text: 'margin:0',
  image: 'width:100%;object-fit:cover',
  button: 'display:inline-block;padding:8px 16px',
  nav: 'display:flex;flex-direction:row;gap:12px;padding:12px',
  collection_list: 'list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px',
};

export function cssValue(doc: WorkspaceDocument, v: string | { token: string }): string {
  if (isTokenRef(v)) {
    const t = doc.tokens.find((x) => x.name === v.token);
    if (!t) return '';
    return t.kind === 'size' ? `${t.value}${t.unit ?? 'px'}` : String(t.value);
  }
  return String(v);
}

/** The declarations a node renders with at one breakpoint: type defaults, then
 * the resolved (inherited) style values. */
export function computedDeclarations(doc: WorkspaceDocument, node: DocumentNode, bp: Breakpoint): Record<string, string> {
  const decs: Record<string, string> = {};
  const defaults = TYPE_DEFAULTS[node.type] ?? '';
  for (const pair of defaults.split(';')) {
    if (!pair) continue;
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    decs[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  for (const prop of STYLE_PROPERTIES_ALL) {
    const r = resolveStyle(node.styles, bp, prop);
    if (r.value !== undefined) decs[prop] = cssValue(doc, r.value);
  }
  return decs;
}

export function declarationsToCss(decs: Record<string, string>): string {
  return Object.entries(decs).map(([k, v]) => `${k}:${v}`).join(';');
}

export function focalPoint(node: DocumentNode): string {
  const x = typeof node.props.focalX === 'number' ? node.props.focalX : 50;
  const y = typeof node.props.focalY === 'number' ? node.props.focalY : 50;
  return `${x}% ${y}%`;
}
