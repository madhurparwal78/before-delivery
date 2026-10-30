import { type RefObject, useLayoutEffect, useRef } from "react";
import { enter, leave, type Offset } from "../motion";

/**
 * Open/closed state for a drawer, sheet or overlay. A closed panel is `hidden` (so nothing inside is visible,
 * focusable, clickable or in the accessibility tree); while it fades out it is already inert and aria-hidden.
 * A null offset opens and closes in place (the wide ledger column collapses at once so the editor widens).
 */
export function usePanel(ref: RefObject<HTMLElement>, open: boolean, offset: Offset | null): void {
  const shown = useRef<boolean | null>(null);
  // Runs after every render: the panel may mount after the hook (the workspace renders once its data is in).
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    if (shown.current === null) {
      shown.current = open;
      panel.hidden = !open;
      return;
    }
    if (shown.current === open) return;
    shown.current = open;
    if (open) {
      panel.hidden = false;
      panel.removeAttribute("inert");
      panel.removeAttribute("aria-hidden");
      if (offset) enter(panel, offset);
      return;
    }
    if (!offset) {
      panel.hidden = true;
      return;
    }
    panel.setAttribute("inert", "");
    panel.setAttribute("aria-hidden", "true");
    void leave(panel, offset).then(() => {
      if (panel.hasAttribute("inert")) panel.hidden = true;
    });
  });
}
