// The Problems summary and the 422 → field error mapping. `useFormErrors` maps each API field key to its
// control id; `take` shows a 422's errors and announces the count; `Problems` sits at the top of the form or
// dialog, and `error(field)` gives each control its inline message.

import { useEffect, useRef, useState } from "react";
import type { ApiErrorBody } from "../api.js";

export interface Problem {
  id: string;
  text: string;
}

export function problemsCopy(count: number): string {
  return count === 1 ? "Please fix 1 problem." : `Please fix ${count} problems.`;
}

export function useFormErrors(fields: Record<string, string>) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const problems: Problem[] = Object.entries(errors).map(([key, text]) => ({ id: fields[key] ?? key, text }));
  return {
    errors,
    problems,
    error: (key: string): string | undefined => errors[key],
    clear: () => setErrors({}),
    set: setErrors,
    /** Takes a 422 body: shows its errors and announces the count. False for any other error. */
    take(body: ApiErrorBody, announce?: (text: string) => void): boolean {
      if (body.error !== "validation" || !body.errors) return false;
      setErrors(body.errors);
      announce?.(problemsCopy(Object.keys(body.errors).length));
      return true;
    },
  };
}

export function Problems({ items, level = 2, focusOnShow = true }: {
  items: Problem[];
  level?: 2 | 3;
  focusOnShow?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const signature = items.map((item) => `${item.id}:${item.text}`).join("|");
  useEffect(() => {
    if (signature && focusOnShow) heading.current?.focus();
  }, [signature, focusOnShow]);
  if (!items.length) return null;
  const title = items.length === 1 ? "There is a problem" : `There are ${items.length} problems`;
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <section className="problems" aria-label="Problems">
      <Tag ref={heading} tabIndex={-1}>{title}</Tag>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} onClick={(event) => {
              event.preventDefault();
              document.getElementById(item.id)?.focus();
            }}>{item.text}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
