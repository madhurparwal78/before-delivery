import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AnnounceProvider,
  Announcements,
  RouterProvider,
  SessionProvider,
  useRouter,
  useSession,
} from './app/shell';
import { PublicHeader, HomeScreen, JoinScreen, MarkersScreen, NotFoundScreen, PlansScreen, SignInScreen } from './screens/public';
import {
  MemberAccountScreen,
  MemberDrawScreen,
  MemberDrawsScreen,
  MemberHomeScreen,
  MemberMessagesScreen,
  MemberNav,
  MemberPlanScreen,
  MemberRecordsScreen,
  MemberResultsScreen,
  MembershipScreen,
} from './screens/member';
import {
  StaffCalendarScreen,
  StaffDrawScreen,
  StaffMemberMessagesScreen,
  StaffMemberScreen,
  StaffMembersScreen,
  StaffRangesScreen,
  StaffReceiptsScreen,
  StaffResultsToReleaseScreen,
  StaffTeamScreen,
  StaffThreadsScreen,
} from './screens/staff';
import { DeskNav } from './screens/staffPieces';
import { StaffMemberResultsScreen } from './screens/staffResults';
import { StaffPlanScreen, StaffPlanVersionScreen } from './screens/plan';
import { BlendBuilderScreen } from './screens/blend';
import { VisitScreen } from './screens/visit';
import { ReceiptScreen } from './screens/receipt';

function Screen(): JSX.Element {
  const { match, path } = useRouter();
  const { user } = useSession();
  const params = match?.params ?? {};
  switch (match?.pattern) {
    case '/':
      return <HomeScreen />;
    case '/plans':
      return <PlansScreen />;
    case '/markers':
      return <MarkersScreen />;
    case '/join':
      return <JoinScreen />;
    case '/signin':
      return <SignInScreen />;
    case '/me':
      return <MemberHomeScreen />;
    case '/me/membership':
      return <MembershipScreen />;
    case '/me/draws':
      return <MemberDrawsScreen />;
    case '/me/draws/:drawId':
      return <MemberDrawScreen drawId={params.drawId as string} />;
    case '/me/results':
      return <MemberResultsScreen />;
    case '/me/plan':
      return <MemberPlanScreen />;
    case '/me/messages':
      return <MemberMessagesScreen />;
    case '/me/records':
      return <MemberRecordsScreen />;
    case '/me/account':
      return <MemberAccountScreen />;
    case '/receipts/:receiptId':
      return <ReceiptScreen receiptId={params.receiptId as string} />;
    case '/staff/members':
      return <StaffMembersScreen />;
    case '/staff/members/:memberId':
      return <StaffMemberScreen memberId={params.memberId as string} />;
    case '/staff/members/:memberId/results':
      return <StaffMemberResultsScreen memberId={params.memberId as string} />;
    case '/staff/members/:memberId/plan':
      return <StaffPlanScreen memberId={params.memberId as string} />;
    case '/staff/members/:memberId/plans/:planId':
      return (
        <StaffPlanVersionScreen
          memberId={params.memberId as string}
          planId={params.planId as string}
        />
      );
    case '/staff/members/:memberId/blend':
      return <BlendBuilderScreen memberId={params.memberId as string} />;
    case '/staff/members/:memberId/blends/:blendId':
      return (
        <BlendBuilderScreen
          memberId={params.memberId as string}
          blendId={params.blendId as string}
        />
      );
    case '/staff/members/:memberId/messages':
      return <StaffMemberMessagesScreen memberId={params.memberId as string} />;
    case '/staff/messages':
      return <StaffThreadsScreen />;
    case '/staff/calendar':
      return <StaffCalendarScreen />;
    case '/staff/draws/:drawId':
      return <StaffDrawScreen drawId={params.drawId as string} />;
    case '/staff/results':
      return <StaffResultsToReleaseScreen />;
    case '/staff/ranges':
      return <StaffRangesScreen />;
    case '/staff/receipts':
      return <StaffReceiptsScreen />;
    case '/staff/team':
      return <StaffTeamScreen />;
    case '/visit/:token':
      return <VisitScreen token={params.token as string} />;
    default:
      return <NotFoundScreen key={`${path}-${user?.id ?? 'anon'}`} />;
  }
}

function Chrome(): JSX.Element {
  const { match } = useRouter();
  const { user } = useSession();
  const pattern = match?.pattern;
  const isVisit = pattern === '/visit/:token';
  const isMember =
    pattern !== undefined && (pattern.startsWith('/me') || pattern === '/receipts/:receiptId');
  const isStaff = pattern !== undefined && pattern.startsWith('/staff');

  const header = ((): JSX.Element | null => {
    if (isVisit) return null;
    if (isStaff) return <DeskNav />;
    if (isMember && user?.role === 'member') return <MemberNav />;
    if (isMember && user) return <DeskNav />;
    return <PublicHeader />;
  })();

  return (
    <div className={`app${isVisit ? ' visit-page' : ''}`}>
      {header}
      <main>
        <Announcements />
        <Screen />
      </main>
    </div>
  );
}

function App(): JSX.Element {
  return (
    <RouterProvider>
      <SessionProvider>
        <AnnounceProvider>
          <Chrome />
        </AnnounceProvider>
      </SessionProvider>
    </RouterProvider>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
