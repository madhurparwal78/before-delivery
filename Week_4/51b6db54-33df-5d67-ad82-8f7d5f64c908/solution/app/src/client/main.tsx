import { options, render } from 'preact';
import { useEffect } from 'preact/hooks';
import { loadConfig } from './config';
import { Invite } from './pages/Invite';
import { Landing } from './pages/Landing';
import { Project } from './pages/Project';
import { Projects } from './pages/Projects';
import { SignIn, SignUp } from './pages/Auth';
import { Share } from './pages/Share';
import { NotFound } from './pages/NotFound';
import { onLinkClick, usePath } from './router';
import { loadMe } from './session';
import { WorkspacePage } from './workspace/Workspace';
import './styles.css';

// Effects and renders must not wait on animation frames or timers: the page clock may be paused.
options.requestAnimationFrame = (callback) => queueMicrotask(callback);
options.debounceRendering = (callback) => queueMicrotask(callback);

function App() {
  const path = usePath();
  useEffect(() => {
    void loadMe();
    void loadConfig();
  }, []);
  const project = /^\/projects\/(\d+)$/.exec(path);
  const sprite = /^\/projects\/(\d+)\/sprites\/(\d+)$/.exec(path);
  const invite = /^\/invites\/([^/]+)$/.exec(path);
  const share = /^\/s\/([^/]+)$/.exec(path);
  if (path === '/') return <Landing />;
  if (path === '/signup') return <SignUp />;
  if (path === '/signin') return <SignIn />;
  if (path === '/projects') return <Projects />;
  if (project?.[1]) return <Project id={Number(project[1])} />;
  if (sprite?.[2]) return <WorkspacePage key={sprite[2]} spriteId={Number(sprite[2])} />;
  if (invite?.[1]) return <Invite token={decodeURIComponent(invite[1])} />;
  if (share?.[1]) return <Share token={decodeURIComponent(share[1])} />;
  return <NotFound />;
}

document.addEventListener('click', onLinkClick);
const FONTS = ['300 1em "Stack Sans Headline"', '600 1em "Stack Sans Headline"', '400 1em "Stack Sans Text"', '600 1em "Stack Sans Text"'];

/** Resolves once the shipped faces are decoded, so the first paint is already in them and nothing reflows when they arrive. */
function fontsReady(): Promise<unknown> {
  const loaded = Promise.allSettled(FONTS.map((face) => document.fonts.load(face)));
  const patience = new Promise((resolve) => setTimeout(resolve, 1500));
  return Promise.race([loaded, patience]);
}

const root = document.getElementById('root');
if (root) void fontsReady().then(() => render(<App />, root));
