import { Navigate, Route, Routes } from 'react-router-dom';
import { MemberLayout, MemberShell, SignedOutLayout } from './Layout';
import { useSession } from './session';
import Applicants from './pages/Applicants';
import Company from './pages/Company';
import Confirm from './pages/Confirm';
import Feed from './pages/Feed';
import Hashtag from './pages/Hashtag';
import JobEditor from './pages/JobEditor';
import JobPage from './pages/JobPage';
import Jobs from './pages/Jobs';
import Join from './pages/Join';
import Landing from './pages/Landing';
import Messaging from './pages/Messaging';
import Mutual from './pages/Mutual';
import MyJobs from './pages/MyJobs';
import Network from './pages/Network';
import NotFound from './pages/NotFound';
import Notifications from './pages/Notifications';
import PostPage from './pages/PostPage';
import Profile from './pages/Profile';
import Search from './pages/Search';
import Settings from './pages/Settings';
import SignIn from './pages/SignIn';

/** `/`: the landing page when signed out, the feed when signed in. */
function Home() {
  const { member } = useSession();
  if (member === undefined) return null;
  return member ? <Navigate to="/feed" replace /> : <Landing />;
}

/** Any other address: the not-found page, inside the member layout when signed in. */
function Unknown() {
  const { member } = useSession();
  if (member === undefined) return null;
  return member ? (
    <MemberShell>
      <NotFound />
    </MemberShell>
  ) : (
    <NotFound />
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route element={<SignedOutLayout />}>
        <Route path="/join" element={<Join />} />
        <Route path="/confirm" element={<Confirm />} />
        <Route path="/signin" element={<SignIn />} />
      </Route>
      <Route element={<MemberLayout />}>
        <Route path="/feed" element={<Feed />} />
        <Route path="/posts/:postId" element={<PostPage />} />
        <Route path="/hashtag/:tag" element={<Hashtag />} />
        <Route path="/in/:handle" element={<Profile />} />
        <Route path="/in/:handle/mutual" element={<Mutual />} />
        <Route path="/network" element={<Network />} />
        <Route path="/messaging" element={<Messaging />} />
        <Route path="/messaging/with/:handle" element={<Messaging />} />
        <Route path="/messaging/:conversationId" element={<Messaging />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/search" element={<Search />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/:jobId" element={<JobPage />} />
        <Route path="/jobs/:jobId/applicants" element={<Applicants />} />
        <Route path="/jobs/:jobId/edit" element={<JobEditor />} />
        <Route path="/my-jobs" element={<MyJobs />} />
        <Route path="/company/:handle" element={<Company />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Unknown />} />
    </Routes>
  );
}
