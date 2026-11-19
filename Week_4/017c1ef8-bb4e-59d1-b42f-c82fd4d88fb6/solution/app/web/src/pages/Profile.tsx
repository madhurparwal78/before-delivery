import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ProfileView } from '../components/profile/ProfileView';
import { useProfile } from '../components/profile/useProfile';
import { EmptyState } from '../ui';

function ProfilePage({ handle }: { handle: string }) {
  const { status, profile, path, refresh } = useProfile(handle);
  const [blocked, setBlocked] = useState(false);

  if (profile && (status === 'ready' || blocked)) {
    return <ProfileView profile={profile} path={path} refresh={refresh} blocked={blocked} onBlocked={() => setBlocked(true)} />;
  }
  if (status === 'unavailable') {
    return <EmptyState heading="h1" sentence="This profile isn't available" action={{ label: 'Go to Home', to: '/feed' }} />;
  }
  return null;
}

/** `/in/<handle>`: a member's profile, or your own (the Me page). */
export default function Profile() {
  const { handle = '' } = useParams();
  return <ProfilePage key={handle} handle={handle} />;
}
