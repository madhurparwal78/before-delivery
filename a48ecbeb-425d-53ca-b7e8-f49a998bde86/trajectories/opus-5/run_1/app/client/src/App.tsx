import type { ReactNode } from 'react';
import { CartDrawer } from './components/CartDrawer.js';
import { FlyingTokens } from './components/FlyingTokens.js';
import { Header } from './components/Header.js';
import { Dashboard, Applications, Reviews, Search, Settings } from './office/OwnerPages.js';
import { OfficeShell } from './office/OfficeShell.js';
import { OrderDetail } from './office/OrderDetail.js';
import { Queue } from './office/Queue.js';
import { Stock } from './office/Stock.js';
import { Account } from './pages/Account.js';
import { SignIn, SignUp } from './pages/Auth.js';
import { Box } from './pages/Box.js';
import { Checkout } from './pages/Checkout.js';
import { Flavour } from './pages/Flavour.js';
import { Home } from './pages/Home.js';
import { NotFound } from './pages/NotFound.js';
import {
  CancelSubscription,
  PauseSubscription,
  Subscription,
  SwapSubscription,
  UpdateCard,
} from './pages/Subscription.js';
import { StockistApplication, StockistApply, Stockists } from './pages/Stockists.js';
import { ThankYou } from './pages/ThankYou.js';
import { matchPath, useRouter } from './router.js';

interface Screen {
  pattern: string;
  render: (params: Record<string, string>) => ReactNode;
  /** The staff roles that may open a back-office page. */
  office?: readonly UserRole[];
}

type UserRole = 'customer' | 'fulfilment' | 'support' | 'owner';

const FULFILMENT: readonly UserRole[] = ['fulfilment', 'support', 'owner'];
const OWNER: readonly UserRole[] = ['owner'];

const SCREENS: readonly Screen[] = [
  { pattern: '/', render: () => <Home /> },
  { pattern: '/box', render: () => <Box /> },
  { pattern: '/flavours/:slug', render: (params) => <Flavour slug={params.slug!} /> },
  { pattern: '/checkout', render: () => <Checkout /> },
  {
    pattern: '/orders/:number/thanks',
    render: (params) => <ThankYou orderNumber={params.number!} />,
  },
  { pattern: '/sign-in', render: () => <SignIn /> },
  { pattern: '/sign-up', render: () => <SignUp /> },
  { pattern: '/account', render: () => <Account /> },
  {
    pattern: '/account/subscriptions/:id',
    render: (params) => <Subscription id={params.id!} />,
  },
  {
    pattern: '/account/subscriptions/:id/pause',
    render: (params) => <PauseSubscription id={params.id!} />,
  },
  {
    pattern: '/account/subscriptions/:id/swap',
    render: (params) => <SwapSubscription id={params.id!} />,
  },
  {
    pattern: '/account/subscriptions/:id/cancel',
    render: (params) => <CancelSubscription id={params.id!} />,
  },
  {
    pattern: '/account/subscriptions/:id/card',
    render: (params) => <UpdateCard id={params.id!} />,
  },
  { pattern: '/stockists', render: () => <Stockists /> },
  { pattern: '/stockists/apply', render: () => <StockistApply /> },
  {
    pattern: '/stockists/applications/:id',
    render: (params) => <StockistApplication id={params.id!} />,
  },
  { pattern: '/office/queue', render: () => <Queue />, office: FULFILMENT },
  { pattern: '/office/stock', render: () => <Stock />, office: FULFILMENT },
  { pattern: '/office/search', render: () => <Search />, office: FULFILMENT },
  {
    pattern: '/office/orders/:number',
    render: (params) => <OrderDetail orderNumber={params.number!} />,
    office: FULFILMENT,
  },
  { pattern: '/office/dashboard', render: () => <Dashboard />, office: OWNER },
  { pattern: '/office/settings', render: () => <Settings />, office: OWNER },
  { pattern: '/office/applications', render: () => <Applications />, office: OWNER },
  { pattern: '/office/reviews', render: () => <Reviews />, office: OWNER },
];

export function App(): ReactNode {
  const { path } = useRouter();

  for (const screen of SCREENS) {
    const params = matchPath(screen.pattern, path);
    if (params === null) continue;
    if (screen.office !== undefined) {
      return <OfficeShell roles={screen.office}>{screen.render(params)}</OfficeShell>;
    }
    return (
      <>
        <a className="skip-link" href="#main">
          Skip to the crate
        </a>
        <Header />
        <main id="main">{screen.render(params)}</main>
        <CartDrawer />
        <FlyingTokens />
      </>
    );
  }

  if (path.startsWith('/office')) {
    return (
      <OfficeShell roles={FULFILMENT}>
        <NotFound />
      </OfficeShell>
    );
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to the crate
      </a>
      <Header />
      <main id="main">
        <NotFound />
      </main>
      <CartDrawer />
      <FlyingTokens />
    </>
  );
}
