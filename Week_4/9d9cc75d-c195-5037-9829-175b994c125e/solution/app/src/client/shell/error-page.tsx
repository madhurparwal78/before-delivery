import { ApiError } from '../api/client.ts';
import { EmptyState } from '../ui/empty-state.tsx';

/** The page an unknown id, a role that is too low, a rate limit or a server failure shows in place of the page. */
export function ErrorPage({ error }: { error: ApiError }) {
  if (error.status === 403) return <EmptyState level={1} sticker="sum" headline="You do not have access to this." />;
  if (error.status === 429) {
    return <EmptyState level={1} sticker="at" headline={`Too many requests. Try again in ${error.retryAfter ?? 1} seconds.`} />;
  }
  if (error.status >= 500) return <EmptyState level={1} sticker="pill" headline="Something went wrong. Try again." />;
  return <EmptyState level={1} headline="Not found." />;
}
