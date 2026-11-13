import type { PlayView } from '../../shared/types';
import { Sheet } from './Sheet';

interface Props {
  open: boolean;
  onClose: () => void;
  hints: PlayView['hints'];
}

/** The hints the game master has sent, newest first. */
export function HintsSheet({ open, onClose, hints }: Props) {
  return (
    <Sheet name="Hints" open={open} onClose={onClose}>
      {hints.length === 0 ? (
        <p className="muted">No hints yet.</p>
      ) : (
        <ol className="hint-list">
          {[...hints].reverse().map((hint) => (
            <li key={hint.sentAt}>{hint.text}</li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
