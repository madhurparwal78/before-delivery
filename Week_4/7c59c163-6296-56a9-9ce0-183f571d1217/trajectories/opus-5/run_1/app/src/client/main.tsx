import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { COPY } from './copy.js';
import { get } from './api.js';
import { Sticker } from './components/Stickers.js';
import type { StickerKind } from './components/Stickers.js';
import { Home } from './screens/Home.js';
import { Markets } from './screens/Markets.js';
import { MarketDetail } from './screens/MarketDetail.js';
import { BalanceScreen } from './screens/Balance.js';
import { OrdersScreen, OrderDetail } from './screens/Orders.js';
import { StatementsScreen } from './screens/Statements.js';
import { ProfileScreen } from './screens/Profile.js';
import { BuilderScreen } from './screens/Builder.js';
import { AdminScreen } from './screens/Admin.js';
import { OwnerScreen } from './screens/Owner.js';
import { PlatformScreen } from './screens/Platform.js';
import { AcceptInvite } from './screens/AcceptInvite.js';
import type { Me } from './api.js';

declare global {
  interface Window {
    __PV_PAGE__?: 'app' | 'sign_in_error' | 'sign_in_unavailable';
  }
}

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

function CentrePage(props: {
  heading: string;
  body?: React.ReactNode;
  sticker: StickerKind;
}): React.JSX.Element {
  return (
    <main className="field field--slate centre-page">
      <h1>{props.heading}</h1>
      {props.body}
      <Sticker kind={props.sticker} size={150} className="hero__sticker hero__sticker--right" />
    </main>
  );
}

const SignInLink = (): React.JSX.Element => (
  <a className="pill" href="/auth/login">
    Sign in
  </a>
);

function App(): React.JSX.Element {
  const path = usePath();
  const initial = window.__PV_PAGE__ ?? 'app';
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    if (initial !== 'app') {
      setMe(null);
      return;
    }
    void get<Me>('/api/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, [initial]);

  if (initial === 'sign_in_error') {
    return (
      <CentrePage
        heading={COPY.signInExpiredHeading}
        body={
          <>
            <p>{COPY.signInExpiredBody}</p>
            <SignInLink />
          </>
        }
        sticker="envelope"
      />
    );
  }
  if (initial === 'sign_in_unavailable') {
    return <CentrePage heading={COPY.signInUnavailableHeading} sticker="envelope" />;
  }

  const invite = /^\/invites\/([^/]+)$/.exec(path);
  if (invite !== null) return <AcceptInvite token={invite[1] as string} />;

  if (me === undefined) {
    return (
      <main className="field field--slate">
        <div className="wrap">
          <div className="skeleton" />
        </div>
      </main>
    );
  }

  if (me === null) {
    if (path === '/') return <Home me={null} />;
    return <CentrePage heading={COPY.notFoundHeading} body={<SignInLink />} sticker="cube" />;
  }

  if (me.venue === null && !me.roles.includes('founder_operator')) {
    return <CentrePage heading={COPY.noVenueHeading} body={<p>{COPY.noVenueBody}</p>} sticker="coin" />;
  }

  const market = /^\/markets\/([^/]+)$/.exec(path);
  if (market !== null) return <MarketDetail me={me} marketId={market[1] as string} />;
  const order = /^\/orders\/([^/]+)$/.exec(path);
  if (order !== null) return <OrderDetail me={me} orderId={order[1] as string} />;

  switch (path) {
    case '/':
      return <Home me={me} />;
    case '/markets':
      return <Markets me={me} />;
    case '/balance':
      return <BalanceScreen me={me} />;
    case '/orders':
      return <OrdersScreen me={me} />;
    case '/statements':
      return <StatementsScreen me={me} />;
    case '/profile':
      return <ProfileScreen me={me} />;
    case '/builder':
      return <BuilderScreen me={me} />;
    case '/admin':
      return <AdminScreen me={me} />;
    case '/owner':
      return <OwnerScreen me={me} />;
    case '/platform':
      return <PlatformScreen me={me} />;
    default:
      return <CentrePage heading={COPY.notFoundHeading} sticker="cube" />;
  }
}

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
