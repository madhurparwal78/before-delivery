// The browser entry: boot the session, route to a screen, and hold the live regions.

import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { SessionView, type Role } from "../shared/api";
import { matchScreen, type ScreenMatch } from "../shared/routes";
import { ApiFailure, getJson, watchSessionEnd } from "./api";
import {
  AccountScreen, MemberDrawScreen, MemberDrawsScreen, MemberHomeScreen, MemberMessagesScreen, MemberPlanScreen, MemberResultsScreen, MembershipScreen, RecordsScreen,
} from "./screensMember";
import { HomeScreen, JoinScreen, MarkersScreen, NotFoundScreen, PlansScreen, SignInScreen } from "./screensPublic";
import {
  CalendarScreen, CareMessagesScreen, MemberRecordScreen, MembersScreen, PlanPageScreen, RangesScreen, ReceiptPageScreen, ReceiptsScreen, ResultsToReleaseScreen, StaffBlendScreen,
  StaffDrawScreen, StaffPlanScreen, StaffResultsScreen, StaffThreadScreen, TeamScreen,
} from "./screensStaff";
import { navigate, sessionEnded, setSession, useAddress, useSession } from "./stores";
import { Announcements, useFocusKeeper } from "./ui";
import { VisitScreen } from "./visit";

const MEMBER: readonly Role[] = ["member"];
const ALL_STAFF: readonly Role[] = ["owner", "specialist", "coordinator", "billingLead"];
const CARE: readonly Role[] = ["owner", "specialist", "coordinator"];
const SPECIALISTS: readonly Role[] = ["owner", "specialist"];
const DESK: readonly Role[] = ["owner", "coordinator"];
const BILLING: readonly Role[] = ["owner", "billingLead"];
const OWNER: readonly Role[] = ["owner"];

const SCREEN_ROLES: Partial<Record<ScreenMatch["name"], readonly Role[]>> = {
  memberHome: MEMBER, membership: MEMBER, memberDraws: MEMBER, memberDraw: MEMBER, memberResults: MEMBER, memberPlan: MEMBER, memberMessages: MEMBER, records: MEMBER, account: MEMBER,
  receipt: [...BILLING, "member"],
  members: ALL_STAFF, memberRecord: ALL_STAFF,
  memberResultsStaff: CARE, memberPlanStaff: SPECIALISTS, planPage: SPECIALISTS, blend: SPECIALISTS, blendPage: SPECIALISTS, memberMessagesStaff: CARE,
  careMessages: CARE, calendar: DESK, staffDraw: CARE, resultsToRelease: SPECIALISTS, ranges: OWNER, receipts: BILLING, team: OWNER,
};

function Screen({ match, role }: { match: ScreenMatch; role: Role | null }) {
  const param = (name: string): string => match.params.get(name) ?? "";
  const notFound = () => <NotFoundScreen />;
  switch (match.name) {
    case "home": return <HomeScreen />;
    case "plans": return <PlansScreen />;
    case "markers": return <MarkersScreen />;
    case "join": return <JoinScreen />;
    case "signIn": return <SignInScreen />;
    case "memberHome": return <MemberHomeScreen />;
    case "membership": return <MembershipScreen />;
    case "memberDraws": return <MemberDrawsScreen />;
    case "memberDraw": return <MemberDrawScreen key={param("drawId")} drawId={param("drawId")} notFound={notFound} />;
    case "memberResults": return <MemberResultsScreen />;
    case "memberPlan": return <MemberPlanScreen />;
    case "memberMessages": return <MemberMessagesScreen />;
    case "records": return <RecordsScreen />;
    case "account": return <AccountScreen />;
    case "receipt": return <ReceiptPageScreen key={param("receiptId")} receiptId={param("receiptId")} memberView={role === "member"} />;
    case "members": return <MembersScreen />;
    case "memberRecord": return <MemberRecordScreen key={param("memberId")} memberId={param("memberId")} />;
    case "memberResultsStaff": return <StaffResultsScreen key={param("memberId")} memberId={param("memberId")} />;
    case "memberPlanStaff": return <StaffPlanScreen key={param("memberId")} memberId={param("memberId")} />;
    case "planPage": return <PlanPageScreen key={param("planId")} memberId={param("memberId")} planId={param("planId")} />;
    case "blend": return <StaffBlendScreen key={param("memberId")} memberId={param("memberId")} blendId={null} />;
    case "blendPage": return <StaffBlendScreen key={param("blendId")} memberId={param("memberId")} blendId={param("blendId")} />;
    case "memberMessagesStaff": return <StaffThreadScreen key={param("memberId")} memberId={param("memberId")} />;
    case "careMessages": return <CareMessagesScreen />;
    case "calendar": return <CalendarScreen />;
    case "staffDraw": return <StaffDrawScreen key={param("drawId")} drawId={param("drawId")} />;
    case "resultsToRelease": return <ResultsToReleaseScreen />;
    case "ranges": return <RangesScreen />;
    case "receipts": return <ReceiptsScreen />;
    case "team": return <TeamScreen />;
    case "visit": return <VisitScreen key={param("token")} token={param("token")} />;
  }
}

function isMemberOrStaffScreen(path: string): boolean {
  const match = matchScreen(path);
  return match !== null && SCREEN_ROLES[match.name] !== undefined;
}

function App() {
  const { path } = useAddress();
  const session = useSession();
  useFocusKeeper();

  useEffect(() => {
    // An old cookie on a public screen is simply signed out: there is nothing typed to keep and nothing to return to.
    let booting = true;
    watchSessionEnd(() => {
      if (!booting || isMemberOrStaffScreen(window.location.pathname)) {
        sessionEnded("Your session ended. Sign in again to keep going — what you typed is still here.");
      }
    });
    getJson("/api/session", SessionView).then(
      (view) => setSession({ kind: "live", view }),
      (error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        setSession({ kind: "none" });
      },
    ).finally(() => {
      booting = false;
    });
  }, []);

  const match = matchScreen(path);
  const roles = match ? SCREEN_ROLES[match.name] : undefined;
  const needsSignIn = roles !== undefined && session.kind === "none";

  useEffect(() => {
    if (needsSignIn) navigate("/signin", { replace: true });
  }, [needsSignIn]);

  const role = session.kind === "live" ? session.view.user.role : null;
  let content = match ? <Screen match={match} role={role} /> : <NotFoundScreen />;
  if (roles) {
    if (session.kind !== "live") content = <main className="page" />;
    else if (!roles.includes(session.view.user.role)) content = <NotFoundScreen />;
  }
  return (
    <>
      {content}
      <Announcements />
    </>
  );
}

const root = document.getElementById("app");
if (root) {
  createRoot(root).render(<App />);
}
