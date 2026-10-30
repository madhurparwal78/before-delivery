import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, onUnauthenticated, type Role, type User } from "./api";
import { Alert, FeedbackContext, type Feedback } from "./ui/feedback";
import { Icon } from "./ui/icons";
import { Link, navigate, usePath } from "./ui/router";
import { SignIn } from "./pages/SignIn";
import { Courses } from "./pages/Courses";
import { CoursePage } from "./pages/CoursePage";
import { Learning } from "./pages/Learning";
import { Player } from "./pages/Player";
import { Evaluation } from "./pages/Evaluation";
import { Completion } from "./pages/Completion";
import { Transcript } from "./pages/Transcript";
import { Verify } from "./pages/Verify";
import { Sponsor } from "./pages/Sponsor";
import { Planner } from "./pages/Planner";
import { CohortDetail } from "./pages/CohortDetail";
import { Authoring } from "./pages/Authoring";

const NAV: { to: string; label: string; roles: Role[] }[] = [
  { to: "/courses", label: "Courses", roles: ["learner", "coordinator", "planner", "author"] },
  { to: "/learning", label: "My learning", roles: ["learner"] },
  { to: "/transcript", label: "Transcript", roles: ["learner"] },
  { to: "/sponsor", label: "Hospital seats", roles: ["coordinator"] },
  { to: "/planner", label: "Planner", roles: ["planner"] },
  { to: "/author", label: "Authoring", roles: ["author", "planner"] },
];

function Denied() {
  return (
    <div className="stack">
      <h1>This page isn't part of your role</h1>
      <p className="muted">
        Your account can't open this screen. <Link to="/courses">Back to Courses</Link>
      </p>
    </div>
  );
}

function screen(path: string, user: User): ReactNode {
  const parts = path.split("/").filter(Boolean);
  const only = (roles: Role[], node: ReactNode) => (roles.includes(user.role) ? node : <Denied />);
  if (parts[0] === "courses" && parts[1]) return <CoursePage key={parts[1]} courseId={parts[1]} user={user} />;
  if (parts[0] === "courses") return <Courses user={user} />;
  if (parts[0] === "learning") return only(["learner"], <Learning user={user} />);
  if (parts[0] === "learn" && parts[1] && parts[2]) {
    const enrolmentId = parts[1];
    if (parts[2] === "seal") return only(["learner"], <Completion key={enrolmentId} enrolmentId={enrolmentId} />);
    if (parts[2] === "evaluation") return only(["learner"], <Evaluation key={enrolmentId} enrolmentId={enrolmentId} />);
    return only(["learner"], <Player key={`${enrolmentId}/${parts[2]}`} enrolmentId={enrolmentId} moduleId={parts[2]} />);
  }
  if (parts[0] === "transcript") return only(["learner"], <Transcript />);
  if (parts[0] === "sponsor") return only(["coordinator"], <Sponsor user={user} />);
  if (parts[0] === "planner" && parts[1] === "cohorts" && parts[2]) return only(["planner"], <CohortDetail key={parts[2]} cohortId={parts[2]} />);
  if (parts[0] === "planner") return only(["planner"], <Planner />);
  if (parts[0] === "author") return only(["author", "planner"], <Authoring user={user} />);
  return <Courses user={user} />;
}

export function App() {
  const path = usePath();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [status, setStatus] = useState({ text: "", serial: 0 });
  const [alert, setAlert] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const verification = path.startsWith("/verify/");

  const feedback = useMemo<Feedback>(
    () => ({
      announce: (text) => setStatus((s) => ({ text, serial: s.serial + 1 })),
      showAlert: (text) => setAlert(text),
    }),
    [],
  );

  useEffect(() => {
    onUnauthenticated(() => setUser(null));
  }, []);

  useEffect(() => {
    if (verification) return;
    api<{ user: User }>("GET", "/api/me").then(
      (body) => setUser(body.user),
      () => setUser(null),
    );
  }, [verification]);

  useEffect(() => {
    setAlert(null);
    setMenuOpen(false);
  }, [path]);

  useEffect(() => {
    if (verification || user === undefined) return;
    if (user === null && path !== "/signin") navigate("/signin", true);
    if (user && (path === "/signin" || path === "/")) navigate("/courses", true);
  }, [user, path, verification]);

  const signOut = useCallback(async () => {
    await api("DELETE", "/api/session").catch(() => undefined);
    setUser(null);
    feedback.announce("You're signed out.");
    navigate("/signin");
  }, [feedback]);

  if (verification) return <Verify token={path.slice("/verify/".length)} />;
  if (user === undefined) return <main aria-busy="true" />;
  const activity = (
    <div className="activity" role="status" aria-label="Activity status" aria-live="polite">
      {status.text && (
        <p key={status.serial} className="activity-line">
          <Icon name="check" />
          {status.text}
        </p>
      )}
    </div>
  );
  if (user === null || path === "/signin") {
    return (
      <FeedbackContext.Provider value={feedback}>
        {activity}
        <SignIn
          onSignedIn={(signedIn) => {
            setStatus((s) => ({ text: "", serial: s.serial + 1 }));
            setUser(signedIn);
          }}
        />
      </FeedbackContext.Provider>
    );
  }

  const links = NAV.filter((item) => item.roles.includes(user.role));
  return (
    <FeedbackContext.Provider value={feedback}>
      <header className="topbar" data-shell="">
        <a className="skip" href="#main">
          Skip to main content
        </a>
        <div className="topbar-inner">
          <Link to="/courses" className="wordmark">
            Credwell <small>Sorrel &amp; Pike Learning</small>
          </Link>
          <button type="button" className="btn secondary menu-button" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen((open) => !open)}>
            <Icon name="menu" />
            Menu
          </button>
          <nav id="main-nav" aria-label="Main" className={`nav-main${menuOpen ? " open" : ""}`}>
            <ul>
              {links.map((item) => (
                <li key={item.to}>
                  <Link to={item.to} aria-current={path === item.to || path.startsWith(`${item.to}/`) ? "page" : undefined}>
                    {item.label}
                  </Link>
                </li>
              ))}
              <li className="signout-menu">
                <button type="button" className="btn quiet" onClick={signOut}>
                  <Icon name="signOut" />
                  Sign out
                </button>
              </li>
            </ul>
          </nav>
          <p className="who">
            {user.display_name}
            <br />
            {user.organisation?.name}
          </p>
          <button type="button" className="btn secondary signout-wide" onClick={signOut}>
            <Icon name="signOut" />
            Sign out
          </button>
        </div>
      </header>
      {activity}
      {alert && (
        <div className="page-alert">
          <Alert>{alert}</Alert>
        </div>
      )}
      <main id="main" data-shell="">
        {screen(path, user)}
      </main>
    </FeedbackContext.Provider>
  );
}
