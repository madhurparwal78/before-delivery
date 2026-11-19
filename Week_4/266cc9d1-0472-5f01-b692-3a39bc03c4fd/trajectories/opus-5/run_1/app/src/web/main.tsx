import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./lib/api.js";
import { LiveRegions } from "./components/LiveRegions.jsx";
import { SignIn } from "./components/SignIn.jsx";
import { CorridorList } from "./components/CorridorList.jsx";
import { Workspace } from "./components/Workspace.jsx";
import { ReviewPage } from "./components/ReviewPage.jsx";
import type { Staff } from "./lib/types.js";
import "./styles.css";

function App(): ReactNode {
  const [path, setPath] = useState(window.location.pathname);
  const [staff, setStaff] = useState<Staff | null | undefined>(undefined);

  useEffect(() => {
    const onPopState = (): void => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const reviewMatch = /^\/review\/([^/]+)$/.exec(path);

  useEffect(() => {
    if (reviewMatch) {
      setStaff(null);
      return;
    }
    void api<{ staff: Staff }>("GET", "/api/session")
      .then((result) => setStaff(result.staff))
      .catch(() => setStaff(null));
  }, [reviewMatch === null]);

  if (reviewMatch) return <ReviewPage token={reviewMatch[1]} />;
  if (staff === undefined) return null;

  if (staff === null) {
    return (
      <SignIn
        onSignedIn={(signedIn) => {
          setStaff(signedIn);
          window.history.pushState(null, "", "/corridors");
          setPath("/corridors");
        }}
      />
    );
  }

  const corridorMatch = /^\/corridors\/([^/]+)$/.exec(path);
  if (corridorMatch) {
    return (
      <Workspace
        corridorId={corridorMatch[1]}
        staff={staff}
        onSignOut={() => {
          void api("DELETE", "/api/session").then(() => {
            setStaff(null);
            window.history.pushState(null, "", "/");
            setPath("/");
          });
        }}
      />
    );
  }

  if (path === "/") {
    window.history.replaceState(null, "", "/corridors");
    setPath("/corridors");
    return null;
  }

  return <CorridorList />;
}

const host = document.getElementById("app");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <LiveRegions>
        <App />
      </LiveRegions>
    </StrictMode>,
  );
}
