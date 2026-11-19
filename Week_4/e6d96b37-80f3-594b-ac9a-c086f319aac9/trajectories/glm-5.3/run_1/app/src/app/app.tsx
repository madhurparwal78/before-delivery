import { useEffect, useState } from "react";
import { DeskProvider, getJson } from "./desk_context.js";
import type { SessionInfo } from "../shared/types.js";
import { DeskShell, type WorkspaceKey } from "./desk.js";
import { feedback } from "./feedback.js";
import { Router as HelpRouter } from "./help.js";

function initialWorkspace(): WorkspaceKey {
  const match = window.location.pathname.match(/^\/desk\/[^/]+\/([a-z-]+)/);
  if (match) {
    const value = match[1];
    if (value === "home") return "home";
    if (["intake", "attribution", "catalog-reconciliation", "tray-placement", "album", "condition", "keepers", "audit"].includes(value)) {
      return value as WorkspaceKey;
    }
    if (["offers", "counteroffers", "dispatch", "receipt", "disputes"].includes(value)) {
      return value as WorkspaceKey;
    }
  }
  return "home";
}

function namespaceOf(session: SessionInfo | null): string {
  const match = window.location.pathname.match(/^\/desk\/([a-z0-9-]+)/);
  if (match) return match[1];
  return session?.namespace || "hollowmint";
}

export function App(): React.ReactElement {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void getJson<SessionInfo>("/api/session")
      .then((info) => {
        setSession(info);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  if (!ready) {
    return <div className="desk-page"><p className="desk-status">Flan</p></div>;
  }

  const helpPath = window.location.pathname.startsWith("/help");
  if (helpPath) {
    return <HelpRouter />;
  }

  const namespace = namespaceOf(session);
  const role = session && session.role !== "outsider" && session.username ? (session.role as "dealer" | "counterpart" | "outsider") : "outsider";

  if (role === "outsider" || (session && session.namespace && session.namespace !== namespace)) {
    if (!session || !session.username) {
      // Not signed in: go to sign-in.
      window.location.href = `/auth/login?return_to=${encodeURIComponent(window.location.pathname)}`;
      return <div className="desk-page"><p>{feedback("F_SESSION")}</p></div>;
    }
  }

  return (
    <DeskProvider namespace={namespace} role={role === "outsider" ? "counterpart" : role}>
      <DeskShell namespace={namespace} role={role} initialWorkspace={initialWorkspace()} />
    </DeskProvider>
  );
}
