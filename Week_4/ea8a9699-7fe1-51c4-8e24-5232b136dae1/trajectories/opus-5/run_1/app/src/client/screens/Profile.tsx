import { useCallback, useEffect, useState } from 'react';
import { ApiFailure, apiGet, apiSend } from '../lib/api.js';
import { Link, useRouter } from '../lib/router.js';
import { useSession } from '../lib/session.js';
import { profileCopy } from '../lib/copy.js';
import { TopBar } from '../components/TopBar.js';
import { LiveRegion, RollingCount } from '../components/Bits.js';
import { NotFound } from './NotFound.js';
import type { CuratorProfile, FollowResponse } from '../../shared/types.js';

export function Profile({ handle }: { handle: string }): JSX.Element {
  const { account } = useSession();
  const { navigate } = useRouter();
  const [profile, setProfile] = useState<CuratorProfile | null>(null);
  const [missing, setMissing] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [message, setMessage] = useState('');

  const load = useCallback(async (): Promise<void> => {
    const loaded = await apiGet<CuratorProfile>(`/api/curators/${encodeURIComponent(handle)}`);
    setProfile(loaded);
    setFollowerCount(loaded.followerCount);
  }, [handle]);

  useEffect(() => {
    setFollowing(false);
    void load().catch(() => setMissing(true));
  }, [load]);

  if (missing) {
    return <NotFound />;
  }
  if (profile === null) {
    return (
      <>
        <TopBar />
        <div className="page" />
      </>
    );
  }

  const isSelf = account !== null && account.handle === profile.handle;

  const toggleFollow = async (): Promise<void> => {
    if (account === null) {
      navigate(`/signin?next=${encodeURIComponent(`/@${profile.handle}`)}`);
      return;
    }
    const wasFollowing = following;
    const previousCount = followerCount;
    setFollowing(!wasFollowing);
    setFollowerCount(previousCount + (wasFollowing ? -1 : 1));
    try {
      const response = await apiSend<FollowResponse>(
        wasFollowing ? 'DELETE' : 'POST',
        `/api/curators/${encodeURIComponent(profile.handle)}/follow`,
      );
      setFollowing(response.following);
      setFollowerCount(response.followerCount);
      setMessage(
        response.following
          ? profileCopy.followed(profile.displayName, response.followerCount)
          : profileCopy.unfollowed(profile.displayName, response.followerCount),
      );
    } catch (error) {
      setFollowing(wasFollowing);
      setFollowerCount(previousCount);
      setMessage(profileCopy.failed(previousCount));
      if (!(error instanceof ApiFailure)) {
        return;
      }
    }
  };

  return (
    <>
      <TopBar />
      <div className="page">
        <div className="profile-head">
          <h1>{profile.displayName}</h1>
          <p className="handle">@{profile.handle}</p>
          <p>
            <RollingCount value={followerCount} /> followers
          </p>
          {isSelf ? null : (
            <button type="button" aria-pressed={following} onClick={() => void toggleFollow()}>
              {following ? 'Following' : 'Follow'}
            </button>
          )}
          <LiveRegion name="Profile status" message={message} />
        </div>

        <div className="masonry explore-masonry">
          {profile.clusters.map((cluster) => (
            <article className="card feed-card" aria-label={cluster.title} key={cluster.id}>
              {cluster.coverUrl === null ? null : <img src={cluster.coverUrl} alt="" />}
              <div className="card-body">
                <h3>
                  <Link to={`/c/${cluster.id}`}>{cluster.title}</Link>
                </h3>
                <div className="feed-meta">
                  <span>
                    <span className="count">{cluster.publicItemCount}</span> items
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
