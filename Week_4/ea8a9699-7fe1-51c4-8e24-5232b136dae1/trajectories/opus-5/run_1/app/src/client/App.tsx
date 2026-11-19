import { useRouter } from './lib/router.js';
import { useSession } from './lib/session.js';
import { Admin } from './screens/Admin.js';
import { ClusterSettings } from './screens/ClusterSettings.js';
import { Explore } from './screens/Explore.js';
import { InviteAcceptance } from './screens/InviteAcceptance.js';
import { NotFound } from './screens/NotFound.js';
import { Profile } from './screens/Profile.js';
import { PublicCluster } from './screens/PublicCluster.js';
import { Review } from './screens/Review.js';
import { SignIn } from './screens/SignIn.js';
import { SignUp } from './screens/SignUp.js';
import { Wall } from './screens/Wall.js';

export function App(): JSX.Element {
  const { location } = useRouter();
  const { loaded } = useSession();
  const segments = location.pathname.split('/').filter((part) => part !== '');

  if (segments.length === 0) {
    return <Explore />;
  }
  if (segments[0] === 'signin' && segments.length === 1) {
    return <SignIn />;
  }
  if (segments[0] === 'signup' && segments.length === 1) {
    return <SignUp />;
  }
  if (segments[0] === 'explore' && segments.length === 1) {
    return <Explore />;
  }
  if (segments[0] === 'invite' && segments.length === 2) {
    return <InviteAcceptance token={segments[1]} />;
  }
  if (segments[0] === 'review' && segments.length === 2) {
    return <Review token={segments[1]} />;
  }
  if (segments[0] === 'c' && segments.length === 2) {
    return <PublicCluster clusterId={segments[1]} />;
  }
  if (segments[0].startsWith('@') && segments.length === 1) {
    return <Profile handle={segments[0].slice(1)} />;
  }
  if (segments[0] === 'w' && segments.length >= 2) {
    if (!loaded) {
      return <div className="page" />;
    }
    if (segments.length === 2) {
      return <Wall slug={segments[1]} />;
    }
    if (segments.length === 3 && segments[2] === 'admin') {
      return <Admin slug={segments[1]} />;
    }
    if (segments.length === 4 && segments[2] === 'clusters') {
      return <ClusterSettings slug={segments[1]} clusterId={segments[3]} />;
    }
  }
  return <NotFound />;
}
