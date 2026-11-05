// Field errors on a 422: each message becomes its field's description, the field is marked invalid, and focus moves
// to the first invalid field in form order. Resubmitting clears the marks of fields that are now valid.

import { useLayoutEffect, useRef, useState } from "react";

interface FieldErrors {
  errors: Record<string, string>;
  /** Props for the control behind API key `key`. */
  bind: (key: string) => { id: string; "aria-invalid"?: true; "aria-describedby"?: string; ref: (node: HTMLElement | null) => void };
  errorId: (key: string) => string;
  /** Shows a 422's `fields` and focuses the first one in `order`. */
  show: (fields: Record<string, string>, order: readonly string[]) => void;
  clear: () => void;
}

export function useFieldErrors(prefix: string): FieldErrors {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const nodes = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const idOf = (key: string): string => `${prefix}-${key.replace(/[^a-zA-Z0-9]/g, "-")}`;

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    nodes.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [errors]);

  return {
    errors,
    errorId: (key) => `${idOf(key)}-error`,
    bind: (key) => ({
      id: idOf(key),
      ...(errors[key] ? { "aria-invalid": true as const, "aria-describedby": `${idOf(key)}-error` } : {}),
      ref: (node) => {
        if (node) nodes.current.set(key, node);
        else nodes.current.delete(key);
      },
    }),
    show: (fields, order) => {
      pendingFocus.current = order.find((key) => key in fields) ?? Object.keys(fields)[0] ?? null;
      setErrors({ ...fields });
    },
    clear: () => setErrors({}),
  };
}
