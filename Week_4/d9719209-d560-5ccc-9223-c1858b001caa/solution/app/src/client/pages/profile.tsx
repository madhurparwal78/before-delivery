import type { PublicUser } from '../../shared/types.js';
import { utcDateLabel } from '../../shared/format.js';
import { get, query } from '../api.js';
import { useLoad } from '../data.js';
import { FeedList, type FeedPage } from '../feed.js';
import { Empty, Skeleton, pageTitle } from '../ui.js';
import './pages.css';

export function ProfilePage({ username }: { username: string }): React.JSX.Element {
  pageTitle(`u/${username}`);
  const profile = useLoad(() => get<PublicUser>(`/api/users/${encodeURIComponent(username)}`), username.toLowerCase());
  if (profile.error?.status === 404) return <Empty title="Member not found">There is no member called {username}.</Empty>;
  if (!profile.data) return <Skeleton rows={2} />;
  return (
    <div className="page-solo">
      <header className="community-head">
        <div>
          <h1>{profile.data.username}</h1>
          <p className="slug">Joined <span className="num">{utcDateLabel(profile.data.createdAt)}</span></p>
        </div>
      </header>
      <FeedList
        resetKey={profile.data.username} topics={[]}
        load={(cursor) => get<FeedPage>(`/api/users/${encodeURIComponent(username)}/posts${query({ cursor })}`)}
        empty={<Empty title="No posts yet">{profile.data.username} has not posted anything.</Empty>}
      />
    </div>
  );
}
