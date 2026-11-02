import { useEffect, useState, type ReactNode, type ReactElement } from 'react';
import {
  NO_BACK_OFFICE_HEADING,
  SERVICE_ORDER,
  apiMessages,
  outageBannerCopy,
  type ServiceName,
} from '../../../shared/copy.js';
import { api, type ServiceStatuses } from '../api.js';
import { Link, useRouter } from '../router.js';
import { useShop } from '../state/shop.js';

const OFFICE_LINKS: ReadonlyArray<{ label: string; to: string; roles: readonly string[] }> = [
  { label: 'Paid orders', to: '/office/queue', roles: ['fulfilment', 'support', 'owner'] },
  { label: 'Stock', to: '/office/stock', roles: ['fulfilment', 'support', 'owner'] },
  { label: 'Search', to: '/office/search', roles: ['fulfilment', 'support', 'owner'] },
  { label: 'Dashboard', to: '/office/dashboard', roles: ['owner'] },
  { label: 'Settings', to: '/office/settings', roles: ['owner'] },
  { label: 'Applications', to: '/office/applications', roles: ['owner'] },
  { label: 'Reviews', to: '/office/reviews', roles: ['owner'] },
];

const STATUS_POLL_MS = 5_000;

function useServiceStatuses(): ServiceStatuses | null {
  const [statuses, setStatuses] = useState<ServiceStatuses | null>(null);
  useEffect(() => {
    const read = () => {
      void api
        .get<{ services: ServiceStatuses }>('/api/staff/status')
        .then((payload) => setStatuses(payload.services))
        .catch(() => setStatuses(null));
    };
    read();
    const timer = window.setInterval(read, STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, []);
  return statuses;
}

export function OfficeShell({
  roles,
  children,
}: {
  roles: readonly string[];
  children: ReactNode;
}): ReactElement {
  const { user, userLoaded } = useShop();
  const { navigate, path } = useRouter();
  const statuses = useServiceStatuses();
  const storeDown = statuses?.postgres === 'down';

  useEffect(() => {
    if (!userLoaded || storeDown === true) return;
    if (user === null) navigate(`/sign-in?next=${path}`, { replace: true });
  }, [navigate, path, storeDown, user, userLoaded]);

  const down: ServiceName[] =
    statuses === null ? [] : SERVICE_ORDER.filter((service) => statuses[service] === 'down');

  const isStaff = user !== null && user.role !== 'customer';

  /** A page only loads once the signed-in role is known to be allowed to see it. */
  const body = (): ReactNode => {
    if (!userLoaded) return null;
    if (user === null) return null;
    if (user.role === 'customer') return <h1>{NO_BACK_OFFICE_HEADING}</h1>;
    if (!roles.includes(user.role)) return <h1>{apiMessages.forbidden}</h1>;
    return children;
  };

  return (
    <div className="office">
      <div className="office__topbar">
        <Link to="/" className="wordmark wordmark--office">
          Ceibo
        </Link>
        {isStaff ? (
          <p className="office__who">
            <span>{user.name}</span>
            <span className="mono office__role">{user.role}</span>
          </p>
        ) : null}
        {isStaff ? (
          <nav aria-label="Back office">
            <ul>
              {OFFICE_LINKS.filter((link) => link.roles.includes(user.role)).map((link) => (
                <li key={link.to}>
                  <Link to={link.to} aria-current={path === link.to ? 'page' : undefined}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>

      <div className="office__banners">
        {down.map((service) => (
          <p key={service} role="alert" className="notice notice--warn">
            {outageBannerCopy[service]}
          </p>
        ))}
      </div>

      <div className="office__page">{body()}</div>
    </div>
  );
}
