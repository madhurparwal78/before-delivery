import type { ReactNode } from 'react';
import { Shell } from './components/Shell';
import { Announcer } from './lib/announce';
import { Router, useRouter } from './lib/router';
import { MyTickets } from './pages/MyTickets';
import { NotFound } from './pages/NotFound';
import { OfferPage } from './pages/OfferPage';
import { OwnerDashboard } from './pages/owner/Dashboard';
import { OwnerOrders } from './pages/owner/Orders';
import { OwnerOutbox } from './pages/owner/Outbox';
import { OwnerPublish } from './pages/owner/Publish';
import { Programme } from './pages/Programme';
import { SeatMapPage } from './pages/SeatMapPage';

function Page(): ReactNode {
  const { pathname } = useRouter();
  const parts = pathname.split('/').filter((part) => part !== '');

  if (parts.length === 0) return <Programme />;
  if (parts.length === 2 && parts[0] === 'p') return <SeatMapPage performanceId={parts[1] ?? ''} />;
  if (parts.length === 1 && parts[0] === 'tickets') return <MyTickets />;
  if (parts.length === 2 && parts[0] === 'offers') return <OfferPage token={parts[1] ?? ''} />;
  if (parts[0] === 'owner') {
    if (parts.length === 1) return <OwnerDashboard />;
    if (parts.length === 2 && parts[1] === 'new') return <OwnerPublish />;
    if (parts.length === 2 && parts[1] === 'orders') return <OwnerOrders />;
    if (parts.length === 2 && parts[1] === 'outbox') return <OwnerOutbox />;
  }
  return <NotFound />;
}

export function App(): ReactNode {
  return (
    <Announcer>
      <Router>
        <Shell>
          <Page />
        </Shell>
      </Router>
    </Announcer>
  );
}
