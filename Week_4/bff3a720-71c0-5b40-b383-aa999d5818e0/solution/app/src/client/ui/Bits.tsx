import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { hasNavigated } from "../lib/router";
import { Plate } from "./Plate";

export function Alert({ children }: { children?: ReactNode }): ReactElement | null {
  if (!children) return null;
  return (
    <div role="alert" className="alert">
      {children}
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message: string | undefined }): ReactElement | null {
  return message ? (
    <p id={id} className="field-error">
      {message}
    </p>
  ) : null;
}

/** A page heading that takes focus when the page was reached by in-app navigation. */
export function PageHeading({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  const ref = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (hasNavigated()) ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className={className}>
      {children}
    </h1>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }): ReactElement {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

export function StatusLine({ text }: { text: string }): ReactElement | null {
  return text ? <p className="status-line">{text}</p> : null;
}

export function EmptyState({ sentence, seed }: { sentence: string; caption?: string; seed: string }): ReactElement {
  return (
    <div className="empty">
      <p className="empty-sentence">{sentence}</p>
      <Plate seed={seed} ratio={1} caption="" noCaption decorative className="plate-empty" />
    </div>
  );
}

