// The four screens: sign-in, corridor list, corridor workspace and review page.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type Staff } from "./api";
import { CorridorListPage } from "./pages/CorridorList";
import { ReviewPage } from "./pages/Review";
import { SignInPage } from "./pages/SignIn";
import { WorkspacePage } from "./pages/Workspace";
import { navigate, onNavigate } from "./router";
import "./styles.css";

type Session = { state: "checking" } | { state: "signed-out" } | { state: "signed-in"; staff: Staff };

function App() {
  const [path, setPath] = useState(location.pathname);
  const [session, setSession] = useState<Session>({ state: "checking" });
  const review = /^\/review\/([^/]+)$/.exec(path);

  useEffect(() => onNavigate(() => setPath(location.pathname)), []);
  useEffect(() => {
    if (review !== null) return;
    api<{ staff: Staff }>("GET", "/api/session")
      .then((read) => setSession({ state: "signed-in", staff: read.staff }))
      .catch(() => setSession({ state: "signed-out" }));
  }, [path, review === null]);

  useEffect(() => {
    if (review !== null || session.state === "checking") return;
    if (session.state === "signed-in" && path === "/") navigate("/corridors");
    if (session.state === "signed-out" && path !== "/") navigate("/");
  }, [session, path, review]);

  if (review?.[1] !== undefined) return <ReviewPage token={decodeURIComponent(review[1])} />;
  if (session.state === "checking") return null;
  if (session.state === "signed-out") {
    return path === "/" ? (
      <SignInPage
        onSignedIn={(staff) => {
          setSession({ state: "signed-in", staff });
          navigate("/corridors");
        }}
      />
    ) : null;
  }
  const corridor = /^\/corridors\/([^/]+)$/.exec(path);
  if (corridor?.[1] !== undefined) return <WorkspacePage key={corridor[1]} corridorId={decodeURIComponent(corridor[1])} staff={session.staff} />;
  if (path === "/corridors") return <CorridorListPage staff={session.staff} />;
  return null;
}

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
