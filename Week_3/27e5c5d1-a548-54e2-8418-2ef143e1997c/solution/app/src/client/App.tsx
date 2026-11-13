import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { BoardScreen } from './BoardScreen.tsx';
import { CardDialog } from './CardDialog.tsx';
import { MoveDialog, NewBoardDialog, PasswordDialog, SettingsDialog, ShortcutsDialog } from './Dialogs.tsx';
import { Announcements, Notices, ServiceBanner, Toast } from './Live.tsx';
import { NotFound } from './NotFound.tsx';
import { PermissionLog } from './PermissionLog.tsx';
import { Drawer, BoardsSheet, Masthead, TopBar } from './Shell.tsx';
import { SignIn } from './SignIn.tsx';
import { useAddress, useRoute } from './router.ts';
import {
  boot, cancelLift, currentViewMode, enterSignIn, goHome, leaveCard, openBoard, setViewMode, showCard, takeFocusOnReady, useStore,
} from './store.ts';
import { UiContext, type DialogName, type Ui } from './ui.ts';

function useViewMode(): void {
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)');
    const full = window.matchMedia('(min-width: 1200px)');
    const update = (): void => setViewMode(currentViewMode());
    update();
    wide.addEventListener('change', update);
    full.addEventListener('change', update);
    return () => {
      wide.removeEventListener('change', update);
      full.removeEventListener('change', update);
    };
  }, []);
}

function Skeleton(): ReactElement {
  const mode = useStore((s) => s.viewMode);
  const count = mode === 'desktop' ? 5 : mode === 'tablet' ? 2 : 1;
  return (
    <div className="board skeleton" aria-hidden="true">
      <div className="lists">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="list ghost-list">
            <span className="bar" />
            <span className="block" />
            <span className="block" />
            <span className="block" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Stage(): ReactElement {
  const route = useRoute();
  const board = useStore((s) => s.board);
  const phase = useStore((s) => s.boardPhase);
  const cardRoute = useStore((s) => s.cardRoute);
  const focusOnReady = useStore((s) => s.focusOnReady);

  useEffect(() => {
    if (phase === 'ready' && board && focusOnReady) {
      const selector = takeFocusOnReady(board.id);
      if (selector) document.querySelector<HTMLElement>(selector)?.focus();
    }
  }, [phase, focusOnReady, board?.id]);

  if (route.kind === 'log') return <PermissionLog workspaceId={route.workspaceId} />;
  if (route.kind === 'card' && cardRoute?.phase === 'missing') return <NotFound what="card" />;
  if (phase === 'missing') return <NotFound what="board" />;
  if (!board || phase !== 'ready') return <Skeleton />;
  return <BoardScreen board={board} />;
}

function Authenticated(): ReactElement {
  const address = useAddress();
  const route = useRoute();
  const workspace = useStore((s) => s.workspace);
  const lift = useStore((s) => s.lift);
  const board = useStore((s) => s.board);
  const mode = useStore((s) => s.viewMode);
  const cardRoute = useStore((s) => s.cardRoute);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  useViewMode();

  useEffect(() => {
    if (route.kind === 'home' && workspace) void goHome(workspace.id);
    else if (route.kind === 'board') {
      leaveCard();
      void openBoard(route.boardId, route.list);
    } else if (route.kind === 'card') void showCard(route.cardId);
  }, [address, workspace?.id]);

  useEffect(() => {
    if (lift?.mode !== 'pointer') return;
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelLift();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [lift?.mode]);

  const ui = useMemo<Ui>(() => ({ open: setDialog, moveCard: setMoving, close: () => { setDialog(null); setMoving(null); } }), []);
  const close = ui.close;

  return (
    <UiContext.Provider value={ui}>
      <TopBar sheetOpen={dialog === 'sheet'} />
      <ServiceBanner />
      <Notices />
      <div className="frame">
        {mode !== 'phone' && <Drawer />}
        <div className="stage">
          <Stage />
        </div>
      </div>
      <Announcements />
      <Toast />
      {route.kind === 'card' && board && cardRoute?.phase === 'ready' && <CardDialog cardId={route.cardId} />}
      {dialog === 'new-board' && <NewBoardDialog onClose={close} />}
      {dialog === 'settings' && <SettingsDialog onClose={close} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={close} />}
      {dialog === 'password' && <PasswordDialog onClose={close} />}
      {dialog === 'sheet' && <BoardsSheet onClose={close} />}
      {moving && <MoveDialog cardId={moving} onClose={close} />}
    </UiContext.Provider>
  );
}

export function App(): ReactElement {
  const route = useRoute();
  const session = useStore((s) => s.session);

  useEffect(() => {
    if (route.kind === 'signin') enterSignIn();
    else void boot();
  }, [route.kind]);

  useEffect(() => {
    const revisit = (event: PageTransitionEvent): void => {
      if (event.persisted) location.reload();
    };
    window.addEventListener('pageshow', revisit);
    return () => window.removeEventListener('pageshow', revisit);
  }, []);

  if (route.kind === 'signin') return <SignIn next={route.next} />;
  if (route.kind === 'unknown') return <><header className="topbar"><Masthead /></header><NotFound what="board" /></>;
  if (session !== 'in') return <div className="booting" aria-hidden="true" />;
  return <Authenticated />;
}
