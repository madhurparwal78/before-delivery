// Lucide outline icons, drawn inline in ink.
import { h } from "preact";
import type { IconNode } from "lucide";

export function Icon({ node, size = 20 }: { node: IconNode; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {node.map(([tag, attrs], index) => h(tag, { ...attrs, key: index }))}
    </svg>
  );
}
