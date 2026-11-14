import { Dialog } from '../ui/Dialog.tsx'
import { ShortcutTable } from './ShortcutTable.tsx'

export function KeyboardHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog name="Keyboard shortcuts" onClose={onClose} className="dialog-wide">
      <div className="shortcut-scroll">
        <ShortcutTable label="Shortcut keys" />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}
