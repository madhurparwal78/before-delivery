import { Chrome, NotFound } from './components/chrome';
import { useRouter } from './router';
import { AgendaPage } from './pages/agenda';
import { SignInPage, SignUpPage } from './pages/auth';
import { HomePage } from './pages/home';
import { MyAgendaPage } from './pages/my-agenda';
import { OrganiserPage } from './pages/organiser';
import { RecordPage } from './pages/record';
import { SessionPage } from './pages/session';
import { SpeakersPage } from './pages/speakers';

function sessionId(path: string): string | null {
  const match = path.startsWith('/sessions/') ? path.slice('/sessions/'.length) : '';
  if (!match || match.includes('/')) return null;
  try {
    return decodeURIComponent(match);
  } catch {
    return null;
  }
}

function Page() {
  const { place } = useRouter();
  const id = sessionId(place.path);
  if (id !== null) return <SessionPage key={id} id={id} />;
  switch (place.path) {
    case '/':
      return <HomePage />;
    case '/agenda':
      return <AgendaPage />;
    case '/my-agenda':
      return <MyAgendaPage />;
    case '/speakers':
      return <SpeakersPage />;
    case '/record':
      return <RecordPage />;
    case '/organiser':
      return <OrganiserPage />;
    case '/signin':
      return <SignInPage />;
    case '/signup':
      return <SignUpPage />;
    default:
      return <NotFound copy="We could not find that page." />;
  }
}

export function App() {
  return (
    <Chrome>
      <Page />
    </Chrome>
  );
}
