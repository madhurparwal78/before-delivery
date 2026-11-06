// Routes of the app shell: the notebook, device approval, invite acceptance and the operator console.
import { useApp } from "./store.ts";
import { Notebook } from "./Notebook.tsx";
import { ApprovalPage, InvitePage, OpsConsole } from "./pages.tsx";

export function App() {
  const app = useApp();
  const path = location.pathname;
  const approval = /^\/devices\/approve\/([^/]+)$/.exec(path);
  const invite = /^\/invites\/([^/]+)$/.exec(path);
  if (approval) return <ApprovalPage token={decodeURIComponent(approval[1])} />;
  if (invite) return <InvitePage token={decodeURIComponent(invite[1])} />;
  if (path === "/ops") return <OpsConsole />;
  return app.loaded ? <Notebook /> : <div className="booting" aria-busy="true" />;
}
