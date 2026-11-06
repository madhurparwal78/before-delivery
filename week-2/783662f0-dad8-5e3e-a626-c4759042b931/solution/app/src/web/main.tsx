import { type ReactNode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { PUBLIC_ROUTES, RouterProvider, matchRoute, useRouter } from './router.js';
import {
  RosterProvider,
  ServerNotice,
  SessionProvider,
  TopBar,
  useRoster,
  useServer,
  useSession,
} from './shell.js';
import { CharacterPicker } from './pages/roster.js';
import { BillingPage } from './pages/billing.js';
import {
  HelpPage,
  JoinPage,
  NewServerPage,
  NotFoundPage,
  ServersPage,
  SignInPage,
} from './pages/entry.js';
import { AdminPage } from './pages/admin.js';
import { RosterPage } from './pages/roster.js';
import { CoinsPage, PurchasePage } from './pages/coins.js';
import { LeaderboardsPage } from './pages/leaderboards.js';
import { GamesPage, ReplayPage } from './pages/games.js';
import { WorldPage } from './pages/world.js';

const OWNER_ONLY = new Set(['billing', 'admin']);

function App(): ReactNode {
  const { path, go } = useRouter();
  const { user, loaded } = useSession();
  const match = matchRoute(path);
  const slug = match.params.slug;
  const { server } = useServer(slug);

  /* A path that is no route renders the not-found page for anyone. */
  const needsSession = !PUBLIC_ROUTES.includes(match.name) && match.name !== 'not-found';

  useEffect(() => {
    if (!loaded || user !== null || !needsSession) return;
    go(`/sign-in?next=${encodeURIComponent(path)}`, { replace: true });
  }, [loaded, user, needsSession, go, path]);

  if (!loaded || (needsSession && user === null)) {
    return (
      <>
        <TopBar server={null} showPicker={false} picker={null} />
        <main />
      </>
    );
  }

  /* An owner-only route opened by a non-owner renders the not-found page. */
  const ownerRefused =
    OWNER_ONLY.has(match.name) && server !== null && server.role !== 'owner';
  const name = match.name === 'not-found' || ownerRefused ? 'not-found' : match.name;

  /* The character picker sits in the top bar on world pages; the roster page
     carries it in its own content, beside the roster it filters. */
  const withPicker = name === 'world' || name === 'table';

  return (
    <>
      <TopBar
        server={slug === undefined ? null : server}
        showPicker={withPicker}
        picker={<TopBarPicker />}
      />
      <ServerNotice server={slug === undefined ? null : server} />
      <main>{screenFor(name, match.params, server)}</main>
    </>
  );
}

function TopBarPicker(): ReactNode {
  const { characters, activeId, pick } = useRoster();
  return (
    <CharacterPicker
      characters={characters}
      activeId={activeId}
      onPick={(character) => pick(character.id)}
    />
  );
}

function screenFor(
  name: string,
  params: Record<string, string>,
  server: ReturnType<typeof useServer>['server'],
): ReactNode {
  switch (name) {
    case 'sign-in':
      return <SignInPage />;
    case 'join':
      return <JoinPage token={params.token} />;
    case 'help':
      return <HelpPage />;
    case 'servers':
      return <ServersPage />;
    case 'new-server':
      return <NewServerPage />;
    case 'billing':
      return <BillingPage slug={params.slug} />;
    case 'admin':
      return <AdminPage slug={params.slug} server={server} />;
    case 'roster':
      return <RosterPage slug={params.slug} />;
    case 'coins':
      return <CoinsPage slug={params.slug} />;
    case 'purchase':
      return <PurchasePage purchaseId={params.purchaseId} server={server} />;
    case 'leaderboards':
      return <LeaderboardsPage slug={params.slug} server={server} />;
    case 'games':
      return <GamesPage slug={params.slug} />;
    case 'replay':
      return <ReplayPage slug={params.slug} gameId={params.gameId} />;
    case 'world':
      return <WorldPage slug={params.slug} world={params.world} tableId={null} />;
    case 'table':
      return (
        <WorldPage
          slug={params.slug}
          world={params.world}
          tableId={params.tableId}
        />
      );
    default:
      return <NotFoundPage />;
  }
}

/** The roster provider needs the route's server, so it wraps the whole app. */
function Shell(): ReactNode {
  const { path } = useRouter();
  return (
    <RosterProvider slug={matchRoute(path).params.slug}>
      <App />
    </RosterProvider>
  );
}

const host = document.getElementById('root');
if (host !== null) {
  createRoot(host).render(
    <RouterProvider>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </RouterProvider>,
  );
}
