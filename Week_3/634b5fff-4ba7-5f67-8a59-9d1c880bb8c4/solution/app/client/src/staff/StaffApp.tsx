import { useEffect, useState } from "react";
import { ApiFailure } from "../api.js";
import { ERRORS } from "../../../shared/copy.js";
import { navigate } from "../router.js";
import { useStore } from "../state/store.js";
import { Sheet, Status } from "../ui.js";
import "../styles/staff.css";
import { call, failureText, said, say, waiting } from "./desk.js";
import { StaffHome } from "./Home.js";
import { StaffNav } from "./Nav.js";
import { SECTIONS, STAFF_HOME } from "./sections.js";
import { SignIn } from "./SignIn.js";
import type { Me } from "./types.js";

type Session = { state: "loading" } | { state: "out" } | { state: "in"; me: Me };

const StaffDesk = ({ path }: { path: string }) => {
  const [session, setSession] = useState<Session>({ state: "loading" });
  const sentence = useStore(said);
  const waitingNotice = useStore(waiting);

  useEffect(() => {
    say(null);
    waiting.set(null);
    void call<Me>("GET", "/api/staff/me").then(
      (reply) => setSession({ state: "in", me: reply.body }),
      (error: unknown) => {
        if (!(error instanceof ApiFailure && error.status === 401)) say(failureText(error), true);
        setSession({ state: "out" });
      },
    );
  }, []);

  const signedOut = (): void => {
    setSession({ state: "out" });
    say(null);
    navigate(STAFF_HOME);
  };

  const section = SECTIONS.find((candidate) => candidate.path === path);
  const home = path === STAFF_HOME;
  const roles = session.state === "in" ? session.me.roles : [];
  const allowed = session.state === "in" && (home ? roles.length > 0 : section !== undefined && roles.includes(section.role));

  let notice: string | null = null;
  if (session.state === "out") notice = ERRORS.sign_in_required.message();
  else if (session.state === "in" && !allowed) notice = !home && !section ? ERRORS.not_found.message() : ERRORS.forbidden.message();
  const text = sentence?.text ?? notice ?? waitingNotice ?? "";
  const failed = sentence?.failed ?? false;

  let body = null;
  if (session.state === "out") body = <SignIn />;
  else if (session.state === "in" && allowed) body = home ? <StaffHome me={session.me} onSignedOut={signedOut} /> : section ? <section.Page /> : null;

  return (
    <Sheet wide>
      <h1>{section?.title ?? "Staff"}</h1>
      {session.state === "in" && !(home && allowed) ? <StaffNav roles={roles} path={path} onSignedOut={signedOut} /> : null}
      <Status label="Staff status" className={`staff-status${failed ? " is-failed" : ""}`}>{text}</Status>
      {body}
    </Sheet>
  );
};

export const StaffApp = ({ path }: { path: string }) => <StaffDesk key={path} path={path} />;
