import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  FileText,
  Grid3x3,
  History,
  LayoutGrid,
  Menu,
  Settings as SettingsIcon,
  StickyNote,
  Users,
} from 'lucide-react';
import { api, ApiFailure } from './api';
import { useApp } from './app';
import { Dialog } from './components/dialog';
import { Glyph } from './components/glyphs';

const LIVE_NOTICE = 'Live updates are off. Your work is still saved.';

export interface PanelLink {
  label: string;
  onActivate: () => void;
}

interface ShellProps {
  lead?: string;
  children?: ReactNode;
  panelLinks?: PanelLink[];
  wide?: boolean;
}

interface ShellState {
  openNewPattern: () => void;
}

const ShellContext = createContext<ShellState>({ openNewPattern: () => undefined });

export function useShell(): ShellState {
  return useContext(ShellContext);
}

const CHART_KINDS = [
  'Flat knitting',
  'Knitting in the round',
  'Stranded in the round',
  'Crochet rows in US terms',
  'Crochet rows in UK terms',
  'Tapestry crochet',
];

const KIND_TINTS: Record<string, string> = {
  'Flat knitting': 'tile-green',
  'Knitting in the round': 'tile-blue',
  'Stranded in the round': 'tile-lilac',
  'Crochet rows in US terms': 'tile-rose',
  'Crochet rows in UK terms': 'tile-tan',
  'Tapestry crochet': 'tile-teal',
};

function NewPatternDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { navigate } = useApp();
  const [name, setName] = useState('');
  const [kind, setKind] = useState(CHART_KINDS[0]);
  const [rows, setRows] = useState('24');
  const [columns, setColumns] = useState('24');
  const [castOn, setCastOn] = useState('24');
  const [error, setError] = useState('');
  const [field, setField] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const made = await api.post<{ id: string }>('/api/patterns', {
        name,
        kind,
        rows: Number(rows),
        columns: Number(columns),
        castOn: Number(castOn),
      });
      onClose();
      navigate(`/patterns/${made.id}`);
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setError(failure.body.message ?? '');
        setField(failure.body.field ?? '');
      }
      setBusy(false);
    }
  };

  return (
    <Dialog name="New pattern" onClose={onClose}>
      <div className="form">
        <label className="field">
          <span>Pattern name</span>
          <input
            aria-label="Pattern name"
            value={name}
            aria-invalid={field === 'name' ? 'true' : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div role="radiogroup" aria-label="Chart kind" className="kind-cards">
          {CHART_KINDS.map((label) => (
            <div
              key={label}
              role="radio"
              tabIndex={kind === label ? 0 : -1}
              aria-checked={kind === label}
              aria-label={label}
              className="card kind-card"
              onClick={() => setKind(label)}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  setKind(label);
                }
              }}
            >
              <span className={`tile ${KIND_TINTS[label]}`} aria-hidden="true">
                {label.startsWith('Crochet') || label.startsWith('Tapestry') ? (
                  <Glyph stitch="sc" craft="crochet" />
                ) : (
                  <Glyph stitch="k" craft="knit" />
                )}
              </span>
              <span className="card-label">{label}</span>
              <span className="card-arrow" aria-hidden="true">
                &rarr;
              </span>
            </div>
          ))}
        </div>
        <label className="field">
          <span>Rows</span>
          <input
            type="number"
            role="spinbutton"
            aria-label="Rows"
            value={rows}
            aria-invalid={field === 'rows' ? 'true' : undefined}
            onChange={(event) => setRows(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Columns</span>
          <input
            type="number"
            role="spinbutton"
            aria-label="Columns"
            value={columns}
            aria-invalid={field === 'columns' ? 'true' : undefined}
            onChange={(event) => setColumns(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Cast on</span>
          <input
            type="number"
            role="spinbutton"
            aria-label="Cast on"
            value={castOn}
            aria-invalid={field === 'castOn' ? 'true' : undefined}
            onChange={(event) => setCastOn(event.target.value)}
          />
        </label>
        <p role="alert" aria-label="Pattern error" className="alert">
          {error}
        </p>
        <div className="row-of-buttons">
          <button type="button" className="primary" onClick={create} disabled={busy} aria-busy={busy}>
            Create
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function WorkspaceNav({ panelLinks }: { panelLinks?: PanelLink[] }): JSX.Element {
  const { navigate, path } = useApp();
  const rows: { label: string; icon: JSX.Element; onActivate: () => void; current: boolean }[] = [
    {
      label: 'Your patterns',
      icon: <LayoutGrid size={16} aria-hidden="true" />,
      onActivate: () => navigate('/'),
      current: path === '/',
    },
    {
      label: 'Settings',
      icon: <SettingsIcon size={16} aria-hidden="true" />,
      onActivate: () => navigate('/settings'),
      current: path === '/settings',
    },
  ];
  const icons: Record<string, JSX.Element> = {
    Chart: <Grid3x3 size={16} aria-hidden="true" />,
    Instructions: <FileText size={16} aria-hidden="true" />,
    Versions: <History size={16} aria-hidden="true" />,
    Testers: <Users size={16} aria-hidden="true" />,
    'Row notes': <StickyNote size={16} aria-hidden="true" />,
  };
  for (const link of panelLinks ?? []) {
    rows.push({
      label: link.label,
      icon: icons[link.label] ?? <FileText size={16} aria-hidden="true" />,
      onActivate: link.onActivate,
      current: false,
    });
  }

  return (
    <nav aria-label="Workspace" className="workspace-nav">
      <ul>
        {rows.map((row) => (
          <li key={row.label}>
            <a
              href="#"
              className={row.current ? 'nav-row current' : 'nav-row'}
              aria-current={row.current ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                row.onActivate();
              }}
            >
              {row.icon}
              <span>{row.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Shell({ lead, children, panelLinks, wide }: ShellProps): JSX.Element {
  const { account, layout, live, railOpen, toggleRail, navigate } = useApp();
  const [newPattern, setNewPattern] = useState(false);

  return (
    <ShellContext.Provider value={{ openNewPattern: () => setNewPattern(true) }}>
      <div className="shell" data-layout={layout}>
        <header className="top-bar">
          <button
            type="button"
            className="rail-toggle"
            aria-label="Toggle workspace rail"
            aria-expanded={railOpen}
            onClick={toggleRail}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <a
            className="product-name"
            href="/"
            onClick={(event) => {
              event.preventDefault();
              navigate('/');
            }}
          >
            Twinrow
          </a>
          {layout !== 'phone' ? (
            <button type="button" className="primary new-pattern" onClick={() => setNewPattern(true)}>
              New pattern
            </button>
          ) : null}
        </header>
        {account ? (
          <p className="live-status" role="status" aria-label="Live">
            {live ? 'Live' : LIVE_NOTICE}
          </p>
        ) : null}
        <div className="body">
          {layout === 'desktop' && railOpen ? (
            <aside className="rail">
              <WorkspaceNav panelLinks={panelLinks} />
            </aside>
          ) : null}
          <main className={wide ? 'main wide' : 'main'}>
            <p className="lead-line">{lead}</p>
            <section className="panel">{children}</section>
          </main>
        </div>
        {layout !== 'desktop' && railOpen ? (
          <div className="stacked-nav">
            <WorkspaceNav panelLinks={panelLinks} />
          </div>
        ) : null}
        {newPattern ? <NewPatternDialog onClose={() => setNewPattern(false)} /> : null}
      </div>
    </ShellContext.Provider>
  );
}
