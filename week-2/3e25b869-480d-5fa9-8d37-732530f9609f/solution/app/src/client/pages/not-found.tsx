// Not found: unknown pages and records that are not yours look the same.
import { useCopy } from '../state';
import { EmptyState } from '../ui';

export function NotFoundPage() {
  const { m } = useCopy();
  return (
    <div class="page narrow">
      <h1 tabIndex={-1}>{m.notFound}</h1>
      <EmptyState>{m.notFoundLine}</EmptyState>
      <p>
        <a class="button secondary" href="/">
          {m.notFoundLink}
        </a>
      </p>
    </div>
  );
}
