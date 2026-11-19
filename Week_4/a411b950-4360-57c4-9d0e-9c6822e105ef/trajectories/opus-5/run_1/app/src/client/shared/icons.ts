import { ChevronLeft, Download, Link2, Plus, Search, Volume2, VolumeX } from 'lucide';

type IconNode = Array<[string, Record<string, string>]>;

export const ICONS = {
  soundOn: Volume2 as IconNode,
  soundOff: VolumeX as IconNode,
  search: Search as IconNode,
  add: Plus as IconNode,
  link: Link2 as IconNode,
  download: Download as IconNode,
  back: ChevronLeft as IconNode,
} as const;

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export function icon(node: IconNode): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  for (const [tag, attributes] of node) {
    const shape = document.createElementNS(SVG_NAMESPACE, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    svg.append(shape);
  }
  return svg;
}
