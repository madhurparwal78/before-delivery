import { useState, type ReactNode } from 'react';
import { Keyboard } from 'lucide-react';
import { Link } from '../router';
import { useSession } from '../session';
import { Dialog } from './Dialog';

function Wordmark() {
  return (
    <span className="wordmark">
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="3" fill="currentColor" />
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 3" />
      </svg>
      Halation Studio
    </span>
  );
}

/** The workspace header. `children` are the page's own actions, placed before the person's name. */
export function WorkspaceHeader({ children, showAuth = true }: { children?: ReactNode; showAuth?: boolean }) {
  const session = useSession();
  return (
    <header className="workspace-header">
      <Link href="/" className="home-link" aria-label="Halation Studio home">
        <Wordmark />
      </Link>
      <div className="header-end">
        {children}
        {showAuth && session.status === 'out' && (
          <Link href="/signin" className="btn btn-quiet">
            Sign in
          </Link>
        )}
        {showAuth && session.status === 'in' && session.user && (
          <>
            <span className="person-name">{session.user.name}</span>
            <button type="button" className="btn btn-quiet" onClick={() => void session.signOut()}>
              Sign out
            </button>
          </>
        )}
      </div>
    </header>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Ctrl or Cmd+Z', 'Undo'],
  ['Ctrl or Cmd+Shift+Z', 'Redo'],
  ['Ctrl or Cmd+D', 'Duplicate the selected layer'],
  ['Ctrl or Cmd+G', 'Group the selected layers'],
  ['Ctrl or Cmd+Shift+G', 'Ungroup'],
  ['Delete', 'Delete the selected layer, or the focused keyframe'],
  ['K', 'Add a keyframe for the focused property'],
  ['Alt+ArrowUp / Alt+ArrowDown', 'Move the focused layer up or down'],
  ['Shift+ArrowUp / Shift+ArrowDown', 'Extend the layer selection'],
  ['Space', 'Toggle a layer in the selection'],
  ['ArrowLeft / ArrowRight on the playhead', 'One frame back or forward (Shift: ten)'],
  ['Home / End on the playhead', 'Jump to the start or the end'],
  ['Arrow keys on the stage in Preview', 'Move the virtual pointer by 0.1'],
  ['Escape on the stage', 'Release the virtual pointer'],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog name="Keyboard shortcuts" onClose={onClose}>
      <div className="dialog-head">
        <h2>Keyboard shortcuts</h2>
      </div>
      <dl className="shortcut-list">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={keys}>
            <dt>{keys}</dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function WorkspaceFooter() {
  const [shortcuts, setShortcuts] = useState(false);
  return (
    <footer className="workspace-footer">
      <div className="footer-brand">
        <span className="footer-wordmark">Tinderbox Optics</span>
        <Link href="/projects" className="footer-open">
          Open editor ↗
        </Link>
        <small>© 2026 Tinderbox Optics</small>
      </div>
      <nav className="footer-groups" aria-label="Footer">
        <div>
          <p className="footer-title">Product</p>
          <Link href="/projects">Editor</Link>
          <Link href="/#published-embeds">Embeds</Link>
          <Link href="/#version-export">Versions</Link>
        </div>
        <div>
          <p className="footer-title">Studio</p>
          <Link href="/#release-note">Release notes</Link>
        </div>
        <div>
          <p className="footer-title">Help</p>
          <button type="button" className="link-button" onClick={() => setShortcuts(true)}>
            <Keyboard size={16} aria-hidden="true" /> Keyboard shortcuts
          </button>
        </div>
      </nav>
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </footer>
  );
}
