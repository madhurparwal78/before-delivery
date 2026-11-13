import { useEffect, useState, type ReactNode } from "react";
import type { Allowance, Person } from "../shared/types";
import { api, ApiError } from "./lib/api";
import { LiveSocket } from "./lib/live";
import { navigate, useLocation } from "./lib/router";
import { notify, setBanner, clearNotices } from "./lib/notices";
import { allowanceStore, refreshProjects, ShellContext, type SessionInfo } from "./lib/session";
import { Library } from "./pages/Library";
import { NotFound } from "./pages/NotFound";
import { Profile } from "./pages/Profile";
import { ProjectList } from "./pages/ProjectList";
import { ProjectPage } from "./pages/ProjectPage";
import { Review } from "./pages/Review";
import { SignIn } from "./pages/SignIn";
import { errorCopy } from "../shared/copy";

function Shell({ children }: { children: ReactNode }): ReactNode {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [socket] = useState(() => new LiveSocket());

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [me, allowance] = await Promise.all([
          api.get<{ person: Person; is_owner: boolean }>("/api/session"),
          api.get<Allowance>("/api/allowance"),
        ]);
        if (!alive) return;
        allowanceStore.set(allowance);
        // everything the band shows is in hand before the first paint, so nothing below it moves
        await Promise.all([refreshProjects().catch(() => undefined), me.is_owner ? loadBanners() : Promise.resolve()]);
        if (!alive) return;
        setSession({ person: me.person, isOwner: me.is_owner });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) navigate("/sign-in", true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const offMessage = socket.onMessage((message) => {
      if (message.type === "allowance") allowanceStore.set(message.allowance);
    });
    const offClose = socket.onClose((code) => {
      if (code === 4401) {
        clearNotices();
        notify("You were signed out.");
        navigate("/sign-in", true);
      }
    });
    socket.connect();
    return () => {
      offMessage();
      offClose();
      socket.close();
    };
  }, [socket]);

  if (!session) return <div className="boot" aria-busy="true" />;
  return <ShellContext.Provider value={{ session, socket }}>{children}</ShellContext.Provider>;
}

async function loadBanners(): Promise<void> {
  try {
    const status = await api.get<{ storage: string; queue: string; mail: string }>("/api/status");
    setBanner("storage", status.storage === "down" ? errorCopy("storage_unavailable") : null);
    setBanner("queue", status.queue === "down" ? errorCopy("queue_unavailable") : null);
    if (status.mail === "down") {
      const outbox = await api.get<{ items: { state: string }[] }>("/api/outbox");
      const waiting = outbox.items.filter((item) => item.state === "waiting").length;
      setBanner("mail", `Mail is waiting in the outbox: ${waiting} messages.`);
    } else {
      setBanner("mail", null);
    }
  } catch {
    // the strip keeps whatever it already shows
  }
}

export function App(): ReactNode {
  const location = useLocation();
  const path = location.split("?")[0] ?? "/";
  if (path === "/sign-in") return <SignIn />;
  const review = /^\/review\/([^/]+)$/.exec(path);
  if (review) return <Review token={review[1] ?? ""} />;
  const project = /^\/projects\/([^/]+)$/.exec(path);
  let page: ReactNode;
  if (path === "/") page = <ProjectList />;
  else if (path === "/library") page = <Library />;
  else if (path === "/profile") page = <Profile />;
  else if (project) page = <ProjectPage key={project[1]} projectId={project[1] ?? ""} />;
  else return <NotFound />;
  return <Shell>{page}</Shell>;
}
