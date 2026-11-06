import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import type { SearchResponse } from '../../shared/types';
import { request } from '../api';
import { useApp, usePrefersReducedMotion } from '../app-state';
import { Link, navigate, useRoute } from '../router';

const NAV_ITEMS = [
  { label: 'Inbox', to: '/inbox' },
  { label: 'Features', to: '/features' },
  { label: 'Roadmap', to: '/roadmap' },
  { label: 'Companies', to: '/companies' },
  { label: 'Import', to: '/import' },
  { label: 'Settings', to: '/settings' },
];

interface Option {
  key: string;
  label: string;
  snippet?: string;
  to: string;
}

function WorkspaceSearch(): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void request<SearchResponse>(`/api/search?q=${encodeURIComponent(trimmed)}`)
        .then((data) => {
          setResults(data);
          setActive(0);
        })
        .catch(() => setResults(null));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const groups: { label: string; options: Option[] }[] = results
    ? [
        {
          label: 'Notes',
          options: results.notes.map((note) => ({
            key: `note-${note.id}`,
            label: note.title,
            snippet: note.snippet,
            to: `/inbox/${note.id}`,
          })),
        },
        {
          label: 'Companies',
          options: results.companies.map((company) => ({
            key: `company-${company.id}`,
            label: company.name,
            to: `/companies/${company.id}`,
          })),
        },
        {
          label: 'Features',
          options: results.features.map((feature) => ({
            key: `feature-${feature.id}`,
            label: feature.name,
            to: `/features/${feature.id}`,
          })),
        },
      ].filter((group) => group.options.length > 0)
    : [];
  const flat = groups.flatMap((group) => group.options);
  const expanded = flat.length > 0;

  const open = (option: Option | undefined): void => {
    if (!option) return;
    setQuery('');
    setResults(null);
    navigate(option.to);
  };

  return (
    <div className="search">
      <label className="search-label" htmlFor="workspace-search">
        <Search aria-hidden="true" size={16} />
        <span className="visually-hidden">Search workspace</span>
      </label>
      <input
        id="workspace-search"
        ref={inputRef}
        role="combobox"
        type="text"
        aria-label="Search workspace"
        aria-expanded={expanded}
        aria-controls="search-results"
        aria-autocomplete="list"
        aria-activedescendant={expanded ? flat[active]?.key : undefined}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setQuery('');
            setResults(null);
            return;
          }
          if (!expanded) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, flat.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            open(flat[active]);
          }
        }}
      />
      <div className="search-results-wrap">
        <ul role="listbox" id="search-results" aria-label="Search results" hidden={!expanded}>
          {groups.map((group) => (
            <li key={group.label} role="group" aria-label={group.label}>
              <p className="search-group-label">{group.label}</p>
              <ul>
                {group.options.map((option) => (
                  <li
                    key={option.key}
                    id={option.key}
                    role="option"
                    aria-selected={flat[active]?.key === option.key}
                    className={flat[active]?.key === option.key ? 'search-option active' : 'search-option'}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      open(option);
                    }}
                  >
                    <span className="search-option-label">{option.label}</span>
                    {option.snippet !== undefined ? (
                      <span className="search-option-snippet">{option.snippet}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const app = useApp();
  const route = useRoute();
  const reduced = usePrefersReducedMotion();
  const navItems = NAV_ITEMS.filter(
    (item) => item.label !== 'Settings' || app.user?.role === 'head_of_product',
  );

  return (
    <div className="shell">
      <header className="topbar">
        <p className="workspace-name display">{app.workspace?.name ?? 'Evidence Desk'}</p>
        <WorkspaceSearch />
        <nav aria-label="Main">
          <ul>
            {navItems.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={route === item.to || route.startsWith(`${item.to}/`) ? 'nav-link current' : 'nav-link'}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <button
          type="button"
          className="button quiet"
          onClick={() => {
            void request('/api/session', { method: 'DELETE' }).then(() => {
              app.signOut();
              navigate('/signin');
            });
          }}
        >
          Sign out
        </button>
        {app.busy && !reduced ? <div className="progress" aria-hidden="true" /> : null}
      </header>
      <Announcements />
      {children}
    </div>
  );
}

export function Announcements(): JSX.Element {
  const app = useApp();
  return (
    <div className="announcements">
      <p role="status" aria-live="polite" className="save-status" aria-label="Save status">
        {app.pending !== '' ? app.pending : app.saveStatus}
      </p>
      <p role="status" aria-live="polite" className="save-status" aria-label="Evidence announcements">
        {app.evidenceAnnouncement}
      </p>
      <p role="status" aria-live="polite" className="save-status" aria-label="Board announcements">
        {app.boardAnnouncement}
      </p>
      {app.alert !== '' ? (
        <p role="alert" className="alert">
          {app.alert}
        </p>
      ) : null}
    </div>
  );
}
