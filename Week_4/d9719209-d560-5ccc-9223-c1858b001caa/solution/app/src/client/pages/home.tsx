import type { FeedSort } from '../../shared/types.js';
import { get, query } from '../api.js';
import { FeedList, type FeedPage } from '../feed.js';
import { useSearch, useSetParam } from '../router.js';
import { useSession } from '../session.js';
import { Empty, Tabs, pageTitle } from '../ui.js';

const SORTS = [
  { value: 'hot', label: 'Hot' },
  { value: 'new', label: 'New' },
  { value: 'top', label: 'Top' },
] as const;

export const isSort = (value: string | null): value is FeedSort => value === 'hot' || value === 'new' || value === 'top';

/** The sort tablist; the choice lives in `?sort=`, and a URL without it opens on Hot. */
export function useSort(): [FeedSort, (sort: FeedSort) => void] {
  const search = useSearch().get('sort');
  const setParam = useSetParam();
  return [isSort(search) ? search : 'hot', (sort) => setParam('sort', sort)];
}

export function SortTabs({ sort, onChange }: { sort: FeedSort; onChange: (sort: FeedSort) => void }): React.JSX.Element {
  return <Tabs label="Sort posts" value={sort} options={[...SORTS]} onChange={onChange} />;
}

export function HomePage(_props: Record<string, unknown>): React.JSX.Element {
  pageTitle('');
  const { user } = useSession();
  const [sort, setSort] = useSort();
  return (
    <div className="page-solo">
      <h1 className="sr-only">Home</h1>
      <SortTabs sort={sort} onChange={setSort} />
      <FeedList
        resetKey={`${sort}:${user?.id ?? ''}`} topics={['home']}
        load={(cursor) => get<FeedPage>(`/api/feed${query({ sort, cursor })}`)}
        empty={<Empty title={user ? 'Join a community to fill your home feed' : 'No posts yet'}>
          {user ? <p>Find a community on the communities page, join it, and its posts appear here.</p> : <p>Sign in to see posts from the communities you join.</p>}
        </Empty>}
      />
    </div>
  );
}
