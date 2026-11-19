import type { ReactElement } from "react";
import type { EditorKind } from "./destinations";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Workshop() {
  return (
    <g {...STROKE}>
      <path d="M36 14 60 27v27L36 67 12 54V27z" />
      <path d="M12 27 36 40l24-13M36 40v27" />
      <path d="M72 30c0-5 6-8 14-8s14 3 14 8-6 8-14 8-14-3-14-8zM72 30v26c0 5 6 8 14 8s14-3 14-8V30" />
      <path d="M78 47h16" strokeDasharray="3 5" />
    </g>
  );
}

function Bench() {
  return (
    <g {...STROKE}>
      <path d="M12 28V44M12 51V60a8 8 0 0 0 8 8h72a8 8 0 0 0 8-8v-5M12 28a8 8 0 0 1 8-8h24l4-9 8 18 8-18 8 18 4-9h14a8 8 0 0 1 8 8v10" />
      <path d="M4 44H20" />
      <path d="M8 51H16" strokeWidth="4" />
      <path d="M91 38h18l-9 15z" />
      <path d="M90 55h20" />
      <path d="M110 36l7-6M112 46h8M110 56l7 6" />
    </g>
  );
}

function Lab() {
  return (
    <g {...STROKE}>
      <rect x="14" y="14" width="46" height="16" rx="5" />
      <rect x="28" y="38" width="46" height="16" rx="5" />
      <rect x="42" y="62" width="46" height="16" rx="5" />
      <circle cx="46" cy="22" r="4" />
      <circle cx="60" cy="46" r="4" />
      <path d="M96 22v50M92 68l4 6 4-6" strokeDasharray="0.5 7" />
    </g>
  );
}

const ICONS: Record<EditorKind, () => ReactElement> = { "3d": Workshop, circuit: Bench, blocks: Lab };

/** Original outline illustrations for the three-editor row, drawn in the editor's field colour. */
export function EditorIcon({ kind }: { kind: EditorKind }) {
  const Icon = ICONS[kind];
  return (
    <svg className="editor-icon" viewBox="0 0 124 88" width="124" height="88" aria-hidden="true" focusable="false">
      <Icon />
    </svg>
  );
}
