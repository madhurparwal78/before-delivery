import { BASE_NODE_CSS, declarationText, nodeDeclarations } from './style.js';
import { allNodes } from './tree.js';
import type { Breakpoint, Entry, Field, Page, PlinthNode, Token } from './types.js';
import { BREAKPOINTS } from './types.js';

export function focalPosition(node: PlinthNode): string {
  const x = Number(node.props['focalX'] ?? 50);
  const y = Number(node.props['focalY'] ?? 50);
  return `${x}% ${y}%`;
}

/** The value a node's prop shows, after any collection binding. */
export function boundPropValue(
  node: PlinthNode,
  prop: string,
  entry: Entry | undefined,
  fields: readonly Field[],
): { value: string; field: Field | undefined } {
  const fieldName = node.bind?.[prop];
  if (fieldName === undefined || entry === undefined) {
    return { value: String(node.props[prop] ?? ''), field: undefined };
  }
  const field = fields.find((f) => f.name === fieldName);
  return { value: entry.values[fieldName] ?? '', field };
}

function rulesFor(
  page: Page,
  tokens: readonly Token[],
  bp: Breakpoint,
  selector: (node: PlinthNode) => string,
): string {
  return allNodes(page.root)
    .map((node) => `${selector(node)}{${declarationText(nodeDeclarations(node, bp, tokens))}}`)
    .join('\n');
}

/** Styles for the editor frames: each frame lays its nodes out at its own breakpoint. */
export function editorFrameCss(page: Page, tokens: readonly Token[]): string {
  const frames = BREAKPOINTS.map((bp) =>
    rulesFor(page, tokens, bp, (node) => `[data-frame="${bp}"] [data-node-id="${node.id}"]`),
  );
  return `${BASE_NODE_CSS}\n${frames.join('\n')}`;
}

/** Styles for a published page: desktop base, then the breakpoint boundaries. */
export function publishedCss(page: Page, tokens: readonly Token[]): string {
  const selector = (node: PlinthNode): string => `.n-${node.id}`;
  return [
    BASE_NODE_CSS,
    rulesFor(page, tokens, 'desktop', selector),
    `@media (max-width:1279px){\n${rulesFor(page, tokens, 'tablet', selector)}\n}`,
    `@media (max-width:767px){\n${rulesFor(page, tokens, 'phone', selector)}\n}`,
  ].join('\n');
}
