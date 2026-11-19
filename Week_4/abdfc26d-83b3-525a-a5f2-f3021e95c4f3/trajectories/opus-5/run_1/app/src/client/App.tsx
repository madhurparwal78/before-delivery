import { StudioHeader } from './components/StudioHeader.js';
import { useRouter } from './lib/router.js';
import { Console } from './screens/Console.js';
import { Editor } from './screens/Editor/index.js';
import { Gallery } from './screens/Gallery.js';
import { Landing } from './screens/Landing.js';
import { Library } from './screens/Library.js';
import { PiecePage } from './screens/PiecePage.js';
import { Studio, StudioCredits } from './screens/Studio.js';

function Screen({ path }: { path: string }): JSX.Element {
  if (path === '/') return <Landing />;
  if (path === '/gallery') return <Gallery />;
  if (path === '/studio') return <Studio />;
  if (path === '/studio/credits') return <StudioCredits />;
  if (path === '/library') return <Library />;
  if (path === '/console') return <Console />;

  const editorMatch = /^\/studio\/pieces\/([A-Za-z0-9-]+)$/.exec(path);
  if (editorMatch?.[1]) return <Editor slug={editorMatch[1]} />;

  const pieceMatch = /^\/pieces\/([A-Za-z0-9-]+)$/.exec(path);
  if (pieceMatch?.[1]) return <PiecePage slug={pieceMatch[1]} />;

  return <Landing />;
}

export function App(): JSX.Element {
  const { path } = useRouter();
  const isLanding = path === '/';

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <StudioHeader />
      <main id="main" className={isLanding ? 'main--hero' : 'main--inner'}>
        <Screen path={path} />
      </main>
      <footer className="site-footer">
        <div className="shell site-footer__inner">
          <p className="muted">Phosphene Yard · Brightmoss Works</p>
          <p className="muted">Prices are tax-exclusive. VAT is added at checkout.</p>
        </div>
      </footer>
    </>
  );
}
