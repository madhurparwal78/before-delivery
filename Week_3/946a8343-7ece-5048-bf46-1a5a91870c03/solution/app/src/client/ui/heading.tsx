// <Heading level={1..6} ...> renders hN with the display type scale classes (sp-h1 .. sp-h6 sizes, whatever the tag).
import { h, type ComponentChildren } from "preact";

export function Heading({ level, class: className, children, ...rest }: { level: 1 | 2 | 3 | 4 | 5 | 6; class?: string; id?: string; tabIndex?: number; children?: ComponentChildren }) {
  return h(`h${level}`, { ...rest, class: className }, children);
}
