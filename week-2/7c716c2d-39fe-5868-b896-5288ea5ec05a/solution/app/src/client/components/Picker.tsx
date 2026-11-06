// The status and assignee pickers: a listbox that opens with focus on its first option, moves
// with Up and Down, chooses with Enter or a click, closes on Escape, keeps Tab inside, and hands
// focus back to the element that had it before it opened.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExit } from "./exit";

interface PickerOption {
  value: string;
  label: string;
}

export interface PickerRequest {
  issueKey: string;
  label: string;
  options: PickerOption[];
  anchor: HTMLElement;
  returnFocus: HTMLElement | null;
  onChoose: (value: string) => void;
}

export function Picker(props: { request: PickerRequest; onDone: () => void }): JSX.Element {
  const { request, onDone } = props;
  const list = useRef<HTMLDivElement>(null);
  const panel = useExit<HTMLDivElement>("pop");
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const box = request.anchor.getBoundingClientRect();
    const width = 240;
    const height = Math.min(window.innerHeight - 16, request.options.length * 45 + 2);
    const below = box.bottom + 4 + height <= window.innerHeight - 8;
    setPlace({
      top: below ? box.bottom + 4 : Math.max(8, Math.min(window.innerHeight - 8 - height, box.top - 4 - height)),
      left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
    });
  }, [request]);

  useLayoutEffect(() => {
    list.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.focus();
  }, [active]);

  const close = (value: string | null): void => {
    onDone();
    request.returnFocus?.focus();
    if (value !== null) request.onChoose(value);
  };

  useEffect(() => {
    const outside = (event: PointerEvent): void => {
      if (list.current && !list.current.contains(event.target as Node)) close(null);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  });

  return createPortal(
    <div ref={panel} className="picker" style={{ top: place.top, left: place.left }}>
      <div
        ref={list}
        role="listbox"
        aria-label={request.label}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => Math.min(request.options.length - 1, i + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const option = request.options[active];
            if (option) close(option.value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            close(null);
          } else if (event.key === "Tab") {
            event.preventDefault();
          }
        }}
      >
        {request.options.map((option, i) => (
          <div
            key={option.value}
            role="option"
            tabIndex={i === active ? 0 : -1}
            aria-selected={i === active}
            className="picker-option"
            onClick={() => close(option.value)}
            onFocus={() => setActive(i)}
          >
            {option.label}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
