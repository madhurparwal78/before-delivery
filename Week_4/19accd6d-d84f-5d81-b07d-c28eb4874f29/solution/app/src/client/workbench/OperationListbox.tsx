import { useId } from "react";
import type { KeyboardEvent } from "react";

interface OperationListboxProps {
  label: string;
  operations: readonly string[];
  /** Index of the active option, or -1 for none. */
  active: number;
  onActive: (index: number) => void;
  onChoose: (operation: string) => void;
  /** Whether the listbox is a Tab stop of its own; the finder drives the flat results without being one. */
  tabbable?: boolean;
  /** An id prefix so a search field can point at the active option. */
  idPrefix?: string;
}

const optionId = (prefix: string, index: number): string => `${prefix}-option-${index}`;

/** Wraps an index around either end of a list of `length` options. */
export const stepIndex = (index: number, delta: number, length: number): number =>
  index < 0 ? (delta > 0 ? 0 : length - 1) : (index + delta + length) % length;

/** A listbox of operations: one Tab stop, arrows move the active option, Enter or a click adds it. */
export function OperationListbox({ label, operations, active, onActive, onChoose, tabbable = true, idPrefix }: OperationListboxProps) {
  const generated = useId();
  const prefix = idPrefix ?? generated;
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      onActive(stepIndex(active, event.key === "ArrowDown" ? 1 : -1, operations.length));
    } else if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && active >= 0) {
      event.preventDefault();
      onChoose(operations[active] as string);
    }
  };
  return (
    <ul
      role="listbox"
      aria-label={label}
      className="operation-list"
      tabIndex={tabbable ? 0 : -1}
      aria-activedescendant={active >= 0 ? optionId(prefix, active) : undefined}
      onKeyDown={onKeyDown}
      onFocus={() => active < 0 && operations.length > 0 && onActive(0)}
    >
      {operations.map((operation, index) => (
        <li
          key={operation}
          id={optionId(prefix, index)}
          role="option"
          aria-selected={index === active}
          className="operation-option"
          data-active={index === active}
          onClick={() => {
            onActive(index);
            onChoose(operation);
          }}
        >
          {operation}
        </li>
      ))}
    </ul>
  );
}
