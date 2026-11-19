import { render } from 'preact';
import { useRoute } from './router.tsx';
import { session } from './store.ts';
import { NotFound, Screen } from './ui.tsx';
import type { PageBoot } from '../shared/types.ts';
import './styles.css';
import { Home } from './pages/Home.tsx';
import { Signup, Login, Confirm } from './pages/Auth.tsx';
import { Inbox, Repos, Organisation } from './pages/Lists.tsx';
import { Overview, Blob, Editor, Revision, Changes, NewChange } from './pages/Repo.tsx';
import { ChangePage } from './pages/Change.tsx';
import { QueuePage } from './pages/Queue.tsx';
import { Settings } from './pages/Settings.tsx';

export const boot: PageBoot = JSON.parse(document.getElementById('boot')!.textContent!);
session.set(boot.user);
document.documentElement.dataset.diffBreakpoint = String(boot.breakpoint);

function App() {
  const route = useRoute();
  // A server answer of 404 names the not-found page for the first screen; later navigation checks nothing itself.
  if (!route || (boot.notFound && window.location.pathname === bootPath)) return <NotFound />;
  switch (route.name) {
    case 'home': return <Home services={boot.services} />;
    case 'signup': return <Signup />;
    case 'login': return <Login />;
    case 'confirm': return <Confirm token={route.token} />;
    case 'inbox': return <Inbox />;
    case 'repos': return <Repos />;
    case 'org': return <Organisation org={route.org} />;
    case 'repo': return <Overview org={route.org} repo={route.repo} />;
    case 'blob': return <Blob {...route} />;
    case 'edit': return <Editor {...route} />;
    case 'revision': return <Revision {...route} />;
    case 'changes': return <Changes org={route.org} repo={route.repo} />;
    case 'newChange': return <NewChange org={route.org} repo={route.repo} />;
    case 'change': return <ChangePage org={route.org} repo={route.repo} number={route.number} />;
    case 'queue': return <QueuePage org={route.org} repo={route.repo} />;
    case 'settings': return <Settings org={route.org} repo={route.repo} />;
    default: return <Screen><div /></Screen>;
  }
}

const bootPath = window.location.pathname;
// The first screen waits for the bundled fonts (preloaded by the shell) so a late swap cannot shift its layout.
const fonts = Promise.all(['16px "Inter"', '16px "Inter Tight"', '16px "Martian Mono"'].map((font) => document.fonts.load(font))).catch(() => undefined);
await Promise.race([fonts, new Promise((resolve) => setTimeout(resolve, 1500))]);
render(<App />, document.getElementById('root')!);
