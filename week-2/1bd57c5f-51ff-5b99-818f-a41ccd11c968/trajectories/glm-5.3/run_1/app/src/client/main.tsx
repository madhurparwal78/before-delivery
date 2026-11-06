import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type Job, type User } from "./api.js";
import { Dialog, useOnlineStatus } from "./components.js";
import { JobView } from "./views/JobView.js";
import "./styles.css";

type Route =
  | { kind: "signin" }
  | { kind: "jobs" }
  | { kind: "account" }
  | { kind: "job"; jobId: string; itemId?: string }
  | { kind: "notfound" };

function parseRoute(): Route {
  const path = window.location.pathname;
  if (path === "/signin") return { kind: "signin" };
  if (path === "/account") return { kind: "account" };
  if (path === "/jobs" || path === "/") return { kind: "jobs" };
  const jobMatch = /^\/jobs\/([^/]+)(?:\/items\/([^/]+))?$/.exec(path);
  if (jobMatch !== null) return { kind: "job", jobId: jobMatch[1]!, itemId: jobMatch[2] };
  return { kind: "notfound" };
}

function navigate(path: string, signedOut = false): void {
  window.history.pushState({}, "", path);
  if (signedOut) window.sessionStorage.setItem("snaglight_signed_out", "1");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

type TopBarProps = { user: User | null; onSignOut: () => void };

function TopBar({ user, onSignOut }: TopBarProps): JSX.Element {
  const online = useOnlineStatus();
  return (
    <>
      <header className="topbar">
        <span className="brand">Snaglight</span>
        <nav aria-label="Top bar">
          <a href="/jobs" onClick={(e) => { e.preventDefault(); navigate("/jobs"); }}>Your jobs</a>
          <a href="/account" onClick={(e) => { e.preventDefault(); navigate("/account"); }}>Account</a>
          {user !== null && <button type="button" className="quiet" onClick={onSignOut}>Sign out</button>}
        </nav>
      </header>
      <div className={`connection ${online ? "" : "offline"}`} role="status" aria-label="Connection">
        {online ? null : "You're offline. Changes are saved on this phone and will sync when you reconnect."}
      </div>
    </>
  );
}

function SignIn({ onSignedIn }: { onSignedIn: (user: User) => void }): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedOut = window.sessionStorage.getItem("snaglight_signed_out") === "1";
  window.sessionStorage.removeItem("snaglight_signed_out");

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: User }>("POST", "/api/session", { email, password });
      onSignedIn(res.user);
      navigate("/jobs");
    } catch (err) {
      setError((err as { message?: string }).message ?? "Sign in to continue.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page" aria-label="Sign in">
      <h1>Sign in</h1>
      {signedOut && <p>You've been signed out.</p>}
      {error !== null && (
        <div className="error-summary" role="alert">
          <h2 style={{ fontSize: "1rem" }}>There is a problem</h2>
          <p>{error}</p>
        </div>
      )}
      <form onSubmit={(e) => { void submit(e); }}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <button type="submit" className="primary" disabled={busy}>{busy ? "Saving" : "Sign in"}</button>
      </form>
    </main>
  );
}

function Account(): JSX.Element {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setFieldError(null);
    try {
      await api("POST", "/api/me/password", { current_password: current, new_password: next });
      setActivity("Password changed. Every other session is signed out.");
      setCurrent("");
      setNext("");
    } catch (err) {
      const body = (err as { body?: { fields?: Record<string, string>; message?: string } }).body;
      setFieldError(body?.fields?.new_password ?? body?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page" aria-label="Account">
      <h1>Account</h1>
      {fieldError !== null && (
        <div className="error-summary" role="alert">
          <h2 style={{ fontSize: "1rem" }}>There is a problem</h2>
          <p>{fieldError}</p>
        </div>
      )}
      <form onSubmit={(e) => { void submit(e); }}>
        <div className="field">
          <label htmlFor="current-password">Current password</label>
          <input id="current-password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input id="new-password" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <button type="submit" className="primary" disabled={busy}>{busy ? "Saving" : "Change password"}</button>
      </form>
      <p aria-live="polite">{activity}</p>
    </main>
  );
}

const TIME_ZONES = [
  "America/Chicago", "America/Denver", "America/New_York", "America/Los_Angeles", "America/Phoenix",
  "Europe/London", "Europe/Berlin", "Europe/Paris", "Asia/Tokyo", "Australia/Sydney", "UTC",
];

function JobsList({ user }: { user: User }): JSX.Element {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [activity, setActivity] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [timeZone, setTimeZone] = useState("America/Chicago");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    void api<{ jobs: Job[] }>("GET", "/api/jobs").then((res) => setJobs(res.jobs));
  }, []);

  const createJob = async (): Promise<void> => {
    setBusy(true);
    setFields(null);
    try {
      await api("POST", "/api/jobs", { name, address, time_zone: timeZone });
      setActivity("Job created.");
      setDialogOpen(false);
      const res = await api<{ jobs: Job[] }>("GET", "/api/jobs");
      setJobs(res.jobs);
    } catch (err) {
      const body = (err as { body?: { fields?: Record<string, string> } }).body;
      setFields(body?.fields ?? null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page" aria-label="Your jobs">
      <h1>Your jobs</h1>
      {activity !== "" && <p aria-live="polite">{activity}</p>}
      {jobs === null ? (
        <p>Loading…</p>
      ) : jobs.length === 0 ? (
        <p>No jobs yet.</p>
      ) : (
        <div className="jobs-list">
          {jobs.map((job) => (
            <div className="job-row" key={job.id}>
              <a href={`/jobs/${job.id}`} onClick={(e) => { e.preventDefault(); navigate(`/jobs/${job.id}`); }}>{job.name}</a>
              <span className="stage-label">{job.status === "active" ? "Active" : job.status === "walkthrough" ? "Walkthrough" : "Closed out"}</span>
              <span className="mono">{job.progress.percent}% verified</span>
            </div>
          ))}
        </div>
      )}
      {user.is_owner && (
        <p style={{ marginTop: 16 }}>
          <button type="button" className="primary" onClick={() => setDialogOpen(true)}>New job</button>
        </p>
      )}
      {dialogOpen && (
        <Dialog title="New job" onClose={() => setDialogOpen(false)}>
          {fields !== null && (
            <div className="error-summary" role="alert">
              <h2 style={{ fontSize: "1rem" }}>There is a problem</h2>
              {Object.entries(fields).map(([k, v]) => <p key={k}><a href={`#newjob-${k}`}>{v}</a></p>)}
            </div>
          )}
          <div className="field">
            <label htmlFor="newjob-name">Job name</label>
            <input id="newjob-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="newjob-address">Address</label>
            <input id="newjob-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="newjob-tz">Time zone</label>
            <input id="newjob-tz" list="tz-list" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
            <datalist id="tz-list">{TIME_ZONES.map((tz) => <option value={tz} key={tz} />)}</datalist>
          </div>
          <div className="row">
            <button type="button" className="primary" onClick={() => { void createJob(); }} disabled={busy}>{busy ? "Saving" : "Create job"}</button>
          </div>
        </Dialog>
      )}
    </main>
  );
}

function NotFound(): JSX.Element {
  return (
    <main className="not-found" aria-label="Not found">
      <h1>We can't find that page.</h1>
      <p><a href="/jobs" onClick={(e) => { e.preventDefault(); navigate("/jobs"); }}>Back to your jobs</a></p>
    </main>
  );
}

function App(): JSX.Element {
  const [route, setRoute] = useState<Route>(parseRoute);
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const onPop = (): void => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api<{ user: User }>("GET", "/api/me");
        setUser(res.user);
      } catch {
        setUser(null);
        if (route.kind !== "signin") navigate("/signin", true);
      } finally {
        setChecked(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.kind]);

  const signOut = (): void => {
    void api("DELETE", "/api/session").then(() => {
      setUser(null);
      navigate("/signin", true);
    });
  };

  if (!checked) return <p style={{ padding: 20 }}>Loading…</p>;

  return (
    <>
      <TopBar user={user} onSignOut={signOut} />
      {route.kind === "signin" && <SignIn onSignedIn={(u) => setUser(u)} />}
      {route.kind === "jobs" && (user === null ? <SignIn onSignedIn={(u) => setUser(u)} /> : <JobsList user={user} />)}
      {route.kind === "account" && (user === null ? <SignIn onSignedIn={(u) => setUser(u)} /> : <Account />)}
      {route.kind === "job" && (
        <JobView
          jobId={route.jobId}
          initialItemId={route.itemId}
          user={user}
          onUnauthenticated={() => navigate("/signin", true)}
          onNotFound={() => setRoute({ kind: "notfound" })}
        />
      )}
      {route.kind === "notfound" && <NotFound />}
      <div className="activity-strip" role="status" aria-label="Activity" />
    </>
  );
}

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
}

const root = createRoot(document.getElementById("app")!);
root.render(<App />);
