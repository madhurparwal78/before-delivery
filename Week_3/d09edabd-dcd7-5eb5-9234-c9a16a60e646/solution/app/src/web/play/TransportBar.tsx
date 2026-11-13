import type { ReactNode } from 'react';
import { Check, CircleHelp, Lightbulb, LogIn, Puzzle } from '../ui/icons';
import { usePhone } from '../ui/hooks';
import type { Units } from '../../shared/units';
import { JOIN_FORM } from './useJoin';

export type SheetName = 'puzzles' | 'hints' | 'help';

interface Props {
  joined: boolean;
  joining: boolean;
  units: Units;
  onToggleUnits: () => void;
  onOpen: (sheet: SheetName) => void;
}

interface ControlProps {
  phone: boolean;
  label: string;
  pressed?: boolean;
  onClick: () => void;
  /** The control shows a glyph that is not its name (Units shows m or ft): the name comes from the label text, not an aria-label that would contradict what is seen. */
  byContent?: boolean;
  children: ReactNode;
}

/** One transport control: a labelled tab on a phone, an icon button on a desktop. */
function Control({ phone, label, pressed, onClick, byContent = false, children }: ControlProps) {
  return (
    <button type="button" className={phone ? 'tab' : 'chrome-btn'} aria-label={byContent ? undefined : label} title={phone ? undefined : label} aria-pressed={pressed} onClick={onClick}>
      {children}
      {phone || byContent ? <span className={phone ? undefined : 'visually-hidden'}>{label}</span> : null}
    </button>
  );
}

/** The bottom bar: Puzzles, Hints, the round Join button, Units and Help. The phone gets the tab bar with Join raised. */
export function TransportBar({ joined, joining, units, onToggleUnits, onOpen }: Props) {
  const phone = usePhone();
  const join = (
    <button type="submit" form={JOIN_FORM} className={phone ? 'round-play raised' : 'round-play'} disabled={joined || joining}>
      {joined ? <Check size={22} aria-hidden="true" /> : <LogIn size={22} aria-hidden="true" />}
      <span className="visually-hidden">{joined ? 'Joined' : 'Join'}</span>
    </button>
  );
  return (
    <div className={phone ? 'tabbar play-bar' : 'transport play-bar'} role="toolbar" aria-label="Transport">
      <Control phone={phone} label="Puzzles" onClick={() => onOpen('puzzles')}>
        <Puzzle size={18} aria-hidden="true" />
      </Control>
      <Control phone={phone} label="Hints" onClick={() => onOpen('hints')}>
        <Lightbulb size={18} aria-hidden="true" />
      </Control>
      {phone ? (
        <div className="slot-play">
          {join}
          <span className="slot-label" aria-hidden="true">
            {joined ? 'Joined' : 'Join'}
          </span>
        </div>
      ) : (
        join
      )}
      <Control phone={phone} label="Units" pressed={units === 'ft'} onClick={onToggleUnits} byContent>
        <span className="units-glyph" aria-hidden="true">{units}</span>
      </Control>
      <Control phone={phone} label="Help" onClick={() => onOpen('help')}>
        <CircleHelp size={18} aria-hidden="true" />
      </Control>
    </div>
  );
}
