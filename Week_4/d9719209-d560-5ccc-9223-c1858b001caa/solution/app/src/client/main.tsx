import { createRoot } from 'react-dom/client';
import { matchPage, type PagePattern } from '../shared/routes.js';
import './styles.css';
import { SessionProvider } from './session.js';
import { Shell } from './shell.js';
import { usePath } from './router.js';
import { Empty } from './ui.js';
import { SignUpPage, LogInPage, VerifyPage, ForgotPage, ResetPage, TwoFactorPage, SettingsPage } from './pages/account.js';
import { CommunitiesPage, CreateCommunityPage } from './pages/communities.js';
import { ProfilePage } from './pages/profile.js';
import { ModLogPage } from './pages/modlog.js';
import { ModToolsPage } from './pages/modtools.js';
import { AdminReportsPage } from './pages/admin.js';
import { SubmitPage } from './pages/submit.js';
import { ThreadPage } from './pages/thread.js';
import { HomePage } from './pages/home.js';
import { CommunityPage } from './pages/community.js';
import { PostPage } from './pages/post.js';

const PAGES: Record<PagePattern, (params: Record<string, string>) => React.JSX.Element> = {
  '/': () => <HomePage />,
  '/signup': () => <SignUpPage />,
  '/login': () => <LogInPage />,
  '/verify': () => <VerifyPage />,
  '/forgot': () => <ForgotPage />,
  '/reset': () => <ResetPage />,
  '/settings': () => <SettingsPage />,
  '/settings/2fa': () => <TwoFactorPage />,
  '/communities': () => <CommunitiesPage />,
  '/communities/new': () => <CreateCommunityPage />,
  '/c/:name': (p) => <CommunityPage key={p.name} name={p.name as string} />,
  '/c/:name/submit': (p) => <SubmitPage key={p.name} name={p.name as string} />,
  '/c/:name/about/log': (p) => <ModLogPage key={p.name} name={p.name as string} />,
  '/c/:name/about/mod': (p) => <ModToolsPage key={p.name} name={p.name as string} />,
  '/c/:name/post/:postId': (p) => <PostPage key={p.postId} name={p.name as string} postId={p.postId as string} />,
  '/c/:name/post/:postId/comment/:commentId': (p) => <ThreadPage key={p.commentId} name={p.name as string} postId={p.postId as string} commentId={p.commentId as string} />,
  '/u/:username': (p) => <ProfilePage key={p.username} username={p.username as string} />,
  '/admin/reports': () => <AdminReportsPage />,
};

function Routes(): React.JSX.Element {
  const path = usePath();
  const match = matchPage(path);
  if (!match) {
    document.title = 'Not found — Moothall';
    return <Empty title="Page not found">This page does not exist. Go back to the home feed.</Empty>;
  }
  return PAGES[match.pattern](match.params);
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <SessionProvider>
    <Shell><Routes /></Shell>
  </SessionProvider>,
);
