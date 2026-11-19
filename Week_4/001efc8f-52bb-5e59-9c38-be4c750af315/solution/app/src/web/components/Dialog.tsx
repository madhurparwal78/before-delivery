import { useEffect, useId, useRef, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { firstField, focusables, useLayer } from "./layers";

// A modal dialog: focus moves to its first field, Tab stays inside, Escape closes it and focus
// returns to the control that opened it.
export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();
  useLayer("dialog", onClose);
  useEffect(() => {
    if (ref.current) firstField(ref.current)?.focus();
  }, []);

  const trap = (event: React.KeyboardEvent) => {
    if (event.key !== "Tab" || !ref.current) return;
    const items = focusables(ref.current);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="backdrop">
      <div ref={ref} className={`dialog${wide ? " dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={headingId} onKeyDown={trap}>
        <h2 id={headingId} className="dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export type FieldErrors = Record<string, string>;

// "Check the highlighted fields." with one link per field error; each link focuses its field.
export function ErrorSummary({ errors, ids }: { errors: FieldErrors; ids: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const entries = Object.entries(errors);
  useEffect(() => {
    if (entries.length > 0) ref.current?.focus();
  }, [errors, entries.length]);
  if (entries.length === 0) return null;
  return (
    <div ref={ref} className="error-summary" tabIndex={-1}>
      <h3>Check the highlighted fields.</h3>
      <ul>
        {entries.map(([field, copy]) => (
          <li key={field}>
            <a
              href={`#${ids[field] ?? ""}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(ids[field] ?? "")?.focus();
              }}
            >
              {copy}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FieldError({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <p id={id} className="field-error">
      <TriangleAlert aria-hidden="true" size={16} />
      <span>{text}</span>
    </p>
  );
}
