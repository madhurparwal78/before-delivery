// The application: who is signed in, which screen their route shows, and the shared chrome.

import { useCallback, useEffect, useState } from "react";
import type { Role, User } from "../shared/api";
import { call, get } from "./api";
import { navigate, useLocation } from "./router";
import { StatusProvider } from "./status";
import { Shell } from "./ui/Shell";
import { SignIn } from "./screens/SignIn";
import { Desk } from "./screens/Desk";
import { Rentals } from "./screens/Rentals";
import { SectionDesk } from "./screens/SectionDesk";
import { FolderList, FolderView } from "./screens/Folders";

function landingFor(role: Role): string {
  if (role === "section_principal") return "/section";
  if (role === "player") return "/folder";
  return "/desk";
}

function allowed(role: Role, path: string): boolean {
  const librarian = role === "principal_librarian" || role === "assistant_librarian";
  if (path === "/desk" || path.startsWith("/desk/") || path === "/rentals") return librarian;
  if (path === "/section") return role === "section_principal";
  if (path === "/folder" || path.startsWith("/folder/")) return role === "player" || role === "section_principal";
  return false;
}

export function App() {
  const { path, search } = useLocation();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    void get<{ user: User }>("/api/session").then((answer) => setUser(answer.ok ? answer.data.user : null));
    const signedOut = (): void => setUser(null);
    window.addEventListener("qw:signed-out", signedOut);
    return () => window.removeEventListener("qw:signed-out", signedOut);
  }, []);

  useEffect(() => {
    if (user === undefined) return;
    if (user === null && path !== "/") navigate("/", true);
    else if (user && (path === "/" || !allowed(user.role, path))) navigate(landingFor(user.role), true);
  }, [user, path]);

  const signOut = useCallback(async () => {
    await call("DELETE", "/api/session");
    setUser(null);
    navigate("/", true);
  }, []);

  if (user === undefined) return null;
  if (user === null) {
    return path === "/" ? <SignIn onSignedIn={(signedIn) => { setUser(signedIn); navigate(landingFor(signedIn.role)); }} /> : null;
  }
  if (!allowed(user.role, path)) return null;

  const folder = /^\/folder\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  const desk = /^\/desk(?:\/([^/]+))?$/.exec(path);
  return (
    <StatusProvider>
      <Shell user={user} path={path} onSignOut={signOut}>
        {desk && <Desk user={user} programmeId={desk[1] ?? null} workId={search.get("work")} />}
        {path === "/rentals" && <Rentals user={user} />}
        {path === "/section" && <SectionDesk user={user} />}
        {path === "/folder" && <FolderList />}
        {folder?.[1] && <FolderView key={folder[1]} programmeId={folder[1]} partId={folder[2] ?? null} />}
      </Shell>
    </StatusProvider>
  );
}
