import { useEffect, useState } from "react";
import { api, whenSignedOut } from "./api";
import { Billing } from "./Billing";
import { Board } from "./Board";
import { Credentials } from "./Credentials";
import { Frame, HOME } from "./Frame";
import { Invoices } from "./Invoices";
import { NotFound } from "./NotFound";
import { Profile } from "./Profile";
import { RequestDetail } from "./RequestDetail";
import { RequestForm } from "./RequestForm";
import { Requests } from "./Requests";
import { navigate, usePlace } from "./router";
import { SeatsPage } from "./SeatsPage";
import { SignIn } from "./SignIn";
import type { User } from "./types";

type Session = { state: "loading" } | { state: "out" } | { state: "in"; user: User };

function fromAssignments(state: unknown): boolean {
  return Boolean(state && typeof state === "object" && "from" in state && state.from === "assignments");
}

/** The page for a path, given the signed-in role; null sends the viewer to their home. */
function page(user: User, path: string, state: unknown) {
  const request = /^\/requests\/([^/]+)$/.exec(path)?.[1];
  const edit = /^\/requests\/([^/]+)\/edit$/.exec(path)?.[1];
  const job = /^\/jobs\/([^/]+)$/.exec(path)?.[1];
  switch (user.role) {
    case "coordinator":
      if (path === "/board") return <Board viewer={user} />;
      if (path === "/credentials") return <Credentials />;
      break;
    case "interpreter":
      if (path === "/open-seats") return <SeatsPage viewer={user} kind="open-seats" />;
      if (path === "/assignments") return <SeatsPage viewer={user} kind="assignments" />;
      if (job) return <SeatsPage viewer={user} kind={fromAssignments(state) ? "assignments" : "open-seats"} />;
      if (path === "/profile") return <Profile />;
      break;
    case "client_scheduler":
      if (path === "/requests") return <Requests />;
      if (path === "/requests/new") return <RequestForm key="new" editId={null} />;
      if (edit) return <RequestForm key={edit} editId={edit} />;
      if (request) return <RequestDetail key={request} id={request} />;
      if (path === "/invoices") return <Invoices />;
      break;
    case "billing_admin":
      if (path === "/billing") return <Billing />;
      if (path === "/invoices") return <Invoices />;
      break;
  }
  return request || edit || job ? <NotFound /> : null;
}

export function App() {
  const place = usePlace();
  const [session, setSession] = useState<Session>({ state: "loading" });

  useEffect(() => {
    whenSignedOut(() => setSession({ state: "out" }));
    void api<{ user: User }>("GET", "/api/me").then((result) => {
      setSession(result.ok ? { state: "in", user: result.data.user } : { state: "out" });
    });
  }, []);

  const content = session.state === "in" ? page(session.user, place.path, place.state) : null;

  useEffect(() => {
    if (session.state === "out" && place.path !== "/signin") navigate("/signin", { replace: true });
    if (session.state === "in" && content === null) navigate(HOME[session.user.role], { replace: true });
  }, [session, place.path, content]);

  if (session.state === "loading") return <div className="app app--loading" aria-busy="true" />;
  if (session.state === "out") {
    return (
      <SignIn
        onSignedIn={(user) => {
          setSession({ state: "in", user });
          navigate(HOME[user.role], { replace: true });
        }}
      />
    );
  }
  const signOut = async () => {
    await api("DELETE", "/api/session");
    setSession({ state: "out" });
    navigate("/signin", { replace: true });
  };
  return (
    <Frame user={session.user} onSignOut={() => void signOut()}>
      {content}
    </Frame>
  );
}
