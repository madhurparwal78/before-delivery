import { createElement } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { SvgNode } from '../../../shared/geometry/index.ts';

const camel = (property: string): string => property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** `a: b; c-d: e` as the style object React wants. */
function styleObject(css: string): CSSProperties {
  const style: Record<string, string> = {};
  for (const declaration of css.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) style[camel(declaration.slice(0, colon).trim())] = declaration.slice(colon + 1).trim();
  }
  return style;
}

/** One shared `SvgNode` tree (entity, sheet, defs) as React elements, attributes passed through as written. */
export function svgElement(node: SvgNode, key?: string | number): ReactElement {
  const { style, class: className, ...rest } = node.attrs;
  const props: Record<string, unknown> = { ...rest, key };
  if (style !== undefined) props.style = styleObject(style);
  if (className !== undefined) props.className = className;
  const children = node.children?.map((child, index) => svgElement(child, index)) ?? node.text;
  return createElement(node.tag, props, children);
}
