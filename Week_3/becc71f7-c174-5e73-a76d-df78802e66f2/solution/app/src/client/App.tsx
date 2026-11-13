// The route table: every published screen, and who may see it.
import { useEffect, useState, type ReactNode } from "react";
import type { SessionBody } from "../shared/api";
import type { Role } from "../shared/catalog";
import { api } from "./api";
import { navigate, rememberPlace, useAddress } from "./state";
import { Announcements, PublicBar, StaffBar } from "./ui/bars";
import { NotFound, Skeleton } from "./ui/kit";
import { Appointments, CancelAppointment, ConsignorPage, HoldPageScreen, SignIn } from "./screens/private";
import { PublicPiecePage, Rail } from "./screens/rail";
import { ImportScreen, PayoutRunScreen, PayoutsScreen, SalesBookScreen } from "./screens/staffBooks";
import { AppointmentsScreen, ConsignorScreen, ConsignorsScreen, HoldScreen, HoldsScreen, LadderScreen, MembersScreen } from "./screens/staffDesk";
import { PiecesScreen, SaleScreen, StaffPiecePage, TillScreen } from "./screens/staffPieces";

const DESK: readonly Role[] = ["owner", "assistant"];
const BOOKS: readonly Role[] = ["owner", "bookkeeper"];
const OWNER: readonly Role[] = ["owner"];
const ANY_STAFF: readonly Role[] = ["owner", "assistant", "bookkeeper"];

function staffScreen(pathname: string, role: Role): { roles: readonly Role[]; screen: ReactNode } | null {
  const [, , section, id, extra] = pathname.split("/");
  if (extra !== undefined) return null;
  switch (section) {
    case "pieces":
      return { roles: DESK, screen: id ? <StaffPiecePage id={id} role={role} /> : <PiecesScreen /> };
    case "till":
      return id ? null : { roles: DESK, screen: <TillScreen /> };
    case "sales":
      return id ? { roles: ANY_STAFF, screen: <SaleScreen id={id} role={role} /> } : null;
    case "holds":
      return { roles: DESK, screen: id ? <HoldScreen id={id} /> : <HoldsScreen /> };
    case "appointments":
      return id ? null : { roles: DESK, screen: <AppointmentsScreen /> };
    case "consignors":
      return { roles: DESK, screen: id ? <ConsignorScreen id={id} role={role} /> : <ConsignorsScreen /> };
    case "ladder":
      return id ? null : { roles: OWNER, screen: <LadderScreen /> };
    case "payouts":
      return { roles: BOOKS, screen: id ? <PayoutRunScreen month={id} /> : <PayoutsScreen role={role} /> };
    case "import":
      return id ? null : { roles: OWNER, screen: <ImportScreen /> };
    case "sales-book":
      return id ? null : { roles: BOOKS, screen: <SalesBookScreen /> };
    case "members":
      return id ? null : { roles: OWNER, screen: <MembersScreen /> };
    default:
      return null;
  }
}

function StaffArea({ pathname }: { pathname: string }) {
  const [session, setSession] = useState<SessionBody | null>(null);
  useEffect(() => {
    let current = true;
    api<SessionBody>("/api/session", { quiet: true }).then(
      (body) => {
        if (current) setSession(body);
      },
      () => {
        if (current) {
          rememberPlace();
          navigate("/sign-in", { replace: true });
        }
      },
    );
    return () => {
      current = false;
    };
  }, []);
  if (!session) {
    return (
      <main className="page">
        <Skeleton />
      </main>
    );
  }
  const match = staffScreen(pathname, session.member.role);
  return (
    <>
      <StaffBar member={session.member} />
      {match && match.roles.includes(session.member.role) ? <div key={pathname}>{match.screen}</div> : <NotFound />}
    </>
  );
}

function Screen({ pathname }: { pathname: string }) {
  if (pathname === "/") return <Rail />;
  if (pathname === "/sign-in") return <SignIn />;
  if (pathname === "/appointments") return <Appointments />;
  if (pathname.startsWith("/staff/")) return <StaffArea pathname={pathname} />;
  const [, section, id, token, extra] = pathname.split("/");
  if (section === "pieces" && id && !token) return <PublicPiecePage key={id} id={id} />;
  if (section === "h" && id && !token) return <HoldPageScreen key={id} token={id} />;
  if (section === "c" && id && !token) return <ConsignorPage key={id} token={id} />;
  if (section === "appointments" && id === "cancel" && token && !extra) return <CancelAppointment key={token} token={token} />;
  return (
    <>
      <PublicBar />
      <NotFound />
    </>
  );
}

export function App() {
  const { pathname } = useAddress();
  return (
    <>
      <Announcements />
      <div id="page">
        <Screen pathname={pathname} />
      </div>
    </>
  );
}
