// The editor's keyboard shortcuts, opened from the Welcome panel.
import { SHORTCUTS } from '../../../shared/commands.ts';
import { Dialog } from '../../ui/Dialog.tsx';

export function ShortcutsDialog({ onClose, returnFocus }: { onClose: () => void; returnFocus: () => HTMLElement | null }) {
  return (
    <Dialog label="Keyboard shortcuts" onClose={onClose} returnFocus={returnFocus}>
      <h2>Keyboard shortcuts</h2>
      <table className="reference-table">
        <caption className="sr-only">Editor shortcuts</caption>
        <thead><tr><th scope="col">Keys</th><th scope="col">Action</th></tr></thead>
        <tbody>
          {SHORTCUTS.map((shortcut) => <tr key={shortcut.keys}><th scope="row">{shortcut.keys}</th><td>{shortcut.action}</td></tr>)}
        </tbody>
      </table>
      <div className="dialog-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
