import { Link, Links, Meta, Outlet, Scripts, useLocation, useMatches, redirect } from 'react-router';
import styles from './styles.css?url';
import { ChevronIcon } from './components/icons.jsx';
import { SignOutButton } from './components/SignOutButton.jsx';
import { LiveRegions } from './components/LiveRegions.jsx';
import { isShareRoute, isDeskRoute, isSafeNext, encodeNext } from './lib/next.jsx';

export const links = () => [{ rel: 'stylesheet', href: styles }];

export async function loader({ request }) {
  const { resolveViewer } = await import('./lib/data.server.js');
  const url = new URL(request.url);
  const pathname = url.pathname;

  // The shared month needs no session and never redirects.
  if (isShareRoute(pathname)) return { viewer: null, policyVersion: null };

  const resolved = await resolveViewer({ cookies: parseCookies(request), headers: request.headers });

  if (pathname === '/login') {
    if (resolved.state === 'ok') {
      const next = url.searchParams.get('next');
      const target = isSafeNext(next) ? next : '/requests';
      throw redirect(target, 303);
    }
    return { viewer: null, policyVersion: null };
  }

  if (pathname === '/') {
    throw redirect(resolved.state === 'ok' ? '/requests' : '/login', 303);
  }

  if (resolved.state !== 'ok') {
    if (isDeskRoute(pathname)) {
      const requested = request.url.replace(/^[a-z]+:\/\/[^/]+/, '');
      throw redirect(`/login?next=${encodeNext(requested)}`, 303);
    }
    // a signed-out request for an unknown path answers 404, not a redirect
    return { viewer: null, policyVersion: null };
  }

  const { loadPolicyVersion } = await import('./lib/data.server.js');
  return {
    viewer: resolved.viewer,
    policyVersion: await loadPolicyVersion(),
  };
}

function parseCookies(request) {
  const out = {};
  const header = request.headers.get('cookie');
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function initials(name) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function Breadcrumbs({ queueQuery }) {
  const matches = useMatches();
  const crumbs = [{ label: 'Desk', to: queueQuery ? `/requests?${queueQuery}` : '/requests' }];
  const last = [...matches].reverse().find((m) => m.data?.crumb || m.handle?.crumb);
  const crumb = last?.data?.crumb ?? last?.handle?.crumb;
  if (crumb) crumbs.push({ label: crumb });
  if (crumbs.length === 1) crumbs.push({ label: 'Regularisation requests' });
  // returning to the queue through Desk puts focus back on the row it came from
  const focusRow = last?.data?.detail?.request?.id;
  return (
    <nav aria-label="Breadcrumb" id="breadcrumb">
      <ol>
        {crumbs.map((c, i) => (
          <li key={i}>
            {i > 0 && <ChevronIcon aria-hidden="true" />}
            {c.to ? (
              <Link to={c.to} state={focusRow ? { focusRow } : undefined}>{c.label}</Link>
            ) : (
              <span aria-current="page">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Layout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  const location = useLocation();
  const matches = useMatches();
  const shared = location.pathname.startsWith('/share/');
  const data = [...matches].reverse().find((m) => m.data)?.data || {};
  const viewer = data.viewer;
  const policyVersion = data.policyVersion;
  const queueQuery = data.queueQuery;
  const roleLine = viewer?.role === 'admin' ? 'People operations'
    : viewer ? (viewer.role === 'manager' ? 'Manager' : 'Employee') : null;

  if (shared) {
    return <Outlet />;
  }

  return (
    <>
      <header id="banner">
        <a className="brand" href="/requests">Rostara</a>
        {viewer && <Breadcrumbs queueQuery={queueQuery} />}
        {viewer && (
          <div className="banner-right">
            <span className="who">
              <span className="initials" aria-hidden="true">{initials(viewer.name)}</span>
              <span className="who-lines">
                <span className="who-name">{viewer.name}</span>
                <span className="role-line">{roleLine}</span>
              </span>
            </span>
            <SignOutButton />
          </div>
        )}
      </header>
      <main id="main">
        <Outlet />
      </main>
      <footer id="contentinfo">
        Rostara attendance desk. Policy version {policyVersion ?? '1'}.
      </footer>
      <LiveRegions />
    </>
  );
}
