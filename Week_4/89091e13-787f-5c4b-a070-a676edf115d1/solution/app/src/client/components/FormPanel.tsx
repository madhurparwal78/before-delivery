import type { ReactNode } from "react";
import { Ring } from "./Ring.tsx";

/** A spotlight-style panel: the heading and form on the left, decorative ring art on the right (wide screens). */
export function FormPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel form-panel">
      <h2 className="form-title">{title}</h2>
      {children}
      <div className="form-panel__art" aria-hidden="true"><Ring /></div>
    </section>
  );
}
