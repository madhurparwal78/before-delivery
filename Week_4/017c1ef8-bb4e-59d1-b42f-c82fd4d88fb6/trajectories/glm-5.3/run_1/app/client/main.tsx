import { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from './app-context.js';
import { Landing } from './pages/landing.js';
import { AuthPages } from './pages/auth.js';
import { Feed } from './pages/feed.js';
import { PostPage } from './pages/post.js';
import { HashtagPage } from './pages/hashtag.js';
import { ProfilePage } from './pages/profile.js';
import { MutualPage } from './pages/mutual.js';
import { NetworkPage } from './pages/network.js';
import { MessagingPage } from './pages/messaging.js';
import { NotificationsPage } from './pages/notifications.js';
import { SearchPage } from './pages/search.js';
import { JobsPage, JobPage, BoardPage, MyJobsPage, JobEditorPage } from './pages/jobs.js';
import { CompanyPage } from './pages/company.js';
import { SettingsPage } from './pages/settings.js';
import { NotFound } from './pages/notfound.js';
import { Header } from './chrome/header.js';
import { LiveRegion } from './live.js';
import './style.css';

const REGIONS = [
  { role: 'status', name: 'Network announcements' },
  { role: 'status', name: 'Feed announcements' },
  { role: 'status', name: 'Messaging announcements' },
  { role: 'status', name: 'Jobs announcements' },
  { role: 'status', name: 'Profile announcements' },
] as const;

const Announcer = ({ texts }: { texts: Record<string, string> }): JSX.Element => (
  <>
    {REGIONS.map((region) => (
      <LiveRegion key={region.name} role={region.role} name={region.name} text={texts[region.name] ?? ''} />
    ))}
  </>
);

const announce = (region: string, text: string): void => {
  window.dispatchEvent(new CustomEvent('pw-announce', { detail: { region, text } }));
};
export { announce };

const Shell = (): JSX.Element => {
  const { route, signedIn } = useApp();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const prevSignedIn = useRef(signedIn);

  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ region: string; text: string }>).detail;
      setTexts((prev) => ({ ...prev, [detail.region]: detail.text }));
    };
    window.addEventListener('pw-announce', handler);
    return () => window.removeEventListener('pw-announce', handler);
  }, []);

  useEffect(() => {
    if (prevSignedIn.current && !signedIn) {
      window.location.href = '/';
    }
    prevSignedIn.current = signedIn;
  }, [signedIn]);

  const path = route.path;
  const memberPrefix = '/in/';
  const messagingPrefix = '/messaging';

  const screen = (): JSX.Element => {
    if (!signedIn) {
      if (path === '/' || path === '') return <Landing />;
      if (path === '/join') return <AuthPages mode="join" />;
      if (path === '/confirm') return <AuthPages mode="confirm" />;
      if (path === '/signin') return <AuthPages mode="signin" />;
      return <AuthPages mode="signin" redirect={path} />;
    }
    if (path === '/' || path === '' || path === '/feed') return <Feed />;
    if (path === '/join' || path === '/signin' || path === '/confirm') return <Feed />;
    if (path.startsWith('/posts/')) {
      const id = path.slice('/posts/'.length);
      return <PostPage postId={id} />;
    }
    if (path.startsWith('/hashtag/')) return <HashtagPage tag={path.slice('/hashtag/'.length)} />;
    if (path.startsWith(memberPrefix) && path.endsWith('/mutual')) {
      const handle = path.slice(memberPrefix.length, -'/mutual'.length);
      return <MutualPage handle={handle} />;
    }
    if (path.startsWith(memberPrefix)) return <ProfilePage handle={path.slice(memberPrefix.length)} />;
    if (path === '/network') return <NetworkPage />;
    if (path === '/messaging') return <MessagingPage />;
    if (path.startsWith('/messaging/with/')) return <MessagingPage withHandle={path.slice('/messaging/with/'.length)} />;
    if (path.startsWith(messagingPrefix)) return <MessagingPage conversationId={path.slice(messagingPrefix.length + 1)} />;
    if (path === '/notifications') return <NotificationsPage />;
    if (path === '/search') return <SearchPage />;
    if (path === '/jobs') return <JobsPage />;
    if (path === '/my-jobs') return <MyJobsPage />;
    if (path === '/settings') return <SettingsPage />;
    if (path.startsWith('/company/')) return <CompanyPage handle={path.slice('/company/'.length)} />;
    const jobsPrefix = '/jobs/';
    if (path.endsWith('/applicants')) {
      return <BoardPage jobId={path.slice(jobsPrefix.length, -'/applicants'.length)} />;
    }
    if (path.endsWith('/edit')) {
      return <JobEditorPage jobId={path.slice(jobsPrefix.length, -'/edit'.length)} />;
    }
    if (path.startsWith(jobsPrefix)) return <JobPage jobId={path.slice(jobsPrefix.length)} />;
    return <NotFound />;
  };

  const isLanding = !signedIn;

  return (
    <>
      <Announcer texts={texts} />
      {signedIn && <Header />}
      <main className={isLanding ? 'landing-main' : 'content'}>{screen()}</main>
    </>
  );
};

const Root = (): JSX.Element => (
  <AppProvider>
    <Shell />
  </AppProvider>
);

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(<Root />);
}
