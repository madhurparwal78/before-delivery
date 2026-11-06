import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { encodeNext } from "../shared/next.ts";
import { readJson, request, sessionInfo, type SessionUser } from "./api.ts";
import { Editor } from "./editor/Editor.tsx";
import { useLocation } from "./router.ts";
import { Diagrams } from "./screens/Diagrams.tsx";
import { Invitation } from "./screens/Invitation.tsx";
import { NotFound } from "./screens/NotFound.tsx";
import { SignIn } from "./screens/SignIn.tsx";
import { SessionDialog } from "./SessionDialog.tsx";

/** Screens that need a session wait for it; a signed-out visit goes to sign-in with the address as `next`. */
function Protected({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(sessionInfo.user !== null);
  useEffect(() => {
    if (ready) return;
    void (async () => {
      const res = await request({ method: "GET", path: "/api/session" }, { allowUnauthenticated: true });
      if (res.ok) {
        sessionInfo.adopt(await readJson<{ user: SessionUser; csrfToken: string }>(res));
        setReady(true);
      } else {
        location.assign(`/signin?next=${encodeNext(location.pathname + location.search)}`);
      }
    })();
  }, [ready]);
  return ready ? <>{children}</> : null;
}

function App() {
  const { path, search } = useLocation();
  let screen: React.ReactNode;
  const editor = /^\/d\/([^/]+)(?:\/p\/([^/]+))?$/.exec(path);
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  if (path === "/signin") screen = <SignIn next={search.get("next")} />;
  else if (path === "/") screen = <Protected><Diagrams /></Protected>;
  else if (editor) screen = <Protected><Editor key={editor[1]} diagramId={decodeURIComponent(editor[1]!)} pageId={editor[2] ? decodeURIComponent(editor[2]) : null} /></Protected>;
  else if (path.startsWith("/d/")) screen = <Protected><NotFound kind="diagram" /></Protected>;
  else if (invite) screen = <Invitation token={decodeURIComponent(invite[1]!)} />;
  else screen = <NotFound kind="page" />;
  return (
    <>
      {screen}
      <SessionDialog />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
