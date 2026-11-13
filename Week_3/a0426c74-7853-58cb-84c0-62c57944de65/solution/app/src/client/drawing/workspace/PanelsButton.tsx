import { Button } from '../../ui/index.ts';
import type { Panels } from './usePanels.ts';

/** `button "Panels"` of the phone layout, which opens the bottom sheet of panels; the other layouts show their panels without it. */
export function PanelsButton({ panels }: { panels: Panels }) {
  return panels.layout === 'phone' ? <Button ref={panels.sheetOpener} onClick={() => panels.openSheet()}>Panels</Button> : null;
}
