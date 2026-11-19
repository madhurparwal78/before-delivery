import { useEffect } from "react";
import { useMessages } from "./lib/announce";
import { navigate, useLocation } from "./lib/router";
import { useMe } from "./lib/session";
import { SignIn, SignUp } from "./auth/Forms";
import { Invite } from "./auth/Invite";
import { Marketing } from "./marketing/Marketing";
import { NotFoundPage } from "./outline/NotFound";
import { OutlinePage } from "./outline/OutlinePage";
import { TopBar } from "./TopBar";

function Regions() {
  const messages = useMessages();
  return (
    <>
      <div role="status" aria-label="Announcements" aria-live="polite" className="sr-only">
        <span key={messages.statusNonce}>{messages.status}</span>
      </div>
      <div role="alert" aria-label="Problems" className="problems">
        {messages.alert !== "" && <span key={messages.alertNonce}>{messages.alert}</span>}
      </div>
    </>
  );
}

export function App() {
  const me = useMe();
  const location = useLocation();
  const [pathname, search = ""] = location.split("?") as [string, string?];

  const guest = me === null;
  const signedOutPrivate = guest && /^\/b\/[^/]+\/?$/.test(pathname);
  useEffect(() => {
    if (signedOutPrivate) navigate(`/signin?next=${encodeURIComponent(pathname.replace(/\/$/, ""))}`, { replace: true });
    if (!guest && (pathname === "/signin" || pathname === "/signup")) {
      const next = new URLSearchParams(search).get("next");
      navigate(next !== null && next.startsWith("/") ? next : "/", { replace: true });
    }
  }, [signedOutPrivate, guest, pathname, search]);

  let page;
  const bullet = /^\/b\/([^/]+)\/?$/.exec(pathname);
  const invite = /^\/invite\/([^/]+)\/?$/.exec(pathname);
  if (pathname === "/") page = guest ? <Marketing /> : <OutlinePage rootId={null} search={search} />;
  else if (pathname === "/signup") page = <SignUp />;
  else if (pathname === "/signin") page = <SignIn />;
  else if (bullet !== null && !guest) page = <OutlinePage rootId={decodeURIComponent(bullet[1] ?? "")} search={search} />;
  else if (invite !== null) page = <Invite token={decodeURIComponent(invite[1] ?? "")} />;
  else if (bullet !== null) page = null;
  else page = <NotFoundPage />;

  return (
    <>
      <TopBar marketing={guest && pathname === "/"} />
      <main>{page}</main>
      <Regions />
    </>
  );
}
