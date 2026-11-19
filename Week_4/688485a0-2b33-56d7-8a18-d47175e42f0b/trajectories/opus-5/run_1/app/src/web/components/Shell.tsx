import { ReactNode, useEffect, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { CollectionSummary, SessionUser, apiGet, apiSend } from '../api';
import { OUTAGE_BANNER } from '../copy';
import { useFocusTrap } from './Dialog';
import { SECTION_LABELS, Section, navigate } from '../router';
import { useViewport } from '../hooks';

export function TopBar({
  user,
  onOpenCollections,
}: {
  user: SessionUser | null;
  onOpenCollections?: () => void;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const trap = useFocusTrap(() => setMenuOpen(false));

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent): void => {
      if (!trap.ref.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen, trap.ref]);

  return (
    <header className="top-bar">
      <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate('/'); }}>
        Jarful
      </a>
      {onOpenCollections ? (
        <button type="button" onClick={onOpenCollections}>
          Collections
        </button>
      ) : null}
      <span className="spacer" />
      {user ? (
        <>
          <a
            href="/invites"
            onClick={(event) => {
              event.preventDefault();
              navigate('/invites');
            }}
          >
            Invitations
          </a>
          <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
            Account
          </button>
          {menuOpen ? (
            <div className="menu" role="menu" aria-label="Account" ref={trap.ref} onKeyDown={trap.onKeyDown}>
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  await apiSend('POST', '/api/auth/signout');
                  setMenuOpen(false);
                  window.location.assign('/');
                }}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <a
          href="/signin"
          onClick={(event) => {
            event.preventDefault();
            navigate('/signin');
          }}
        >
          Sign in
        </a>
      )}
    </header>
  );
}

export function OutageBanner({ storageDown }: { storageDown: boolean }): JSX.Element | null {
  if (!storageDown) return null;
  return (
    <div className="outage" role="alert">
      <CircleAlert aria-hidden="true" size={20} />
      <span>{OUTAGE_BANNER}</span>
    </div>
  );
}

/** Watches the health route so the banner shows while storage is unreachable. */
export function useStorageHealth(active: boolean): { storageDown: boolean; markDown: () => void } {
  const [storageDown, setStorageDown] = useState(false);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void apiGet<{ status: string }>('/api/health')
      .then((answer) => {
        if (live) setStorageDown(answer.status === 'unavailable');
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [active]);
  return { storageDown, markDown: () => setStorageDown(true) };
}

export function Rail({
  projectName,
  collections,
  pid,
  currentCid,
  section,
  onNavigate,
}: {
  projectName: string;
  collections: CollectionSummary[] | null;
  pid: string;
  currentCid: string | null;
  section: Section | null;
  onNavigate?: () => void;
}): JSX.Element {
  return (
    <nav className="rail" aria-label="Project" aria-busy={collections === null ? 'true' : undefined}>
      <div className="project-name">{projectName}</div>
      {collections === null ? (
        <div className="skeleton" style={{ height: '4rem' }} />
      ) : (
        <ul>
          {collections.map((collection) => (
            <li key={collection.id}>
              <a
                className={collection.id === currentCid ? 'current' : undefined}
                href={`/p/${pid}/c/${collection.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`/p/${pid}/c/${collection.id}`);
                  onNavigate?.();
                }}
              >
                {collection.name}
              </a>
            </li>
          ))}
        </ul>
      )}
      {section ? <span className="section-tag">{SECTION_LABELS[section]}</span> : null}
    </nav>
  );
}

export function SectionNav({
  pid,
  cid,
  section,
}: {
  pid: string;
  cid: string | null;
  section: Section | null;
}): JSX.Element {
  const links: Array<{ label: string; href: string; key: Section }> = [];
  if (cid) {
    links.push(
      { label: 'Documents', href: `/p/${pid}/c/${cid}`, key: 'documents' },
      { label: 'Query', href: `/p/${pid}/c/${cid}/queries`, key: 'queries' },
      { label: 'Pipeline', href: `/p/${pid}/c/${cid}/pipeline`, key: 'pipeline' },
      { label: 'Indexes', href: `/p/${pid}/c/${cid}/indexes`, key: 'indexes' },
      { label: 'Schema', href: `/p/${pid}/c/${cid}/schema`, key: 'schema' },
      { label: 'Rules', href: `/p/${pid}/c/${cid}/rules`, key: 'rules' },
    );
  }
  links.push({ label: 'Members', href: `/p/${pid}/members`, key: 'members' });
  return (
    <nav className="sections" aria-label="Sections">
      {links.map((link) => (
        <a
          key={link.key}
          href={link.href}
          aria-current={section === link.key ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            navigate(link.href);
          }}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export function PlainShell({ user, children }: { user: SessionUser | null; children: ReactNode }): JSX.Element {
  return (
    <div className="plain-shell">
      <TopBar user={user} />
      <div className="plain-content">{children}</div>
    </div>
  );
}

/** The project shell: top bar, rail (drawer on a phone) and the section navigation. */
export function ProjectShell({
  user,
  pid,
  cid,
  section,
  projectName,
  storageDown,
  children,
}: {
  user: SessionUser | null;
  pid: string;
  cid: string | null;
  section: Section | null;
  projectName: string;
  storageDown?: boolean;
  children: ReactNode;
}): JSX.Element {
  const viewport = useViewport();
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let live = true;
    void apiGet<{ collections: CollectionSummary[] }>(`/api/projects/${pid}/collections`)
      .then((answer) => {
        if (live) setCollections(answer.collections);
      })
      .catch(() => {
        if (live) setCollections([]);
      });
    return () => {
      live = false;
    };
  }, [pid]);

  const rail = (
    <Rail
      projectName={projectName}
      collections={collections}
      pid={pid}
      currentCid={cid}
      section={section}
      onNavigate={() => setDrawerOpen(false)}
    />
  );

  return (
    <div>
      <TopBar user={user} onOpenCollections={viewport === 'phone' ? () => setDrawerOpen(true) : undefined} />
      <OutageBanner storageDown={storageDown ?? false} />
      <div className={cid === null && section === null ? 'workspace home' : 'workspace'}>
        <SectionNav pid={pid} cid={cid} section={section} />
        {viewport === 'phone' ? null : rail}
        <div className="content">{children}</div>
      </div>
      {viewport === 'phone' && drawerOpen ? (
        <DrawerRail onClose={() => setDrawerOpen(false)}>{rail}</DrawerRail>
      ) : null}
    </div>
  );
}

function DrawerRail({ onClose, children }: { onClose: () => void; children: ReactNode }): JSX.Element {
  const trap = useFocusTrap(onClose);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Collections"
        tabIndex={-1}
        ref={trap.ref}
        onKeyDown={trap.onKeyDown}
      >
        <button type="button" onClick={onClose}>
          Close collections
        </button>
        {children}
      </div>
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }): JSX.Element {
  return (
    <div aria-hidden="true">
      {Array.from({ length: lines }).map((_item, index) => (
        <div key={index} className="skeleton" style={{ width: `${90 - index * 8}%`, height: '1.6rem' }} />
      ))}
    </div>
  );
}

export function NotFoundScreen({ user }: { user: SessionUser | null }): JSX.Element {
  return (
    <PlainShell user={user}>
      <h1>Not found</h1>
      <p className="secondary">That page is not here.</p>
    </PlainShell>
  );
}
