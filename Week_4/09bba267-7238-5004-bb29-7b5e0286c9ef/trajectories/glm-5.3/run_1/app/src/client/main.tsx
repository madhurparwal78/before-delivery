import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts';
import { ProgrammePage } from './programme';
import { SeatMapPage } from './seatmap';
import { MyTicketsPage } from './tickets';
import { OfferPage } from './offer';
import { OwnerPage } from './owner';
import { TopBar, UpdatesRegion, usePath } from './shell';

function NotFoundPage() {
  return (
    <div className="page">
      <TopBar active={null} />
      <UpdatesRegion />
      <main className="content">
        <h1>We couldn't find that page</h1>
      </main>
    </div>
  );
}

function App() {
  const path = usePath();
  if (path === '/' || path === '') {
    return <ProgrammePage />;
  }
  if (path === '/tickets') {
    return <MyTicketsPage />;
  }
  if (path === '/owner' || path === '/owner/new' || path === '/owner/orders' || path === '/owner/outbox') {
    return <OwnerPage path={path} />;
  }
  if (path.startsWith('/p/')) {
    return <SeatMapPage path={path} />;
  }
  const offerMatch = /^\/offers\/([^/?]+)/.exec(path);
  if (offerMatch) {
    return <OfferPage token={offerMatch[1]} />;
  }
  return <NotFoundPage />;
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
