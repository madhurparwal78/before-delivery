import { get, query } from '../api.js';
import { CommunityHead, CommunitySidebar, useCommunity } from '../community.js';
import { FeedList, type FeedPage } from '../feed.js';
import { Link } from '../router.js';
import { useSession } from '../session.js';
import { Empty, Skeleton, pageTitle } from '../ui.js';
import { SortTabs, useSort } from './home.js';

export function CommunityPage({ name }: { name: string }): React.JSX.Element {
  const { user } = useSession();
  const community = useCommunity(name);
  const [sort, setSort] = useSort();
  const data = community.data;
  pageTitle(data ? data.title : '');
  if (community.error?.status === 404) return <Empty title="Community not found">There is no community called c/{name}.</Empty>;
  if (!data) return <Skeleton rows={3} />;
  return (
    <div className="page-grid">
      <div className="page-head">
        <CommunityHead
          community={data} onChange={(next) => community.setData(next)}
          actions={user && <Link to={`/c/${data.name}/submit`} className="btn btn-primary">New post</Link>}
        />
      </div>
      <div className="page-side"><CommunitySidebar community={data} /></div>
      <div className="page-main">
        <SortTabs sort={sort} onChange={setSort} />
        <FeedList
          inCommunity resetKey={`${data.name}:${sort}`} topics={[`community:${data.name.toLowerCase()}`]}
          load={(cursor) => get<FeedPage>(`/api/communities/${data.name}/posts${query({ sort, cursor })}`)}
          empty={<Empty title="No posts yet">Be the first to post in c/{data.name}.</Empty>}
        />
      </div>
    </div>
  );
}
