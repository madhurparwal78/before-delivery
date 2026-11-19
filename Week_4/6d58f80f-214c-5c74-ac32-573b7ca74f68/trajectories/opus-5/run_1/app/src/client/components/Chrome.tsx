import { useState } from 'react';
import { ChevronRight, Menu, Search, UserRound } from 'lucide-react';
import type { PathSegment, Person, SortKey, StorageTotals } from '../../shared/types.js';
import { formatSize } from '../lib/format.js';
import { SORT_KEYS } from '../../shared/types.js';

export const SORT_LABELS: Record<SortKey, string> = {
  'name-asc': 'Name A–Z',
  'name-desc': 'Name Z–A',
  'modified-desc': 'Newest first',
  'modified-asc': 'Oldest first',
  'size-desc': 'Largest first',
  'size-asc': 'Smallest first',
};

interface TopBarProps {
  person: Person;
  query: string;
  onSearch: (text: string) => void;
  onSignOut: () => void;
  onOpenNavigation: () => void;
}

export const TopBar = ({
  person,
  query,
  onSearch,
  onSignOut,
  onOpenNavigation,
}: TopBarProps): JSX.Element => {
  const [text, setText] = useState(query);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="topbar">
      <button type="button" className="drawer-button" onClick={onOpenNavigation}>
        <Menu size={16} aria-hidden="true" />
        Open navigation
      </button>
      <span className="wordmark">Lintel Drive</span>
      <form
        className="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(text.trim());
        }}
      >
        <Search size={14} aria-hidden="true" className="search-icon" />
        <input
          type="search"
          aria-label="Search files"
          placeholder="Search files"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </form>
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          aria-label="Account"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <UserRound size={14} aria-hidden="true" />
          <span className="account-name">
            {person.name} · {person.firm}
          </span>
        </button>
        {menuOpen ? (
          <div role="menu" aria-label="Account" style={{ position: 'absolute', right: 0, zIndex: 50, background: 'var(--paper-raised)', border: '1px solid var(--rule)' }}>
            <button type="button" role="menuitem" className="quiet" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
};

interface PathBarProps {
  rootLabel: string;
  segments: PathSegment[];
  onOpenRoot: () => void;
  onOpen: (folderId: string) => void;
  onDropFiles?: (folderId: string) => void;
}

/** Middle segments collapse behind an ellipsis button; the first and last always show. */
export const PathBar = ({
  rootLabel,
  segments,
  onOpenRoot,
  onOpen,
  onDropFiles,
}: PathBarProps): JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const phone = typeof window !== 'undefined' && window.innerWidth < 768;
  const collapse = phone && !expanded && segments.length > 2;
  const shown = collapse ? [segments[0], segments[segments.length - 1]] : segments;

  return (
    <nav aria-label="Folder path" className="pathbar">
      <a
        href="/drive"
        data-path-segment="root"
        aria-current={segments.length === 0 ? 'page' : undefined}
        onClick={(event) => {
          event.preventDefault();
          onOpenRoot();
        }}
      >
        {rootLabel}
      </a>
      {collapse ? (
        <>
          <ChevronRight size={12} aria-hidden="true" className="sep" />
          <a
            href={`/drive?folder=${shown[0]?.id ?? ''}`}
            data-path-segment={shown[0]?.id ?? ''}
            onClick={(event) => {
              event.preventDefault();
              const id = shown[0]?.id;
              if (id !== undefined) onOpen(id);
            }}
          >
            {shown[0]?.name}
          </a>
          <span className="sep" aria-hidden="true">
            /
          </span>
          <button type="button" className="quiet" aria-label="Show all path segments" onClick={() => setExpanded(true)}>
            …
          </button>
          <span className="sep" aria-hidden="true">
            /
          </span>
          <a
            href={`/drive?folder=${shown[1]?.id ?? ''}`}
            data-path-segment={shown[1]?.id ?? ''}
            aria-current="page"
            onClick={(event) => event.preventDefault()}
          >
            {shown[1]?.name}
          </a>
        </>
      ) : (
        segments.map((segment, index) => (
          <span key={segment.id} style={{ display: 'inline-flex', gap: 'var(--step)', minWidth: 0 }}>
            <ChevronRight size={12} aria-hidden="true" className="sep" />
            <a
              href={`/drive?folder=${segment.id}`}
              data-path-segment={segment.id}
              aria-current={index === segments.length - 1 ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                onOpen(segment.id);
              }}
              onDragOver={(event) => {
                if (onDropFiles === undefined) return;
                event.preventDefault();
                event.currentTarget.classList.add('drop-target');
              }}
              onDragLeave={(event) => event.currentTarget.classList.remove('drop-target')}
              onDrop={(event) => {
                if (onDropFiles === undefined) return;
                event.preventDefault();
                event.currentTarget.classList.remove('drop-target');
                onDropFiles(segment.id);
              }}
            >
              {segment.name}
            </a>
          </span>
        ))
      )}
    </nav>
  );
};

interface ToolbarProps {
  view: 'list' | 'grid';
  sort: SortKey;
  onView: (view: 'list' | 'grid') => void;
  onSort: (sort: SortKey) => void;
}

export const ViewToolbar = ({ view, sort, onView, onSort }: ToolbarProps): JSX.Element => (
  <div className="toolbar">
    <fieldset role="radiogroup" aria-label="View">
      <legend className="visually-hidden">View</legend>
      {(['list', 'grid'] as const).map((option) => (
        <label className="radio-pill" key={option}>
          <input
            type="radio"
            name="view"
            checked={view === option}
            aria-label={option === 'list' ? 'List' : 'Grid'}
            onChange={() => onView(option)}
          />
          {option === 'list' ? 'List' : 'Grid'}
        </label>
      ))}
    </fieldset>
    <label className="field" style={{ maxWidth: 180 }}>
      <span className="visually-hidden">Sort by</span>
      <select
        aria-label="Sort by"
        value={sort}
        onChange={(event) => onSort(event.target.value as SortKey)}
      >
        {SORT_KEYS.map((key) => (
          <option value={key} key={key}>
            {SORT_LABELS[key]}
          </option>
        ))}
      </select>
    </label>
  </div>
);

export const StorageMeter = ({ totals }: { totals: StorageTotals }): JSX.Element => (
  <div className="meter-pane">
    <span className="num">
      {formatSize(totals.usedBytes)} of {formatSize(totals.quotaBytes)} used
    </span>
    <meter
      aria-label="Company storage"
      value={totals.usedBytes}
      min={0}
      max={totals.quotaBytes}
    />
  </div>
);
