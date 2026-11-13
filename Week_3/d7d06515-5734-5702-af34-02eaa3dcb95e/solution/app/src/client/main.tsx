import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/landing.css';
import './styles/dashboard.css';
import { EditorPage } from './editor/EditorPage.tsx';
import { CheckInbox } from './pages/CheckInbox.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Landing } from './pages/Landing.tsx';
import { LinkRoute } from './pages/LinkRoute.tsx';
import { NotFound } from './pages/NotFound.tsx';
import { Open } from './pages/Open.tsx';
import { RequireSession } from './pages/RequireSession.tsx';
import { Signin } from './pages/Signin.tsx';
import { Signup } from './pages/Signup.tsx';
import { Verify } from './pages/Verify.tsx';
import { matchRoute, takeHeadingFocus, useLocation } from './router.tsx';
import { Announcements } from './ui/announce.tsx';

function Page() {
  const route = matchRoute(useLocation().pathname);
  switch (route.page) {
    case 'landing': return <Landing />;
    case 'signup': return <Signup />;
    case 'check-inbox': return <CheckInbox />;
    case 'verify': return <Verify key={route.token} token={route.token} />;
    case 'signin': return <Signin />;
    case 'open': return <Open />;
    case 'drawings': return <RequireSession>{(me) => <Dashboard me={me} />}</RequireSession>;
    case 'editor': return <RequireSession>{() => <EditorPage key={route.drawingId} drawingId={route.drawingId} />}</RequireSession>;
    case 'link': return <LinkRoute key={route.token} token={route.token} />;
    case 'not-found': return <NotFound />;
  }
}

function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!takeHeadingFocus()) return;
    const heading = document.querySelector<HTMLElement>('main h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [pathname]);
  return (
    <>
      <Page />
      <Announcements />
    </>
  );
}

const FONT_FACES = ['400', '500', '700', '800'].map((weight) => `${weight} 1em "Fira Sans"`);
const FONT_WAIT_MS = 2000;

/**
 * The first paint waits for the bundled faces: text set in a fallback and swapped later reflows the page
 * (layout shift). The wait is capped, on the browser's own timer, so a slow font never holds the page back.
 */
const fontsReady = Promise.race([
  Promise.all(FONT_FACES.map((face) => document.fonts.load(face))),
  new Promise<void>((resolve) => AbortSignal.timeout(FONT_WAIT_MS).addEventListener('abort', () => resolve(), { once: true })),
]).catch(() => undefined);

const root = document.getElementById('root');
if (root) void fontsReady.then(() => createRoot(root).render(<App />));
