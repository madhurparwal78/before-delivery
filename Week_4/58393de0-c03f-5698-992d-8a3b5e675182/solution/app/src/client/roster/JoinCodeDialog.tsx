import { Dialog } from "../ui/Dialog";

interface JoinCodeDialogProps {
  open: boolean;
  code: string;
  onNewCode: () => void;
  onClose: () => void;
}

/** The current join code in large equal-width letters; `New code` replaces it in place. */
export function JoinCodeDialog({ open, code, onNewCode, onClose }: JoinCodeDialogProps) {
  return (
    <Dialog open={open} title="Join code" onClose={onClose} className="join-code-dialog">
      <p className="join-code">
        {[...code].map((letter, index) => <span key={`${index}-${letter}`} className="join-code-letter">{letter}</span>)}
      </p>
      <p className="hint">Read it out or write it on the board. Students type it at Join a class.</p>
      <div className="dialog-actions">
        <button type="button" className="pill" onClick={onNewCode}>New code</button>
        <button type="button" className="pill pill--outline" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
