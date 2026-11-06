import { useEffect } from 'react';
import { MainNav } from './components/MainNav.js';
import { AdminScreen } from './screens/Admin.js';
import { BoxOfficeScreen } from './screens/BoxOffice.js';
import { CurateScreen } from './screens/Curate.js';
import { FinanceScreen } from './screens/Finance.js';
import { GroupScreen } from './screens/Group.js';
import { OrderScreen } from './screens/Order.js';
import { ProgrammeScreen } from './screens/Programme.js';
import { RegisterScreen, SignInScreen } from './screens/Auth.js';
import { StudioScreen } from './screens/Studio.js';
import { TicketsScreen } from './screens/Tickets.js';
import { RouteContext, UserContext, useRouteState, useUserState } from './lib/store.js';
import type { JSX } from 'react';

export function App(): JSX.Element {
  const route = useRouteState();
  const user = useUserState();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.path]);

  return (
    <RouteContext.Provider value={route}>
      <UserContext.Provider value={user}>
        <MainNav />
        <main id="main">
          <Screen path={route.path} />
        </main>
      </UserContext.Provider>
    </RouteContext.Provider>
  );
}

function Screen(props: { path: string }): JSX.Element {
  const orderMatch = /^\/orders\/([^/]+)$/.exec(props.path);
  if (orderMatch !== null) return <OrderScreen orderId={orderMatch[1] as string} />;

  switch (props.path) {
    case '/':
      return <ProgrammeScreen />;
    case '/signin':
      return <SignInScreen />;
    case '/register':
      return <RegisterScreen />;
    case '/tickets':
      return <TicketsScreen />;
    case '/studio':
      return <StudioScreen />;
    case '/curate':
      return <CurateScreen />;
    case '/box-office':
      return <BoxOfficeScreen />;
    case '/finance':
      return <FinanceScreen />;
    case '/group':
      return <GroupScreen />;
    case '/admin':
      return <AdminScreen />;
    default:
      return (
        <section className="narrow ground-paper">
          <h1 className="display">Not found</h1>
          <p>That page isn&rsquo;t part of Kerf Frequencies.</p>
        </section>
      );
  }
}
