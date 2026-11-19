// The one definition of a shop's state that markers, the map legend and the shops table all draw from.
import type { DisplayState } from "../types";

interface StateDefinition {
  key: DisplayState;
  label: string;
  word: string;
  fill: string;
  ringWidth: number;
  dash: [number, number] | null;
}

const DEFINITIONS: Record<DisplayState, StateDefinition> = {
  open: { key: "open", label: "Open", word: "open", fill: "var(--state-open)", ringWidth: 2, dash: null },
  closing_soon: { key: "closing_soon", label: "Closing soon", word: "closing soon", fill: "var(--state-closing)", ringWidth: 3, dash: [6, 4] },
  closed: { key: "closed", label: "Closed", word: "closed", fill: "var(--state-closed)", ringWidth: 1, dash: [2, 3] },
  stock_critical: { key: "stock_critical", label: "Stock critical", word: "stock critical", fill: "var(--state-critical)", ringWidth: 4, dash: [3, 3] },
  suspended: { key: "suspended", label: "Suspended", word: "suspended", fill: "url(#hatch)", ringWidth: 2, dash: [1, 5] },
};

export const ALL_STATES: DisplayState[] = ["open", "closing_soon", "closed", "stock_critical", "suspended"];

export const STATE_DEFINITIONS: StateDefinition[] = ALL_STATES.map((state) => DEFINITIONS[state]);

export function definitionOf(state: DisplayState): StateDefinition {
  return DEFINITIONS[state];
}

/** A dot with its ring, drawn the same way in a marker, the legend and a table row. */
export function StateDot({ state, size = 28 }: { state: DisplayState; size?: number }) {
  const definition = definitionOf(state);
  const centre = size / 2;
  const radius = centre - 6;
  return (
    <svg className="state-dot" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <circle cx={centre} cy={centre} r={radius} fill={definition.fill} />
      <circle
        cx={centre} cy={centre} r={radius + definition.ringWidth / 2 + 1} fill="none" stroke="#fff"
        strokeWidth={definition.ringWidth} strokeDasharray={definition.dash ? definition.dash.join(" ") : undefined}
      />
    </svg>
  );
}
