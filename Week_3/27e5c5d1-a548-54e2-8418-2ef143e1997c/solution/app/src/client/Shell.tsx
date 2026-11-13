import { useEffect, useRef, useState, type ReactElement } from 'react';
import { signOut, clearSearch, setSearchText, useStore, refreshDrawer } from './store.ts';
import { navigate } from './router.ts';
import { ChevronIcon, CloseIcon, MenuIcon, SearchIcon } from './icons.tsx';
import { Menu, Modal } from './overlay.tsx';
import { openText } from './copy.ts';
import { useUi } from './ui.ts';
import type { BoardSummary } from '../shared/types.ts';

export function Masthead(): ReactElement {
  const name = useStore((s) => s.board?.parentName ?? s.workspace?.parentName ?? '');
  return <h1 className="masthead">{name}</h1>;
}

function SearchBox(): ReactElement {
  const search = useStore((s) => s.search);
  return (
    <div className="search">
      <span className="search-icon"><SearchIcon /></span>
      <input
        type="search"
        aria-label="Search this workspace"
        placeholder="Search cards"
        autoComplete="off"
        value={search.text}
        onChange={(event) => setSearchText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            clearSearch();
          }
        }}
      />
      {search.text !== '' && (
        <button type="button" className="ghost search-clear" aria-label="Clear search" onClick={clearSearch}>
          <CloseIcon />
        </button>
      )}
      <section aria-label="Search results" className={search.results.length > 0 ? 'results' : 'results empty'}>
        <ul>
          {search.results.map((hit) => (
            <li key={hit.cardId}>
              <a
                href={`/cards/${hit.cardId}`}
                onClick={(event) => {
                  event.preventDefault();
                  clearSearch();
                  navigate(`/cards/${hit.cardId}`);
                }}
              >
                {hit.title}
              </a>
              <span className="result-place">{hit.boardName} · {hit.listName}</span>
            </li>
          ))}
        </ul>
      </section>
      <div role="status" aria-label="Search results status" className="sr-only">{search.status}</div>
    </div>
  );
}

function AccountMenu(): ReactElement {
  const ui = useUi();
  const workspace = useStore((s) => s.workspace);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = (): void => setAnchor(null);
  const choose = (action: () => void) => (): void => {
    button.current?.focus();
    close();
    action();
  };
  return (
    <>
      <button ref={button} type="button" className="outline account-button" aria-haspopup="menu" aria-expanded={anchor !== null} onClick={() => setAnchor(anchor ? null : button.current)}>
        Account
        <ChevronIcon />
      </button>
      {anchor && (
        <Menu label="Account" anchor={anchor} onClose={close}>
          <button type="button" role="menuitem" onClick={choose(() => ui.open('password'))}>Change password</button>
          {workspace?.role === 'admin' && (
            <button type="button" role="menuitem" onClick={choose(() => navigate(`/workspaces/${workspace.id}/permission-log`))}>Permission log</button>
          )}
          <button type="button" role="menuitem" onClick={choose(() => void signOut())}>Sign out</button>
        </Menu>
      )}
    </>
  );
}

export function TopBar({ sheetOpen }: { sheetOpen: boolean }): ReactElement {
  const ui = useUi();
  const phone = useStore((s) => s.viewMode === 'phone');
  return (
    <header className="topbar">
      {phone && (
        <button type="button" className="outline boards-button" aria-expanded={sheetOpen} onClick={() => ui.open('sheet')}>
          <MenuIcon />
          <span>Boards</span>
        </button>
      )}
      <Masthead />
      <SearchBox />
      <AccountMenu />
    </header>
  );
}

function BoardLinks({ onChosen }: { onChosen?: () => void }): ReactElement {
  const ui = useUi();
  const drawer = useStore((s) => s.drawer);
  const current = useStore((s) => s.board?.id ?? null);
  const admin = useStore((s) => s.workspace?.role === 'admin');
  useEffect(() => {
    void refreshDrawer();
  }, []);
  return (
    <>
      <nav aria-label="Boards">
        <ul>
          {drawer.map((board: BoardSummary) => (
            <li key={board.id}>
              <a
                href={`/boards/${board.id}`}
                {...(board.id === current ? { 'aria-current': 'page' as const } : {})}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`/boards/${board.id}`);
                  onChosen?.();
                }}
              >
                {board.name}
              </a>
              <span className="open-count">{openText(board.openCards)}</span>
            </li>
          ))}
        </ul>
      </nav>
      {admin && (
        <button type="button" className="outline new-board" onClick={() => ui.open('new-board')}>New board</button>
      )}
    </>
  );
}

export function Drawer(): ReactElement {
  return (
    <aside className="drawer">
      <BoardLinks />
    </aside>
  );
}

export function BoardsSheet({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <Modal label="Boards" className="sheet" onClose={onClose}>
      <div className="sheet-head">
        <h2>Boards</h2>
        <button type="button" className="outline" onClick={onClose}>Close</button>
      </div>
      <BoardLinks onChosen={onClose} />
    </Modal>
  );
}
