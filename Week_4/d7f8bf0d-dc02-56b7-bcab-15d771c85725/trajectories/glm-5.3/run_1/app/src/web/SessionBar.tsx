import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewUrlState } from './store/types';
import type { StoreState } from './store/store';
import { api, newKey, ApiFailure } from './apiClient';
import { Glyph } from './Glyphs';

interface SessionBarProps {
  url: ViewUrlState;
  setUrl: (patch: Partial<ViewUrlState>) => void;
  state: StoreState;
  announce: (message: string) => void;
  setError: (message: string | null) => void;
}

const SHEET_ITEMS: { name: string; sheet: ViewUrlState['sheet'] }[] = [
  { name: 'Layouts', sheet: 'layouts' },
  { name: 'Versions', sheet: 'versions' },
  { name: 'Timetable', sheet: 'timetable' },
  { name: 'Members', sheet: 'members' },
  { name: 'Standards', sheet: 'standards' },
  { name: 'History', sheet: 'history' },
  { name: 'Trash', sheet: 'trash' },
];

export function SessionBar(props: SessionBarProps): React.ReactElement {
  const { url, setUrl, state, announce, setError } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  const isFounder = state.me?.memberships.some((m) => m.role === 'founder') ?? false;
  const session = url.mode === 'operate' ? state.session : null;

  const toggleSheet = useCallback((sheet: ViewUrlState['sheet']) => {
    setMenuOpen(false);
    setUrl({ sheet: url.sheet === sheet ? null : sheet, dialog: null });
  }, [setUrl, url.sheet]);

  const openSessions = useCallback(() => {
    setUrl({ sheet: 'sessions', dialog: null });
  }, [setUrl]);

  const openPackets = useCallback(() => {
    setUrl({ sheet: 'crew-packets', dialog: null });
  }, [setUrl]);

  const signOut = useCallback(async () => {
    try {
      await api('POST', '/api/auth/sign-out', undefined, newKey());
    } catch {
      // already signed out
    }
    window.location.reload();
  }, []);

  return (
    <>
      <nav className="session-bar" aria-label="Session bar" data-testid="session-bar">
        <div style={{ position: 'relative' }}>
          <button
            className="bar-glyph"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            ref={menuButtonRef}
          >
            <Glyph name="gear" />
            <span>Sheets</span>
          </button>
          {menuOpen ? (
            <div role="menu" style={{ position: 'absolute', top: '110%', left: 0, background: '#fff', borderRadius: 10, border: '3px solid #1848c2', padding: 6, display: 'flex', flexDirection: 'column', minWidth: 160, zIndex: 50 }}>
              {SHEET_ITEMS.map((item) => (
                <button
                  key={item.name}
                  role="menuitem"
                  style={{ background: 'none', border: 'none', textAlign: 'left', padding: '10px 12px', cursor: 'pointer', fontWeight: 700, color: '#1c2438', minHeight: 44 }}
                  onClick={() => toggleSheet(item.sheet)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button className="bar-glyph" aria-label="Reset view" onClick={() => setUrl({ heading: 0 })}>
          <Glyph name="camera" />
        </button>

        <button className="bar-glyph" onClick={openSessions}>Sessions</button>
        <button className="bar-glyph" onClick={openPackets}>Crew packets</button>

        <label className="bar-glyph" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Glyph name="workspace" />
          <select
            aria-label="Workspace"
            data-testid="workspace-switcher"
            value={url.workspace ?? ''}
            onChange={(e) => {
              const workspaceId = e.target.value;
              // Choosing one opens that workspace's first layout.
              window.location.href = `/?workspace=${encodeURIComponent(workspaceId)}`;
            }}
            style={{ background: 'transparent', border: 'none', color: '#fff', fontWeight: 700, textShadow: '-1px -1px 0 #1c2438, 1px 1px 0 #1c2438' }}
          >
            {state.workspaces.map((w) => (
              <option key={w.id} value={w.id} style={{ color: '#1c2438', textShadow: 'none' }}>{w.name}</option>
            ))}
          </select>
        </label>

        {isFounder ? (
          <button className="bar-glyph" data-testid="new-workspace" onClick={() => setNewWorkspaceOpen(true)}>
            <Glyph name="plus" />
            <span>New workspace</span>
          </button>
        ) : null}

        <button className="bar-glyph" data-testid="sign-out" onClick={signOut}>
          <Glyph name="exit" />
          <span>Sign out</span>
        </button>

        {session ? (
          <div className="readout" role="group" aria-label="Session readout">
            <span className="numeric figure" data-testid="fast-clock">{session.fast_clock_label}</span>
            <span className="figure" data-testid="session-status">{session.status}</span>
            <span className="figure" data-testid="session-version">Session version {session.session_version}</span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }} role="group" aria-label="Counters">
              <Counter testid="counter-occupied" label="Occupied" value={session.counters.occupied_blocks} />
              <Counter testid="counter-reserved" label="Reserved" value={session.counters.reserved_blocks} />
              <Counter testid="counter-free" label="Free" value={session.counters.free_blocks} />
              <Counter testid="counter-trains" label="Trains" value={session.counters.trains} />
              <Counter testid="counter-conflicts" label="Conflicts" value={session.counters.open_conflicts} />
            </span>
          </div>
        ) : null}
      </nav>

      {newWorkspaceOpen ? (
        <NewWorkspaceDialog
          onClose={() => setNewWorkspaceOpen(false)}
          announce={announce}
          setError={setError}
          setUrl={setUrl}
        />
      ) : null}
    </>
  );
}

function Counter({ testid, label, value }: { testid: string; label: string; value: number }): React.ReactElement {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
      <span className="figure">{label}</span>
      <span className="numeric figure" data-testid={testid}>{value}</span>
    </span>
  );
}

function NewWorkspaceDialog({ onClose, announce, setError, setUrl }: {
  onClose: () => void;
  announce: (message: string) => void;
  setError: (message: string | null) => void;
  setUrl: (patch: Partial<ViewUrlState>) => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('reference');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api<{ workspace: { id: string; name: string }; layout: { id: string }; version: { id: string } | null }>(
        'POST', '/api/workspaces', { name, template }, newKey(),
      );
      // On success the new workspace opens and the dialog closes.
      window.location.href = `/?workspace=${encodeURIComponent(result.workspace.id)}&layout=${encodeURIComponent(result.layout.id)}`;
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  }, [name, template, setError]);

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-label="New workspace" data-testid="new-workspace-dialog">
        <h2>New workspace</h2>
        <div className="field">
          <label htmlFor="new-workspace-name">Workspace name</label>
          <input id="new-workspace-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new-workspace-template">Template</label>
          <select id="new-workspace-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="reference">Reference layout</option>
            <option value="empty">Empty</option>
          </select>
        </div>
        <div className="actions">
          <button className="lipped pale" onClick={onClose}>Cancel</button>
          <button className="lipped" onClick={submit} disabled={busy || name.trim() === ''}>Create workspace</button>
        </div>
      </div>
    </div>
  );
}
