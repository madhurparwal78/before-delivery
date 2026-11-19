import { useId, useRef, useState } from "react";

// One keyboard model for every tab set: roving tabindex, arrows wrap and select, Home and End. `mayLeave` can hold
// the current tab (the Builder keeps unreadable YAML on its tab).
export function useTabs(names, initial = 0, mayLeave = () => true) {
  const [selected, setSelected] = useState(initial);
  const refs = useRef([]);
  const base = useId();
  const id = (kind, index) => `${base}-${kind}-${index}`;

  const select = (index) => {
    if (index === selected || mayLeave()) setSelected(index);
  };
  const choose = (index) => {
    if (index !== selected && !mayLeave()) return;
    setSelected(index);
    refs.current[index]?.focus();
  };
  const onKeyDown = (event) => {
    const last = names.length - 1;
    const moves = { ArrowRight: selected === last ? 0 : selected + 1, ArrowLeft: selected === 0 ? last : selected - 1, Home: 0, End: last };
    if (event.key in moves) {
      event.preventDefault();
      choose(moves[event.key]);
    }
  };
  const tabProps = (index) => ({
    id: id("tab", index),
    role: "tab",
    type: "button",
    className: "tab",
    "aria-selected": selected === index,
    "aria-controls": id("panel", index),
    tabIndex: selected === index ? 0 : -1,
    ref: (el) => { refs.current[index] = el; },
    onClick: () => select(index),
    onKeyDown,
  });
  const panelProps = (index) => ({
    id: id("panel", index),
    role: "tabpanel",
    "aria-labelledby": id("tab", index),
    hidden: selected !== index,
    className: "tabpanel",
  });
  return { selected, tabProps, panelProps };
}

export function Tabs({ label, names, render, className = "" }) {
  const { tabProps, panelProps } = useTabs(names);
  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="tablist">
        {names.map((name, index) => <button key={name} {...tabProps(index)}>{name}</button>)}
      </div>
      {names.map((name, index) => (
        <div key={name} {...panelProps(index)}>{render(index)}</div>
      ))}
    </div>
  );
}
