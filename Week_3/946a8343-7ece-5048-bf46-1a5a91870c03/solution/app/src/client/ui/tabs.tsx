// <Tabs label tabs value? defaultValue? onChange?>   role=tablist named `label`, role=tab buttons with roving tabindex and
// ArrowLeft/ArrowRight/Home/End (automatic activation, wrapping), and the active role=tabpanel (only that panel is rendered).
// tabs: [{ id, label, panel }]. Controlled with value/onChange, or uncontrolled with defaultValue (default: first tab).
import type { ComponentChildren } from "preact";
import { useId, useRef, useState } from "preact/hooks";

interface TabItem {
  id: string;
  label: string;
  panel: ComponentChildren;
}

interface TabsProps {
  label: string;
  tabs: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  class?: string;
}

export function Tabs({ label, tabs, value, defaultValue, onChange, class: className }: TabsProps) {
  const base = useId();
  const [inner, setInner] = useState(defaultValue ?? tabs[0]?.id ?? "");
  const current = value ?? inner;
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const select = (id: string, focus: boolean) => {
    setInner(id);
    onChange?.(id);
    if (focus) buttons.current.get(id)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const go = (to: number) => {
      const target = tabs[to];
      if (!target) return;
      event.preventDefault();
      select(target.id, true);
    };
    if (event.key === "ArrowRight") go(index === last ? 0 : index + 1);
    else if (event.key === "ArrowLeft") go(index === 0 ? last : index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(last);
  };
  const active = tabs.find((tab) => tab.id === current) ?? tabs[0];
  return (
    <div class={`sp-tabs${className ? ` ${className}` : ""}`}>
      <div role="tablist" aria-label={label} class="sp-tabs__list">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) buttons.current.set(tab.id, el);
              else buttons.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={tab.id === active?.id ? "true" : "false"}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={tab.id === active?.id ? 0 : -1}
            class="sp-tabs__tab"
            onClick={() => select(tab.id, false)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {active ? (
        <div role="tabpanel" id={`${base}-panel-${active.id}`} aria-labelledby={`${base}-tab-${active.id}`} tabIndex={0} class="sp-tabs__panel">
          {active.panel}
        </div>
      ) : null}
    </div>
  );
}
