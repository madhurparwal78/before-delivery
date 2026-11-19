import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

interface Query {
  start: number;
  prefix: string;
}

interface MentionFieldProps {
  id: string;
  label?: string;
  labelledBy?: string;
  value: string;
  onValue: (value: string) => void;
  handles: string[];
  describedBy?: string | undefined;
  rows?: number;
  disabled?: boolean;
}

const MENTION_AT_CARET = /(^|\s)@([a-z0-9]*)$/;

/** A comment or reply box whose `@` opens the Mention people list. */
export function MentionField(props: MentionFieldProps): JSX.Element {
  const { id, label, value, onValue, handles, describedBy, rows = 3, disabled } = props;
  const field = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const caretAfter = useRef<number | null>(null);
  const [query, setQuery] = useState<Query | null>(null);
  const [active, setActive] = useState(0);

  const matches = query ? handles.filter((handle) => handle.startsWith(query.prefix)) : [];
  const open = matches.length > 0;
  const highlighted = open ? Math.min(active, matches.length - 1) : 0;

  useLayoutEffect(() => {
    const element = field.current;
    if (element && caretAfter.current !== null) {
      element.setSelectionRange(caretAfter.current, caretAfter.current);
      caretAfter.current = null;
    }
    const popup = list.current;
    if (!popup || !element) return;
    if (!popup.matches(":popover-open")) popup.showPopover();
    const box = element.getBoundingClientRect();
    const height = popup.offsetHeight;
    const width = popup.offsetWidth;
    const below = box.bottom + 4;
    let top = below + height <= innerHeight - 4 ? below : box.top - height - 4;
    top = Math.max(4, Math.min(top, innerHeight - height - 4));
    const left = Math.max(4, Math.min(box.left, innerWidth - width - 4));
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
  });

  const detect = (element: HTMLTextAreaElement) => {
    const caret = element.selectionStart;
    if (caret !== element.selectionEnd) {
      setQuery(null);
      return;
    }
    const found = MENTION_AT_CARET.exec(element.value.slice(0, caret));
    if (!found) {
      setQuery(null);
      return;
    }
    const prefix = (found[2] as string).toLowerCase();
    if (!query || query.prefix !== prefix) setActive(0);
    setQuery({ start: caret - prefix.length - 1, prefix });
  };

  const insert = (handle: string) => {
    const element = field.current;
    if (!element || !query) return;
    const caret = element.selectionStart;
    const text = `@${handle} `;
    const next = value.slice(0, query.start) + text + value.slice(caret);
    caretAfter.current = query.start + text.length;
    element.value = next;
    element.setSelectionRange(caretAfter.current, caretAfter.current);
    setQuery(null);
    onValue(next);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "a") {
      // Select the whole box on every platform (macOS would move to the line start).
      event.preventDefault();
      event.currentTarget instanceof HTMLTextAreaElement && event.currentTarget.select();
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((highlighted + step + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insert(matches[highlighted] as string);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setQuery(null);
    }
  };

  const optionId = (handle: string) => `${id}-mention-${handle}`;
  const popoverAttributes = { popover: "manual" } as Record<string, string>;

  return (
    <>
      <textarea
        ref={field}
        id={id}
        class="mention-field"
        rows={rows}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-labelledby={props.labelledBy}
        aria-describedby={describedBy}
        aria-autocomplete="list"
        aria-controls={open ? `${id}-mentions` : undefined}
        aria-expanded={open ? "true" : "false"}
        aria-activedescendant={open ? optionId(matches[highlighted] as string) : undefined}
        onInput={(event) => {
          const element = event.currentTarget;
          onValue(element.value);
          detect(element);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setQuery(null)}
      />
      {open ? (
        <div ref={list} id={`${id}-mentions`} class="mention-list" role="listbox" aria-label="Mention people" {...popoverAttributes}>
          {matches.map((handle, index) => (
            <div
              key={handle}
              id={optionId(handle)}
              role="option"
              aria-selected={index === highlighted ? "true" : "false"}
              class="mention-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(handle)}
            >
              @{handle}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
