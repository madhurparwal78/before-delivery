import type { ReactElement } from 'react';
import { chipLabel, type DeliveryChip } from '../shared/chips';
import {
  CheckGlyph,
  DoubleCheckGlyph,
  EyeGlyph,
  HourglassGlyph,
  LockGlyph,
  PencilGlyph,
  PinGlyph,
  WarningGlyph,
} from './Icons';

export function DeliveryStateChip({ chip, dimmed }: { chip: DeliveryChip; dimmed?: boolean }): ReactElement {
  const glyph =
    chip.state === 'pending' ? (
      <HourglassGlyph />
    ) : chip.state === 'sent' ? (
      <CheckGlyph />
    ) : chip.state === 'delivered' ? (
      <DoubleCheckGlyph />
    ) : chip.state === 'read' ? (
      <EyeGlyph />
    ) : (
      <WarningGlyph />
    );
  const classes = ['chip', `chip-${chip.state}`];
  if (dimmed === true) classes.push('chip-dimmed');
  return (
    <span className={classes.join(' ')}>
      {glyph}
      <span className="chip-word">{chipLabel(chip)}</span>
    </span>
  );
}

export function PinnedChip({ dimmed }: { dimmed?: boolean }): ReactElement {
  return (
    <span className={dimmed === true ? 'chip chip-pinned chip-dimmed' : 'chip chip-pinned'}>
      <PinGlyph />
      <span className="chip-word">Pinned</span>
    </span>
  );
}

export function EditedChip(): ReactElement {
  return (
    <span className="chip chip-edited">
      <PencilGlyph />
      <span className="chip-word">Edited</span>
    </span>
  );
}

export function PrivateChip(): ReactElement {
  return (
    <span className="chip chip-private">
      <LockGlyph />
      <span className="chip-word">Private</span>
    </span>
  );
}

export function RoleChip({ label }: { label: string }): ReactElement {
  return <span className="chip chip-role">{label}</span>;
}
