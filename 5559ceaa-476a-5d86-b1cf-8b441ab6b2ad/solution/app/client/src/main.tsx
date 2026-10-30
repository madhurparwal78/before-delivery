import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { SignInPage, VerifyPage } from "./pages/auth";
import { ProjectsPage } from "./pages/projects";
import { ReviewPage } from "./pages/review";
import { usePlace } from "./router";
import type { User } from "./types";
import { WorkspacePage } from "./workspace/workspace";
import "./styles.css";

const PROJECT = /^\/projects\/([0-9a-f-]{36})$/;
const REVIEW = /^\/review\/([^/]+)$/;

function SignedIn({ children }: { children: (user: User) => React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    api<{ user: User }>("/api/me")
      .then((r) => setUser(r.user))
      .catch(() => undefined);
  }, []);
  return user ? <>{children(user)}</> : <div className="boot" aria-busy="true" />;
}

function App() {
  const place = usePlace();
  const review = REVIEW.exec(place.path);
  if (review) return <ReviewPage token={decodeURIComponent(review[1]!)} />;
  if (place.path === "/sign-in") return <SignInPage notice={place.state} />;
  if (place.path === "/auth/verify") return <VerifyPage token={place.query.get("token") ?? ""} />;
  const project = PROJECT.exec(place.path);
  return (
    <SignedIn key={place.path}>
      {(user) => (project ? <WorkspacePage key={project[1]} user={user} projectId={project[1]!} /> : <ProjectsPage user={user} />)}
    </SignedIn>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
