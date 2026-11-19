import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { can } from '../../shared/domain';
import { Announcements } from './lib/announce';
import { onSessionEnded } from './lib/api';
import { EnvProvider, useEnv } from './lib/env';
import { connectLive, disconnectLive } from './lib/live';
import { RouterProvider, useRouter } from './lib/router';
import { Shell } from './components/Shell';
import { Forbidden, NotFound } from './screens/Pages';
import { Login, Invite } from './screens/Access';
import { Today } from './screens/Today';
import { Ward } from './screens/Ward';
import { Patients, PatientRecord } from './screens/Patients';
import { Consult } from './screens/Consult';
import { InvoiceDetail, Invoices } from './screens/Invoices';
import { Stock } from './screens/Stock';
import { Staff } from './screens/Staff';
import { Booking, Confirmation } from './screens/Booking';

function Routes() {
  const { path, search, navigate } = useRouter();
  const { me, reloadMe } = useEnv();

  const publicBooking = /^\/book\/([^/]+)\/?$/.exec(path);
  const confirmation = /^\/book\/([^/]+)\/confirmation\/([^/]+)\/?$/.exec(path);
  const invite = /^\/invite\/([^/]+)\/?$/.exec(path);
  const isPublic = path === '/login' || invite !== null || publicBooking !== null || confirmation !== null;

  useEffect(() => {
    onSessionEnded(() => {
      disconnectLive();
      void reloadMe();
    });
  }, [reloadMe]);

  useEffect(() => {
    if (me) connectLive();
    else disconnectLive();
  }, [me]);

  useEffect(() => {
    if (me === null && !isPublic) navigate(`/login?next=${encodeURIComponent(path + search)}`, { replace: true });
  }, [me, isPublic, path, search, navigate]);

  if (path === '/login') return <Login />;
  if (invite) return <Invite token={invite[1]!} />;
  if (confirmation) return <Confirmation slug={confirmation[1]!} code={confirmation[2]!} />;
  if (publicBooking) return <Booking slug={publicBooking[1]!} />;
  if (!me) return null;

  const screen = (): ReactNode => {
    const patient = /^\/patients\/([^/]+)\/?$/.exec(path);
    const consult = /^\/consult\/([^/]+)\/?$/.exec(path);
    const invoice = /^\/invoices\/([^/]+)\/?$/.exec(path);
    if (path === '/' || path === '/today') return <Today />;
    if (path === '/ward') return <Ward />;
    if (path === '/patients') return <Patients />;
    if (patient) return <PatientRecord id={patient[1]!} />;
    if (consult) return <Consult id={consult[1]!} />;
    if (path === '/invoices') return can(me.role, 'invoices.read') ? <Invoices /> : <Forbidden />;
    if (invoice) return can(me.role, 'invoices.read') ? <InvoiceDetail id={invoice[1]!} /> : <Forbidden />;
    if (path === '/stock') return <Stock />;
    if (path === '/staff') return can(me.role, 'staff.manage') ? <Staff /> : <Forbidden />;
    return <NotFound />;
  };
  return <Shell>{screen()}</Shell>;
}

export function App() {
  return (
    <RouterProvider>
      <AppWithEnv />
    </RouterProvider>
  );
}

function AppWithEnv() {
  const { navigate, path, search } = useRouter();
  return (
    <EnvProvider
      onRemoved={() => {
        disconnectLive();
        navigate(`/login?next=${encodeURIComponent(path + search)}`);
      }}
    >
      <Routes />
      {createPortal(<Announcements />, document.getElementById('live-root')!)}
    </EnvProvider>
  );
}
