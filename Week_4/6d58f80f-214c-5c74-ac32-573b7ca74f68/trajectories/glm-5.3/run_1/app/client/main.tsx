import { useEffect, useRef, useState } from 'preact/hooks';
import { render } from 'preact';
import { parseAddress, buildAddress, type AddressState } from './lib/address.js';
import { api, ApiError } from './lib/api.js';
import { store, useStore, bootstrapSession, connectEvents } from './lib/store.js';
import { Announcements, announce } from './components/Announcements.tsx';
import { Icon } from './components/Icon.tsx';
import { FolderTree } from './components/FolderTree.tsx';
import { UploadsPanel } from './components/UploadsPanel.tsx';
import { SignInScreen } from './screens/SignInScreen.tsx';
import { DriveScreen } from './screens/DriveScreen.tsx';
import { RecentScreen } from './screens/RecentScreen.tsx';
import { SharedScreen } from './screens/SharedScreen.tsx';
import { BinScreen } from './screens/BinScreen.tsx';
import { HandoversScreen } from './screens/HandoversScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { formatSize } from './lib/format.js';

function App(): preact.JSX.Element {
  const person = useStore(s => s.person);
  const services = useStore(s => s.services);
  const folders = useStore(s => s.folders);
  const storage = useStore(s => s.storage);
  const notices = useStore(s => s.notices);
  const bootState = useStore(s => s.today);
  const [address, setAddress] = useState<AddressState>(() => parseAddress(location.pathname + location.search));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detailsSheet, setDetailsSheet] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    const onPop = (): void => setAddress(parseAddress(location.pathname + location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    void (async () => {
      await bootstrapSession();
      connectEvents();
    })();
    document.addEventListener('lintel:notice', (e => {
      const detail = (e as CustomEvent).detail as { text: string };
      store.addNotice(detail.text);
    }) as EventListener);
  }, []);

  useEffect(() => {
    if (person && !person.name) return;
    if (person && person.kind === 'partner' && (address.screen === 'drive' || address.screen === 'bin' || address.screen === 'handovers' || address.screen === 'settings')) {
      navigate({ screen: 'shared' });
    }
  }, [person?.id]);

  const navigate = (patch: Partial<AddressState>): void => {
    const next = { ...address, ...patch };
    const url = buildAddress(next);
    history.pushState(null, '', url);
    setAddress(next);
  };

  const replaceAddress = (patch: Partial<AddressState>): void => {
    const next = { ...address, ...patch };
    const url = buildAddress(next);
    history.replaceState(null, '', url);
    setAddress(next);
  };

  useEffect(() => {
    if (!person) return;
    if (person.kind === 'staff' && address.screen === 'shared') { replaceAddress({ screen: 'drive' }); return; }
    if (person.kind === 'partner' && (address.screen === 'drive' || address.screen === 'bin' || address.screen === 'handovers' || address.screen === 'settings')) {
      replaceAddress({ screen: 'shared' });
    }
    if (person.staffRole !== 'admin' && address.screen === 'settings') { replaceAddress({ screen: 'drive' }); }
  }, [person?.id, address.screen]);

  if (person === null) {
    if (address.screen !== 'sign-in') {
      const returnTo = location.pathname + location.search;
      history.replaceState(null, '', `/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
      setAddress(parseAddress(location.pathname + location.search));
    }
    return (
      <>
        <SignInScreen returnTo={new URLSearchParams(location.search).get('returnTo') ?? '/drive'} />
        <Announcements />
      </>
    );
  }

  const railDestinations = person.kind === 'staff'
    ? [
      { key: 'drive' as const, label: 'Projects' },
      { key: 'recent' as const, label: 'Recent' },
      { key: 'shared' as const, label: 'Shared with me' },
      { key: 'bin' as const, label: 'Bin' },
      { key: 'handovers' as const, label: 'Handovers' },
      ...(person.staffRole === 'admin' ? [{ key: 'settings' as const, label: 'Settings' }] : []),
    ]
    : [
      { key: 'recent' as const, label: 'Recent' },
      { key: 'shared' as const, label: 'Shared with me' },
    ];

  const centreScreen = (() => {
    switch (address.screen) {
      case 'recent': return <RecentScreen />;
      case 'shared': return person.kind === 'partner' ? <SharedScreen /> : <RecentScreen />;
      case 'bin': return person.kind === 'staff' ? <BinScreen /> : <RecentScreen />;
      case 'handovers': return person.kind === 'staff' ? <HandoversScreen /> : <RecentScreen />;
      case 'settings': return person.staffRole === 'admin' ? <SettingsScreen /> : <RecentScreen />;
      default: return <DriveScreen address={address} onNavigate={patch => navigate(patch)} />;
    }
  })();

  const submitSearch = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      const value = (e.target as HTMLInputElement).value;
      if (value === address.q) return;
      navigate({ q: value, screen: 'drive' });
    }
  };

  return (
    <div class="app">
      <a class="skip-link" href="#files-area" onClick={e => { e.preventDefault(); document.getElementById('files-area')?.focus(); }}>Skip to files</a>
      <header class="topbar">
        <button type="button" class="open-nav" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}>
          <Icon name="menu" size={20} />
        </button>
        <span class="wordmark">Lintel <span class="accent">Drive</span></span>
        <div class="searchbox">
          <input
            type="search"
            placeholder="Search files"
            aria-label="Search files"
            value={address.q}
            onKeyDown={submitSearch}
            onInput={e => { if ((e.target as HTMLInputElement).value === '') navigate({ q: '' }); }}
          />
        </div>
        <div class="account-area">
          <button type="button" aria-label="Account" aria-haspopup="menu" aria-expanded={accountOpen ? 'true' : 'false'} onClick={() => setAccountOpen(o => !o)}>
            <span class="avatar-circle">{initials(person.name)}</span>
            <span class="desktop-only" style="font-size:12px;">{person.name} · {person.firm}</span>
          </button>
          {accountOpen && (
            <div role="menu" aria-label="Account" style="position:absolute;right:12px;top:44px;background:var(--paper);border:1px solid var(--rule);border-radius:3px;padding:4px;z-index:200;">
              <button type="button" role="menuitem" onClick={async () => {
                await api.signOut().catch(() => {});
                store.set({ person: null });
                setAccountOpen(false);
                window.location.href = '/sign-in';
              }}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <div class="body-row">
        <aside class={`rail${drawerOpen ? ' drawer-open' : ''}`} aria-label="Drive navigation">
          <div class="rail-inner">
            <div class="rail-actions desktop-only">
              <button type="button" class="btn-new" aria-label="New" aria-haspopup="menu" aria-expanded={newMenuOpen ? 'true' : 'false'} onClick={() => setNewMenuOpen(o => !o)}>New</button>
              {newMenuOpen && (
                <div role="menu" aria-label="New" style="background:var(--paper);border:1px solid var(--rule);border-radius:3px;padding:4px;margin-top:4px;">
                  <button type="button" role="menuitem" onClick={() => { setNewMenuOpen(false); uploadInputRef.current?.click(); }}>Upload files</button>
                  <button type="button" role="menuitem" onClick={() => { setNewMenuOpen(false); document.dispatchEvent(new CustomEvent('lintel:new-folder')); }}>New folder</button>
                </div>
              )}
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                aria-label="Upload files"
                style="position:absolute;left:-9999px;"
                onChange={e => {
                  const files = Array.from((e.target as HTMLInputElement).files ?? []);
                  const target = address.folder ?? null;
                  document.dispatchEvent(new CustomEvent('lintel:upload-files', { detail: { files, folderId: target } }));
                  (e.target as HTMLInputElement).value = '';
                }}
              />
            </div>
            <nav class="rail-scroll" aria-label="Drive">
              <ul class="nav-list" role="navigation" aria-label="Drive">
                {railDestinations.map(d => (
                  <li key={d.key}>
                    <a
                      class="nav-link"
                      href={d.key === 'drive' ? '/drive' : `/${d.key}`}
                      aria-current={address.screen === d.key ? 'page' : undefined}
                      onClick={e => { e.preventDefault(); setDrawerOpen(false); navigate({ screen: d.key, folder: null, q: '' }); }}
                    >
                      <span class="nav-glyph"><Icon name={iconForScreen(d.key)} size={15} /></span>
                      {d.label}
                    </a>
                  </li>
                ))}
              </ul>
              <p class="tree-caption">Folders</p>
              <FolderTree
                folders={folders}
                expanded={expanded}
                focusedId={null}
                activeFolderId={address.folder}
                onToggleExpand={id => setExpanded(prev => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })}
                onOpen={f => { setDrawerOpen(false); navigate({ screen: 'drive', folder: f.id ?? null, q: '' }); }}
              />
            </nav>
            {person.kind === 'staff' && storage && (
              <div class="meter-box">
                <div class="meter-label">Company storage</div>
                <div class="meter-bar">
                  <div class="meter-fill" style={`width:${Math.min(100, (storage.usedBytes / storage.quotaBytes) * 100)}%;`}></div>
                </div>
                <div class="meter-text">{formatSize(storage.usedBytes)} of {formatSize(storage.quotaBytes)} used</div>
                <meter class="sr-only" aria-label="Company storage" value={storage.usedBytes} min={0} max={storage.quotaBytes} />
              </div>
            )}
            <button type="button" class="btn-secondary mobile-only" style="margin:0 12px;" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}>Close navigation</button>
          </div>
        </aside>
        {drawerOpen && <div class="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
        <main class="centre" id="files-area" tabindex="-1" aria-label="Files">
          <div class="notices" role="region" aria-label="Notices">
            {services.directory === 'down' && (
              <div class="notice warning"><span>The people directory is unreachable. Existing access is unchanged. Try again in a moment.</span><button type="button" aria-label="Dismiss" onClick={() => store.removeNotice('directory')}>Dismiss</button></div>
            )}
            {notices.map(n => (
              <div key={n.id} class={`notice${n.kind === 'warning' ? ' warning' : ''}`}>
                <span>{n.text}</span>
                <button type="button" aria-label="Dismiss" onClick={() => store.removeNotice(n.id)}>Dismiss</button>
              </div>
            ))}
          </div>
          {centreScreen}
          <UploadsPanel openFolderId={address.folder} />
        </main>
      </div>
      <Announcements />
    </div>
  );
}

function iconForScreen(screen: string): string {
  switch (screen) {
    case 'recent': return 'history';
    case 'shared': return 'users';
    case 'bin': return 'trash-2';
    case 'handovers': return 'inbox';
    case 'settings': return 'settings';
    default: return 'folder';
  }
}

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}

render(<App />, document.body);
