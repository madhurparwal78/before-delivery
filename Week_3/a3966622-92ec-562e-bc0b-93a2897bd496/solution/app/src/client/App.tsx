// Screens by path and role. Anonymous visitors go to /login; `/` goes to the user's role screen.
import { useEffect } from "react";
import type { Role } from "../shared/types";
import { navigate, useLocation } from "./router";
import { useSession } from "./session";
import { Accounts } from "./pages/Accounts";
import { Board } from "./pages/Board";
import { Login } from "./pages/Login";
import { MoveDetail } from "./pages/MoveDetail";
import { NotFound } from "./pages/NotFound";
import { Orders } from "./pages/Orders";
import { PilotScreen } from "./pages/Pilot";
import { InvoicePage, ReportPage } from "./pages/Records";

const LANDING: Record<Role, string> = { dispatcher: "/board", agent: "/orders", clerk: "/accounts", pilot: "/pilot" };

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to), [to]);
  return null;
}

export function App() {
  const { path } = useLocation();
  const { user, ready } = useSession();
  if (!ready) return null;
  if (path === "/login") return user ? <Redirect to={LANDING[user.role]} /> : <Login />;
  if (!user) return <Redirect to="/login" />;
  if (path === "/") return <Redirect to={LANDING[user.role]} />;

  const record = /^\/(moves|reports|invoices)\/([^/]+)$/.exec(path);
  if (record) {
    const id = decodeURIComponent(record[2] ?? "");
    if (record[1] === "moves") return <MoveDetail key={id} moveRef={id} />;
    if (record[1] === "reports") return <ReportPage key={id} id={id} />;
    return <InvoicePage key={id} id={id} />;
  }
  const screens: Record<string, { role: Role; screen: () => React.JSX.Element }> = {
    "/board": { role: "dispatcher", screen: Board },
    "/orders": { role: "agent", screen: Orders },
    "/accounts": { role: "clerk", screen: Accounts },
    "/pilot": { role: "pilot", screen: PilotScreen },
  };
  const match = screens[path];
  if (match && match.role === user.role) {
    const Screen = match.screen;
    return <Screen />;
  }
  return <NotFound />;
}
