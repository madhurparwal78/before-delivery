import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link } from "./components/Link";
import { SiteHeader } from "./components/SiteHeader";
import { Landing } from "./pages/Landing";
import { Invite, SignIn, SignUp, Verify } from "./pages/Auth";
import { Browser } from "./pages/Browser";
import { NotebookPage } from "./notebook/NotebookPage";
import { navigate, useLocation } from "./router";
import { useSession } from "./session";

function SignedIn({ children }: { children: ReactNode }): ReactNode {
  const { user } = useSession();
  const location = useLocation();
  useEffect(() => {
    if (user === null) navigate(`/signin?next=${encodeURIComponent(location)}`, true);
  }, [user, location]);
  return user ? children : <SiteHeader />;
}

export function App(): ReactNode {
  const location = useLocation();
  const path = location.split("?")[0] as string;
  const part = path.split("/").filter(Boolean);
  if (path === "/") return <Landing />;
  if (path === "/signin") return <SignIn />;
  if (path === "/signup") return <SignUp />;
  if (part[0] === "verify" && part[1]) return <Verify token={part[1]} />;
  if (part[0] === "invite" && part[1]) return <Invite token={part[1]} />;
  if (part[0] === "notebooks" && !part[1]) return <SignedIn><Browser /></SignedIn>;
  if (part[0] === "notebooks" && part[1]) return <SignedIn><NotebookPage key={part[1]} id={part[1]} /></SignedIn>;
  return (
    <>
      <SiteHeader />
      <main className="band"><div className="container"><h1>Page not found</h1><p><Link to="/">Back to Brackenpad</Link></p></div></main>
    </>
  );
}
