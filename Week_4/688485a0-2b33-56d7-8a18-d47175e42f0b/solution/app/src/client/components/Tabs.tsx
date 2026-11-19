import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";

/** Phone tabs (Query, Results, Pipeline): arrow keys move between tabs and select them; unselected panels are hidden. */

const TAB_NAMES = ["Query", "Results", "Pipeline"] as const;
export type TabName = (typeof TAB_NAMES)[number];

interface Props {
  selected: TabName;
  onSelect: (tab: TabName, focus: boolean) => void;
  panels: Record<TabName, ReactNode>;
  /** Asks for focus on a tab; a new object each time moves focus again. */
  focusRequest: { tab: TabName } | null;
}

/** A panel renders its children once it has been selected, so a heavy panel loads on demand. */
export function Tabs({ selected, onSelect, panels, focusRequest }: Props): ReactNode {
  const refs = useRef<Partial<Record<TabName, HTMLButtonElement | null>>>({});
  const visited = useRef<Set<TabName>>(new Set());
  visited.current.add(selected);
  useEffect(() => {
    if (focusRequest) refs.current[focusRequest.tab]?.focus();
  }, [focusRequest]);
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = move === 0 ? undefined : TAB_NAMES[(index + move + TAB_NAMES.length) % TAB_NAMES.length];
    if (!target) return;
    event.preventDefault();
    onSelect(target, true);
    refs.current[target]?.focus();
  };
  return (
    <div className="tabs">
      <div role="tablist" aria-label="Workspace" className="tablist">
        {TAB_NAMES.map((tab, index) => (
          <button
            key={tab}
            ref={(node) => {
              refs.current[tab] = node;
            }}
            type="button"
            role="tab"
            id={`tab-${tab}`}
            aria-selected={selected === tab}
            aria-controls={`panel-${tab}`}
            tabIndex={selected === tab ? 0 : -1}
            className="tab"
            onClick={() => onSelect(tab, false)}
            onKeyDown={(event) => onKey(event, index)}
          >
            {tab}
          </button>
        ))}
      </div>
      {TAB_NAMES.map((tab) => (
        <div key={tab} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} hidden={selected !== tab} className="tabpanel">
          {visited.current.has(tab) ? panels[tab] : null}
        </div>
      ))}
    </div>
  );
}
