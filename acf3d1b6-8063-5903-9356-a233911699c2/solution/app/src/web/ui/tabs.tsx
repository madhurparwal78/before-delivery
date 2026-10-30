import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';

interface TabsProps {
  id: string;
  label: string;
  tabs: string[];
  selected: number;
  onSelect: (index: number) => void;
  /** Every panel is rendered (hidden unless chosen) so its words are in the first HTML. */
  panels?: ComponentChildren[];
  class?: string;
}

/** A tab list chosen by click, tap or the arrow keys (Home and End too). */
export function Tabs({ id, label, tabs, selected, onSelect, panels, class: className }: TabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const choose = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    onSelect(next);
    list.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowRight: selected + 1, ArrowLeft: selected - 1, Home: 0, End: tabs.length - 1 };
    if (event.key in moves) {
      event.preventDefault();
      choose(moves[event.key]);
    }
  };
  return (
    <>
      <div ref={list} class={`tablist ${className ?? ''}`} role="tablist" aria-label={label} onKeyDown={onKey}>
        {tabs.map((tab, index) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            class="tab"
            aria-selected={index === selected ? 'true' : 'false'}
            aria-controls={panels ? `${id}-panel-${index}` : `${id}-panel`}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => onSelect(index)}
          >
            {tab}
          </button>
        ))}
      </div>
      {panels?.map((panel, index) => (
        <div
          key={index}
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          class="tabpanel"
          hidden={index !== selected}
          tabIndex={0}
        >
          {panel}
        </div>
      ))}
    </>
  );
}

/** The single panel of a tab list whose content is filtered rather than swapped (examples, templates, plans). */
export function TabPanel({ id, selected, children, class: className }: { id: string; selected: number; children: ComponentChildren; class?: string }) {
  return (
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${selected}`} class={className}>
      {children}
    </div>
  );
}
