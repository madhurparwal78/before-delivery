import { useEffect, type ReactNode } from "react";
import type { AccountKind } from "../shared/types";
import { matchPath, useRouter } from "./lib/router";
import { REMOVED_NOTICE_ID, useNotices } from "./lib/notices";
import { homePath, useSession } from "./lib/session";
import { useStreamEvent } from "./lib/stream";
import { Layout } from "./ui/Layout";
import Classroom from "./pages/Classroom";
import Dashboard from "./pages/Dashboard";
import EditorPage from "./pages/EditorPage";
import Join from "./pages/Join";
import Landing from "./pages/Landing";
import PersonalHome from "./pages/PersonalHome";
import Policy from "./pages/Policy";
import Signin from "./pages/Signin";
import Signup from "./pages/Signup";
import StudentHome from "./pages/StudentHome";
import Verify from "./pages/Verify";

const ALL: AccountKind[] = ["educator", "personal", "student"];

/** Signed-out visitors go to sign in; the wrong kind of account goes to its own home. */
function Guard({ kinds, children }: { kinds: AccountKind[]; children: ReactNode }) {
  const { account, loaded } = useSession();
  const { navigate } = useRouter();
  const allowed = account !== null && kinds.includes(account.kind);
  useEffect(() => {
    if (!loaded) return;
    if (!account) navigate("/signin", { replace: true });
    else if (!allowed) navigate(homePath(account), { replace: true });
  }, [loaded, account, allowed, navigate]);
  return allowed ? <>{children}</> : null;
}

function Routes(): { element: ReactNode; footer: boolean } {
  const { location } = useRouter();
  const path = location.path;
  const classroom = matchPath("/classrooms/:id", path);
  const editor = matchPath("/editor/:id", path);
  if (path === "/") return { element: <Landing />, footer: true };
  if (path === "/signup") return { element: <Signup />, footer: true };
  if (path === "/signin") return { element: <Signin />, footer: true };
  if (path === "/verify") return { element: <Verify />, footer: true };
  if (path === "/join") return { element: <Join />, footer: true };
  if (path === "/privacy" || path === "/terms" || path === "/student-data") return { element: <Policy />, footer: true };
  if (path === "/dashboard") return { element: <Guard kinds={["educator"]}><Dashboard /></Guard>, footer: true };
  if (classroom) return { element: <Guard kinds={["educator"]}><Classroom id={classroom.id ?? ""} /></Guard>, footer: true };
  if (path === "/class") return { element: <Guard kinds={["student"]}><StudentHome /></Guard>, footer: true };
  if (path === "/projects") return { element: <Guard kinds={["personal"]}><PersonalHome /></Guard>, footer: true };
  if (editor) return { element: <Guard kinds={ALL}><EditorPage /></Guard>, footer: false };
  return { element: <div className="column section"><h1>Not found.</h1></div>, footer: true };
}

export function App() {
  const { account, pendingJoin, loaded } = useSession();
  const { location, navigate } = useRouter();
  const { setNotice } = useNotices();
  useStreamEvent("access-ended", (event) => setNotice({ id: REMOVED_NOTICE_ID, message: event.message }));
  useEffect(() => {
    if (loaded && pendingJoin && !account && location.path !== "/join") navigate("/join", { replace: true });
  }, [loaded, pendingJoin, account, location.path, navigate]);
  const { element, footer } = Routes();
  return <Layout footer={footer && loaded}>{loaded ? element : null}</Layout>;
}
