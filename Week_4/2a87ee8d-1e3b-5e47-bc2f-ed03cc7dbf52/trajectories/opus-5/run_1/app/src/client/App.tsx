import { useRouter } from './lib/router.js';
import { Landing } from './pages/Landing.js';
import { SignIn } from './pages/SignIn.js';
import { Workshops } from './pages/Workshops.js';
import { BillingPage } from './pages/BillingPage.js';
import { Activity } from './pages/Activity.js';
import { Join } from './pages/Join.js';
import { RecapPageView } from './pages/RecapPage.js';
import { Room } from './room/Room.js';

export function App(): JSX.Element {
  const { path } = useRouter();

  if (path === '/') return <Landing />;
  if (path === '/signin') return <SignIn />;
  if (path === '/workshops') return <Workshops />;
  if (path === '/billing') return <BillingPage />;
  if (path === '/activity') return <Activity />;

  const join = /^\/join\/(.+)$/.exec(path);
  if (join) return <Join token={join[1] as string} />;

  const room = /^\/w\/(.+)$/.exec(path);
  if (room) return <Room workshopId={room[1] as string} key={room[1]} />;

  const recap = /^\/recap\/(.+)$/.exec(path);
  if (recap) return <RecapPageView token={recap[1] as string} />;

  return (
    <main className="column">
      <h1>Not found</h1>
    </main>
  );
}
