import { useEffect, type ReactNode } from 'react';
import { ROLE_HOME, isStaffRole } from '../shared/roles';
import { NOT_FOUND_HEADING } from './copy';
import { matchRoute, navigate, useLocation } from './lib/router';
import { useSession } from './lib/session';
import { Shell } from './components/Shell';
import { BaysScreen } from './screens/Bays';
import { BoardScreen } from './screens/Board';
import { CarPageScreen } from './screens/CarPage';
import { JobPageScreen } from './screens/JobPage';
import { JobsScreen } from './screens/Jobs';
import {
  MyCarsScreen,
  PortalCarScreen,
  PortalInvoiceScreen,
  PortalJobScreen,
  PortalReleaseScreen,
  RequestReleaseScreen,
} from './screens/Portal';
import { ReleasesScreen } from './screens/Releases';
import { RoundScreen } from './screens/Round';
import { SignInScreen } from './screens/SignIn';
import { StaffScreen } from './screens/Staff';

const STAFF_PATHS = ['/bays', '/cars', '/round', '/jobs', '/releases', '/board', '/staff'];

function isPortalPath(path: string): boolean {
  return path === '/portal' || path.startsWith('/portal/');
}

function isStaffPath(path: string): boolean {
  return STAFF_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function App(): ReactNode {
  const { user, ready } = useSession();
  const location = useLocation();
  const path = location.path;
  const search = location.search;

  useEffect(() => {
    if (!ready) return;
    if (user === null) {
      if (path !== '/sign-in') {
        navigate(`/sign-in?next=${encodeURIComponent(`${path}${search}`)}`, { replace: true });
      }
      return;
    }
    if (path === '/sign-in' || path === '/') {
      navigate(ROLE_HOME[user.role], { replace: true });
      return;
    }
    // Shared job addresses always keep the query string.
    if (!isStaffRole(user.role)) {
      const jobMatch = matchRoute(path, '/jobs/:id');
      if (jobMatch !== null) {
        navigate(`/portal/jobs/${jobMatch.id ?? ''}${search}`, { replace: true });
        return;
      }
      if (isStaffPath(path)) {
        navigate('/portal', { replace: true });
      }
      return;
    }
    const portalJob = matchRoute(path, '/portal/jobs/:id');
    if (portalJob !== null) {
      navigate(`/jobs/${portalJob.id ?? ''}${search}`, { replace: true });
      return;
    }
    if (isPortalPath(path)) {
      navigate(ROLE_HOME[user.role], { replace: true });
    }
  }, [ready, user, path, search]);

  if (!ready) return null;
  if (user === null) {
    return path === '/sign-in' ? <SignInScreen /> : null;
  }

  return <Shell>{renderScreen(path)}</Shell>;
}

function renderScreen(path: string): ReactNode {
  if (path === '/bays') return <BaysScreen />;
  if (path === '/round') return <RoundScreen />;
  if (path === '/jobs') return <JobsScreen />;
  if (path === '/releases') return <ReleasesScreen />;
  if (path === '/board') return <BoardScreen />;
  if (path === '/staff') return <StaffScreen />;
  if (path === '/portal') return <MyCarsScreen />;

  const car = matchRoute(path, '/cars/:id');
  if (car !== null) return <CarPageScreen carId={car.id ?? ''} />;
  const job = matchRoute(path, '/jobs/:id');
  if (job !== null) return <JobPageScreen jobId={job.id ?? ''} />;
  const portalCar = matchRoute(path, '/portal/cars/:id');
  if (portalCar !== null) return <PortalCarScreen carId={portalCar.id ?? ''} />;
  const portalRelease = matchRoute(path, '/portal/cars/:id/release');
  if (portalRelease !== null) return <RequestReleaseScreen carId={portalRelease.id ?? ''} />;
  const portalJob = matchRoute(path, '/portal/jobs/:id');
  if (portalJob !== null) return <PortalJobScreen jobId={portalJob.id ?? ''} />;
  const portalInvoice = matchRoute(path, '/portal/invoices/:id');
  if (portalInvoice !== null) return <PortalInvoiceScreen invoiceId={portalInvoice.id ?? ''} />;
  const release = matchRoute(path, '/portal/releases/:id');
  if (release !== null) return <PortalReleaseScreen releaseId={release.id ?? ''} />;

  return <h1>{NOT_FOUND_HEADING}</h1>;
}
