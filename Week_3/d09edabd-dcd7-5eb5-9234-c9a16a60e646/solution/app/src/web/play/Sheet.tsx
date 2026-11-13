import type { ReactNode } from 'react';
import { X } from '../ui/icons';
import { Dialog } from '../ui/Dialog';

interface Props {
  name: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** A centred sheet of the tester page; on a phone it is a full-width sheet that ends above the tab bar. */
export function Sheet({ name, open, onClose, children }: Props) {
  return (
    <Dialog name={name} open={open} onClose={onClose} className="centered play-sheet">
      <div className="dialog-head">
        <h2>{name}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </Dialog>
  );
}
