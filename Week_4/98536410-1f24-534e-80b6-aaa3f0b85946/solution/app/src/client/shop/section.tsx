// A back-office section: a plain heading from 700 pixels wide, a disclosure button below it.
import { type ReactNode } from "react";
import { Overlay } from "../lib/overlay";

export function Section({ name, wide, open, onToggle, className, children }: {
  name: string; wide: boolean; open: boolean; onToggle: () => void; className: string; children: ReactNode;
}) {
  if (wide) {
    return (
      <section className={`shop-section ${className}`} aria-labelledby={`h-${className}`}>
        <h2 id={`h-${className}`}>{name}</h2>
        <div data-state="open" className="section-body">{children}</div>
      </section>
    );
  }
  return (
    <section className={`shop-section ${className}`}>
      <h2>
        <button type="button" className="disclosure" aria-expanded={open} onClick={onToggle}>
          <span>{name}</span>
          <span aria-hidden="true">{open ? "−" : "+"}</span>
        </button>
      </h2>
      <Overlay open={open} role="region" label={name} passive modal={false} onClose={() => undefined} className="section-body">
        {children}
      </Overlay>
    </section>
  );
}
