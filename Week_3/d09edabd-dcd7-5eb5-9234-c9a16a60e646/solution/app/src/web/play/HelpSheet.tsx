import type { PlayView } from '../../shared/types';
import type { Units } from '../../shared/units';
import { Sheet } from './Sheet';
import { sizeText } from './sizeText';

interface Props {
  open: boolean;
  onClose: () => void;
  room: PlayView['room'];
  units: Units;
}

/** How to move around, and the room's size in the chosen units. */
export function HelpSheet({ open, onClose, room, units }: Props) {
  return (
    <Sheet name="Help" open={open} onClose={onClose}>
      <ul className="help-list">
        <li>Walk with W A S D or the arrow keys.</li>
        <li>Drag to look around.</li>
        <li>On a phone, drag the left half of the stage to walk and the right half to look.</li>
        <li>Walk up to a prop to open its puzzle.</li>
      </ul>
      <dl className="help-size">
        <dt>Room (width × depth × height)</dt>
        <dd>{sizeText(room.widthMm, room.depthMm, room.heightMm, units)}</dd>
      </dl>
    </Sheet>
  );
}
