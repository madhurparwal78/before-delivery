import type { ReactNode } from 'react';
import type { PanelName, Panels } from './usePanels.ts';

/** `region "<name>"`: the body of a panel, a focus stop for F6. */
export function PanelRegion({ name, panels, children }: { name: PanelName; panels: Panels; children: ReactNode }) {
  return (
    <section className="panel-region" aria-label={name} tabIndex={-1} ref={panels.stopRef(name)}>
      {children}
    </section>
  );
}
