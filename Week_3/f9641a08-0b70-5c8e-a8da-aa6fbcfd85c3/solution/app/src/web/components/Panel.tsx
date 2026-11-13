import type { ReactNode } from "react";

export type Tone = "charcoal" | "surface" | "teal" | "red" | "blue" | "yellow";

interface PanelProps {
  tone?: Tone;
  busy?: boolean;
  role?: "alert" | "status";
  /** Renders the sentence as the page's level 1 heading. */
  heading?: boolean;
  children: ReactNode;
}

/** An empty, loading or error state: a whole colour panel with one short sentence on the axis. */
export function Panel({ tone = "teal", busy, role, heading, children }: PanelProps) {
  return (
    <section className={`panel tone-${tone}`} aria-busy={busy ? "true" : undefined} role={role} data-page={tone}>
      {heading ? <h1 className="panel-text">{children}</h1> : <p className="panel-text">{children}</p>}
    </section>
  );
}

export function Loading() {
  return <Panel tone="surface" busy>Loading</Panel>;
}

export function ServerError() {
  return <Panel tone="red">Something went wrong on our side. Try again.</Panel>;
}
