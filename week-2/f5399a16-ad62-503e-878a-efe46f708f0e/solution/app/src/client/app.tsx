import { useRef, useState, type ReactElement } from 'react';
import { useRoute } from './router';
import { NotFound, wantHeadingFocus } from './ui/kit';
import { DeskFrame } from './screens/frame';
import { HowItWorks, Home, PublicFrame, PublicReel } from './screens/public';
import { SignIn, SignUp } from './screens/access';
import { Jobs } from './screens/jobs';
import { ClientScreen, Clients } from './screens/clients';
import { Calls } from './screens/calls';
import { BoardScreen } from './screens/board';
import { Script } from './screens/script';
import { Reel } from './screens/reel';
import { Lines } from './screens/lines';
import { Cues } from './screens/cues';
import { Cuts } from './screens/cuts';
import { Compare } from './screens/compare';
import { Notes } from './screens/notes';
import { Delivery } from './screens/delivery';
import { LetterScreen } from './screens/letter';
import { ReviewPage } from './screens/review';
import { SignOffPage } from './screens/signoff';
import { FeePage } from './screens/fee';

const firstPathWas404 = document.querySelector('meta[name="clapstick-status"]')?.getAttribute('content') === '404';

function deskScreen(parts: string[]) {
  const [, section, id, sub] = parts;
  if (section === 'jobs' && !id) return <Jobs />;
  if (section === 'clients' && !id) return <Clients />;
  if (section === 'calls' && !id) return <Calls />;
  if (section === 'clients' && id && !sub) return <ClientScreen key={id} clientId={id} />;
  if (section === 'jobs' && id) {
    const screens: Record<string, ReactElement> = {
      '': <BoardScreen key={id} jobId={id} />,
      script: <Script key={id} jobId={id} />,
      reel: <Reel key={id} jobId={id} />,
      lines: <Lines key={id} jobId={id} />,
      cues: <Cues key={id} jobId={id} />,
      cuts: <Cuts key={id} jobId={id} />,
      compare: <Compare key={id} jobId={id} />,
      notes: <Notes key={id} jobId={id} />,
      delivery: <Delivery key={id} jobId={id} />,
      letter: <LetterScreen key={id} jobId={id} />,
    };
    return screens[sub ?? ''] ?? <NotFound />;
  }
  return <NotFound />;
}

function publicScreen(path: string) {
  switch (path) {
    case '/': return <Home />;
    case '/reel': return <PublicReel />;
    case '/how-it-works': return <HowItWorks />;
    case '/sign-in': return <SignIn />;
    case '/sign-up': return <SignUp />;
    default: return <NotFound />;
  }
}

export function App() {
  const route = useRoute();
  const previous = useRef(route.path);
  const [wasNotFound, setWasNotFound] = useState(firstPathWas404);
  if (previous.current !== route.path) {
    if (route.path.startsWith('/desk')) wantHeadingFocus();
    previous.current = route.path;
    if (wasNotFound) setWasNotFound(false);
  }
  const parts = route.path.split('/').slice(1);
  if (parts[0] === 'desk' && !wasNotFound) {
    return <DeskFrame key="desk">{<DeskRoute key={route.path} parts={parts} />}</DeskFrame>;
  }
  if (parts[0] === 'r' && parts[1] && !wasNotFound) return <ReviewPage key={parts[1]} token={parts[1]} />;
  if (parts[0] === 's' && parts[1] && !wasNotFound) return <SignOffPage key={parts[1]} token={parts[1]} />;
  if (parts[0] === 'f' && parts[1] && !wasNotFound) return <FeePage key={parts[1]} token={parts[1]} />;
  return <PublicFrame screen={(path) => (wasNotFound ? <NotFound /> : publicScreen(path))} />;
}

function DeskRoute({ parts }: { parts: string[] }) {
  return deskScreen(parts);
}
