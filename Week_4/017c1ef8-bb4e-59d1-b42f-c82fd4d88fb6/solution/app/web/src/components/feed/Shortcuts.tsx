import { Button, Dialog } from '../../ui';
import './feed.css';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog name="Keyboard shortcuts" open={open} onClose={onClose}>
      <h2 className="t-larger">Keyboard shortcuts</h2>
      <dl className="shortcuts-list">
        <dt>J</dt>
        <dd>Next post</dd>
        <dt>K</dt>
        <dd>Previous post</dd>
        <dt>L</dt>
        <dd>React to the focused post</dd>
        <dt>C</dt>
        <dd>Comment on the focused post</dd>
        <dt>?</dt>
        <dd>Show these shortcuts</dd>
      </dl>
      <div className="dialog-actions">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
