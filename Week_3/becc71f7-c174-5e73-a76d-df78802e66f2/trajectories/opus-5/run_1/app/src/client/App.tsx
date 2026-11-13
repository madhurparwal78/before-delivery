import { useEffect, useRef, useState } from 'preact/hooks';
import { matchScreenRoute, type ScreenRoute } from '../shared/routes.js';
import { copy } from '../shared/copy.js';
import type { Role } from '../shared/options.js';
import { SESSION_ENDED_EVENT, get } from './lib/api.js';
import { announce, useAnnouncement } from './lib/announce.js';
import { hrefOf, useLocation } from './lib/router.js';
import { rememberForSignIn } from './lib/resume.js';
import type { Session } from './lib/types.js';
import { Link } from './components/layout.js';

import { RailScreen } from './screens/RailScreen.js';
import { PublicPieceScreen } from './screens/PublicPieceScreen.js';
import { HoldPageScreen } from './screens/HoldPageScreen.js';
import { PortalScreen } from './screens/PortalScreen.js';
import { AppointmentsScreen } from './screens/AppointmentsScreen.js';
import { CancelAppointmentScreen } from './screens/CancelAppointmentScreen.js';
import { SignInScreen } from './screens/SignInScreen.js';
import { PiecesScreen } from './screens/PiecesScreen.js';
import { StaffPieceScreen } from './screens/StaffPieceScreen.js';
import { TillScreen } from './screens/TillScreen.js';
import { SaleScreen } from './screens/SaleScreen.js';
import { HoldsScreen } from './screens/HoldsScreen.js';
import { HoldScreen } from './screens/HoldScreen.js';
import { StaffAppointmentsScreen } from './screens/StaffAppointmentsScreen.js';
import { ConsignorsScreen } from './screens/ConsignorsScreen.js';
import { ConsignorScreen } from './screens/ConsignorScreen.js';
import { LadderScreen } from './screens/LadderScreen.js';
import { PayoutsScreen } from './screens/PayoutsScreen.js';
import { PayoutRunScreen } from './screens/PayoutRunScreen.js';
import { ImportScreen } from './screens/ImportScreen.js';
import { SalesBookScreen } from './screens/SalesBookScreen.js';
import { MembersScreen } from './screens/MembersScreen.js';
import { NotFoundScreen } from './screens/NotFoundScreen.js';

/** Every staff role sees only the screens it may use. */
const STAFF_ROLES: Partial<Record<ScreenRoute, readonly Role[]>> = {
  '/staff/pieces': ['owner', 'assistant'],
  '/staff/pieces/:pieceId': ['owner', 'assistant'],
  '/staff/till': ['owner', 'assistant'],
  '/staff/sales/:saleId': ['owner', 'assistant', 'bookkeeper'],
  '/staff/holds': ['owner', 'assistant'],
  '/staff/holds/:holdId': ['owner', 'assistant'],
  '/staff/appointments': ['owner', 'assistant'],
  '/staff/consignors': ['owner', 'assistant'],
  '/staff/consignors/:consignorId': ['owner', 'assistant'],
  '/staff/ladder': ['owner'],
  '/staff/payouts': ['owner', 'bookkeeper'],
  '/staff/payouts/:month': ['owner', 'bookkeeper'],
  '/staff/import': ['owner'],
  '/staff/sales-book': ['owner', 'bookkeeper'],
  '/staff/members': ['owner'],
};

export function App() {
  const location = useLocation();
  const announcement = useAnnouncement();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Only a member who was signed in can have a session end under them; a shopper on the
  // rail has none to lose.
  const signedIn = useRef<Session | null | undefined>(undefined);
  signedIn.current = session;

  useEffect(() => {
    get<Session>('/api/session')
      .then((value) => setSession(value))
      .catch(() => setSession(null));
  }, []);

  useEffect(() => {
    // The screen and its open dialog stay exactly as they are; only the live region
    // changes, with the link that brings the member back here.
    const onSessionEnded = (): void => {
      if (signedIn.current === null || signedIn.current === undefined) return;
      rememberForSignIn(
        hrefOf({ pathname: window.location.pathname, search: window.location.search }),
      );
      announce(copy.sessionEnded, true);
    };
    window.addEventListener(SESSION_ENDED_EVENT, onSessionEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onSessionEnded);
  }, []);

  // SR6: a control that receives focus is scrolled fully into view between the bars.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target === null || typeof target.scrollIntoView !== 'function') return;
      if (target.closest('.overlay') !== null) return;
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  const match = matchScreenRoute(location.pathname);

  return (
    <>
      <div class="live-region" role="status" aria-label="Announcements">
        {announcement === null ? null : (
          <>
            <span>{announcement.text}</span>
            {announcement.withSignIn ? (
              <>
                {' '}
                <Link href="/sign-in">{copy.signInAgain}</Link>
              </>
            ) : null}
          </>
        )}
      </div>
      {renderScreen(match, location.search, session, setSession)}
    </>
  );
}

function renderScreen(
  match: ReturnType<typeof matchScreenRoute>,
  search: string,
  session: Session | null | undefined,
  setSession: (session: Session | null) => void,
) {
  if (match === null) return <NotFoundScreen />;
  const { pattern, params } = match;
  const allowed = STAFF_ROLES[pattern];

  if (allowed !== undefined) {
    if (session === undefined) return <div class="screen screen--loading" />;
    if (session === null) return <SignInScreen onSignedIn={setSession} />;
    if (!allowed.includes(session.member.role)) return <NotFoundScreen />;
  }

  switch (pattern) {
    case '/':
      return <RailScreen search={search} />;
    case '/pieces/:pieceId':
      return <PublicPieceScreen pieceId={params['pieceId'] as string} />;
    case '/h/:token':
      return <HoldPageScreen token={params['token'] as string} />;
    case '/c/:token':
      return <PortalScreen token={params['token'] as string} />;
    case '/appointments':
      return <AppointmentsScreen search={search} />;
    case '/appointments/cancel/:token':
      return <CancelAppointmentScreen token={params['token'] as string} />;
    case '/sign-in':
      return <SignInScreen onSignedIn={setSession} />;
    case '/staff/pieces':
      return <PiecesScreen session={session as Session} search={search} />;
    case '/staff/pieces/:pieceId':
      return <StaffPieceScreen session={session as Session} pieceId={params['pieceId'] as string} />;
    case '/staff/till':
      return <TillScreen session={session as Session} />;
    case '/staff/sales/:saleId':
      return <SaleScreen session={session as Session} saleId={params['saleId'] as string} />;
    case '/staff/holds':
      return <HoldsScreen session={session as Session} />;
    case '/staff/holds/:holdId':
      return <HoldScreen session={session as Session} holdId={params['holdId'] as string} />;
    case '/staff/appointments':
      return <StaffAppointmentsScreen session={session as Session} />;
    case '/staff/consignors':
      return <ConsignorsScreen session={session as Session} />;
    case '/staff/consignors/:consignorId':
      return (
        <ConsignorScreen
          session={session as Session}
          consignorId={params['consignorId'] as string}
        />
      );
    case '/staff/ladder':
      return <LadderScreen session={session as Session} />;
    case '/staff/payouts':
      return <PayoutsScreen session={session as Session} />;
    case '/staff/payouts/:month':
      return <PayoutRunScreen session={session as Session} month={params['month'] as string} />;
    case '/staff/import':
      return <ImportScreen session={session as Session} />;
    case '/staff/sales-book':
      return <SalesBookScreen session={session as Session} search={search} />;
    case '/staff/members':
      return <MembersScreen session={session as Session} />;
  }
}
