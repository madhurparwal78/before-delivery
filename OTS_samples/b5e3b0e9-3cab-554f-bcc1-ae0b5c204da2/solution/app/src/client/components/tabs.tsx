import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";

interface TabSpec {
  id: string;
  label: string;
}

interface TabsProps {
  label: string;
  tabs: TabSpec[];
  selected: string;
  onSelect: (id: string) => void;
}

/** A tablist that is one tab stop on its selected tab; the arrow keys change the tab. */
export function Tabs({ label, tabs, selected, onSelect }: TabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = tabs.findIndex((t) => t.id === selected);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (!next) return;
    onSelect(next.id);
    list.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} class="tablist" ref={list} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${label}-${tab.id}`}
          data-tab={tab.id}
          aria-selected={tab.id === selected ? "true" : "false"}
          aria-controls={`panel-${label}-${tab.id}`}
          tabIndex={tab.id === selected ? 0 : -1}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ label, id, selected, children }: { label: string; id: string; selected: boolean; children: ComponentChildren }) {
  return (
    <div role="tabpanel" id={`panel-${label}-${id}`} aria-labelledby={`tab-${label}-${id}`} hidden={!selected} class="tabpanel">
      {children}
    </div>
  );
}
