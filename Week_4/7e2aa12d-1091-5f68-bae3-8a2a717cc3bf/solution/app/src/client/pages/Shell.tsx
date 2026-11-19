import { LIVE_PAUSED_MESSAGE } from '../../shared/messages.js';
import { useTabKeys } from '../components/Tabs.js';
import type { Message } from '../lib/workspace.js';

export type Pane = 'grid' | 'tracks' | 'preview' | 'code';
const PANE_NAMES: Record<Pane, string> = { grid: 'Grid', tracks: 'Tracks', preview: 'Preview', code: 'Code' };

/** The tablist of panes shown under 700 pixels: one panel at a time. */
export function PaneTabs({ label = 'Editor panes', pane, panes, onSelect }: { label?: string; pane: Pane; panes: Pane[]; onSelect: (pane: Pane) => void }) {
  const keys = useTabKeys();
  return (
    <div role="tablist" aria-label={label} className="tabs pane-tabs" onKeyDown={keys}>
      {panes.map((name) => (
        <button key={name} type="button" role="tab" aria-selected={pane === name} tabIndex={pane === name ? 0 : -1} className="tab" onClick={() => onSelect(name)}>
          {PANE_NAMES[name]}
        </button>
      ))}
    </div>
  );
}

/** "Live status", under the notice area: empty (and zero height) while live updates run. */
export function LiveStatus({ live }: { live: boolean }) {
  return (
    <div role="status" aria-label="Live status" className="live-status">
      {live ? '' : LIVE_PAUSED_MESSAGE}
    </div>
  );
}

/** The status bar: "Layout updates" for every announcement and, in the editor, "Edit problem" for refusals. */
export function StatusBar({ announcement, problem }: { announcement: Message; problem?: string }) {
  return (
    <footer className="statusbar">
      <div role="status" aria-label="Layout updates" aria-live="polite" className="updates">
        <span key={announcement.id}>{announcement.text}</span>
      </div>
      {problem !== undefined && (
        <div role="alert" aria-label="Edit problem" className="problem">
          {problem}
        </div>
      )}
    </footer>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="skeleton" aria-busy="true">
      <div className="skeleton-bar" />
      <p className="note">Loading layout…</p>
      <div className="skeleton-panes">
        <div className="skeleton-pane" />
        <div className="skeleton-pane wide" />
        <div className="skeleton-pane" />
      </div>
    </div>
  );
}
