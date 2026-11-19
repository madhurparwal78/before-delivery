import type { ReactNode } from "react";
import { TitleBar } from "./Pane";

/** A secondary screen: one pane in the workbench's language, with its title bar and an optional status strip. */
export function Screen({ label, title, actions, children, strip, narrow }: {
  label: string; title: ReactNode; actions?: ReactNode; children: ReactNode; strip?: ReactNode; narrow?: boolean;
}) {
  return (
    <main className={narrow ? "screen screen-narrow" : "screen"}>
      <section role="region" aria-label={label} tabIndex={-1} className="pane screen-pane">
        <TitleBar title={title} heading={1}>{actions}</TitleBar>
        <div className="pane-body screen-body">{children}</div>
        {strip && <div className="status-strip">{strip}</div>}
      </section>
    </main>
  );
}
