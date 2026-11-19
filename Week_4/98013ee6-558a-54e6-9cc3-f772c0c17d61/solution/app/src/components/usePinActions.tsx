import { useState, type ReactNode } from "react";
import { SaveDialog } from "../dialogs/SaveDialog";
import { handOverPin } from "../lib/hooks";
import { navigate, setPendingCarry, useLocation } from "../lib/router";
import type { Pin } from "../../shared/types";

/** Opening a pin carries its image out of the grid; saving opens the save dialog. */
export function usePinActions(): { open: (pin: Pin, card: HTMLElement) => void; save: (pin: Pin) => void; dialog: ReactNode } {
  const [saving, setSaving] = useState<Pin | null>(null);
  const location = useLocation();
  return {
    open: (pin, card) => {
      const image = card.querySelector("img");
      if (image) {
        const rect = image.getBoundingClientRect();
        setPendingCarry({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      }
      handOverPin(pin);
      navigate(`/pin/${pin.id}`, { state: { background: { pathname: location.pathname, search: location.search }, cardId: pin.id } });
    },
    save: (pin) => setSaving(pin),
    dialog: saving ? <SaveDialog pin={saving} onClose={() => setSaving(null)} /> : null,
  };
}
