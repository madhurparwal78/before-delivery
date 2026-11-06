import { useRouteError, data, useLoaderData } from 'react-router';
import { RouteErrorBoundary } from '../components/ErrorPages.jsx';
import { MonthGrid, MarkLegend } from '../components/MonthGrid.jsx';
import { monthName } from '../../src/domain/time.js';

export async function loader({ params }) {
  const { loadShareMonth } = await import('../lib/data.server.js');
  const result = await loadShareMonth(params.token || '');
  if (result.kind === 'unknown') throw data(null, { status: 404 });
  if (result.kind === 'dead') throw data(null, { status: 410 });
  return { share: result };
}

export function ErrorBoundary() {
  return <RouteErrorBoundary error={useRouteError()} share />;
}

export default function SharedMonth() {
  const { share } = useLoaderData();
  const month = share.month;
  return (
    <>
      <header className="share-banner">
        <p className="brand">Rostara</p>
      </header>
      <main id="main" className="share-main">
        <h1>{share.name}, {monthName(month)} {month.slice(0, 4)}</h1>
        <MonthGrid month={month} days={share.days} />
        <MarkLegend />
      </main>
      <footer className="share-footer">
        Rostara attendance desk. Shared read-only.
      </footer>
    </>
  );
}
