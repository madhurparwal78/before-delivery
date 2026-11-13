import type { RefObject } from "react";
import { BagContents } from "./BagContents";
import { Dialog } from "./Dialog";

interface Props {
  open: boolean;
  onClose: () => void;
  openerRef: RefObject<HTMLElement | null>;
}

export function BagDrawer({ open, onClose, openerRef }: Props) {
  return (
    <Dialog title="Your bag" kind="drawer" open={open} onClose={onClose} openerRef={openerRef}>
      <BagContents onNavigate={onClose} />
    </Dialog>
  );
}
