import { createElement } from "react";
import { Check, Clock, FileWarning, type IconNode, Lock, Paintbrush, TriangleAlert, X } from "lucide";

// One openly licensed line-icon set (Lucide, ISC), drawn inline.

export const icons = { paintbrush: Paintbrush, clock: Clock, check: Check, lock: Lock, cross: X, warningFile: FileWarning, alert: TriangleAlert };

export function Icon({ node, size = 16 }: { node: IconNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {node.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

function svgText(node: IconNode): string {
  const parts = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}='${String(v)}'`).join(" ")}/>`);
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.25' stroke-linecap='round' stroke-linejoin='round'>${parts.join("")}</svg>`;
}

/** Cell icons as CSS masks (one custom property each), so 1,200 cells cost no extra DOM. */
export function installCellIcons(): void {
  for (const [name, node] of Object.entries(icons)) {
    document.documentElement.style.setProperty(`--icon-${name}`, `url("data:image/svg+xml,${encodeURIComponent(svgText(node))}")`);
  }
}
