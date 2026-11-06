import { useEffect, useRef, useState } from 'react';
import { LiveProvider, useLive } from './live.js';
import { hhmm, abbrOfOffset } from './time.js';
import { PlanPage } from './plan.js';
import { SchedulesPage } from './schedules.js';
import { ScenesPage } from './scenes.js';
import { GuestsPage } from './guests.js';
import { LogPage } from './log.js';
import { NoticesPage } from './notices.js';

const NAV = [
  ['/plan', 'Plan'],
  ['/schedules', 'Schedules'],
  ['/scenes', 'Scenes'],
  ['/guests', 'Guests'],
  ['/log', 'Day log'],
  ['/notices', 'Notices'],
] as const;

export function navigate(path: string): void {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function App(): JSX.Element {
  return (
    <LiveProvider>
      <Shell />
    </LiveProvider>
  );
}

function Shell(): JSX.Element {
  const live = useLive();
  const [route, setRoute] = useState(location.pathname);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuBtn = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onPop = (): void => setRoute(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const hubTime = live.status ? hhmm(live.status.now) : '';
  const abbr = live.status ? abbrOfOffset(live.status.offset) : '';

  const links = (
    <nav aria-label="Nightplan">
      <div className="brand">Gablework Nightplan</div>
      {NAV.map(([href, label]) => (
        <a key={href} href={href} className={location.pathname === href ? 'navlink current' : 'navlink'} onClick={(e) => { e.preventDefault(); navigate(href); setDrawerOpen(false); }}>{label}</a>
      ))}
    </nav>
  );

  return (
    <div className="shell">
      <header className="topbar">
        <button ref={menuBtn} className="menu-btn" onClick={() => setDrawerOpen(true)}>Menu</button>
        <div className="hubtime">Hub time {hubTime} {abbr}</div>
      </header>
      <aside className={drawerOpen ? 'rail rail-open' : 'rail'} aria-hidden={!drawerOpen}>
        <button className="rail-close" onClick={() => setDrawerOpen(false)}>Close menu</button>
        {links}
      </aside>
      {drawerOpen ? <div className="rail-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" /> : null}
      <main className={route === '/plan' ? 'main main-plan' : 'main'}>
        {route === '/plan' && <PlanPage />}
        {route === '/schedules' && <SchedulesPage />}
        {route === '/scenes' && <ScenesPage />}
        {route === '/guests' && <GuestsPage />}
        {route === '/log' && <LogPage />}
        {route === '/notices' && <NoticesPage />}
      </main>
      <LiveRegions />
      {live.status?.services.storage === 'down' ? (
        <div className="banner" role="alert">Clip storage is unreachable. New clips wait as 'Storing clip…' until it is back.</div>
      ) : null}
    </div>
  );
}

function LiveRegions(): JSX.Element {
  const live = useLive();
  return (
    <div className="live-regions">
      <div role="status" aria-live="polite" className="visually-hidden">Device updates: {live.deviceMsg}</div>
      <div role="status" aria-live="polite" className="visually-hidden">Scene changes: {live.sceneMsg}</div>
      <div role="status" aria-live="polite" className="visually-hidden">{live.connMsg}</div>
    </div>
  );
}
