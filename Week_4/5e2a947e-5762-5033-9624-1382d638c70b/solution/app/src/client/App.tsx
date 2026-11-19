import { location$, parseRoute } from './router.ts';
import { useSignal } from './signal.ts';
import { Audience } from './pages/Audience.tsx';
import { Editor } from './pages/Editor.tsx';
import { Home } from './pages/Home.tsx';
import { Maps } from './pages/Maps.tsx';
import { NotFound } from './pages/NotFound.tsx';
import { ShareEntry } from './pages/ShareEntry.tsx';
import { SignIn, SignUp } from './pages/Auth.tsx';
import { VersionView } from './pages/VersionView.tsx';

export function App() {
  const route = parseRoute(useSignal(location$));
  switch (route.page) {
    case 'home':
      return <Home />;
    case 'signup':
      return <SignUp />;
    case 'signin':
      return <SignIn />;
    case 'maps':
      return <Maps />;
    case 'editor':
      return <Editor key={route.mapId} mapId={route.mapId} />;
    case 'version':
      return <VersionView key={route.versionId} mapId={route.mapId} versionId={route.versionId} />;
    case 'share':
      return <ShareEntry code={route.code} />;
    case 'audience':
      return <Audience code={route.code} />;
    case 'missing':
      return <NotFound />;
  }
}
