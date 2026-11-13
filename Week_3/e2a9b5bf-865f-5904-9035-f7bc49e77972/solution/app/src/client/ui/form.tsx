import type { JSX } from "preact";
import { useRef } from "preact/hooks";

let counter = 0;
export const nextId = (prefix: string) => `${prefix}-${++counter}`;

interface FieldProps {
  label: string;
  id: string;
  error?: string | undefined;
  children: JSX.Element;
}

export function FieldShell({ label, id, error, children }: FieldProps) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      {children}
      {error ? (
        <p class="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Runs an async action once at a time: presses while one is unanswered do nothing. */
export function useSingleFlight() {
  const busy = useRef(false);
  return async function run(action: () => Promise<void>): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    try {
      await action();
    } finally {
      busy.current = false;
    }
  };
}

export function firstInvalid(order: string[], fields: Record<string, string> | undefined): string | null {
  if (!fields) return null;
  return order.find((name) => name in fields) ?? Object.keys(fields)[0] ?? null;
}
