import { ReactNode, useEffect, useState } from "react";
import { api, ApiError, User, ProjectSummary } from "../lib/api";
import { copy, apiErrorMessage } from "../lib/copy";
import { Link, useNavigate } from "../lib/router";
import { SieveBand } from "../components/SieveBand";
import { displayNumber } from "shared/values";

/**
 * The landing page (DP-93, DP-97), the account screens (DP-59, DP-60) and the
 * project list (DP-86).
 */

export function LandingScreen(): ReactNode {
  const [input, setInput] = useState(1240);
  const [counts, setCounts] = useState<number[]>([0, 0, 0, 0]);
  const ops = ["$match", "$unwind", "$group", "$sort"];
  useEffect(() => {
    void fetch("/api/sample/sieve")
      .then(r => r.json())
      .then((d: { input: number; stages: { count: number }[] }) => {
        setInput(d.input);
        setCounts(d.stages.map(s => s.count));
      });
  }, []);
  return (
    <main className="landing">
      <div className="hero">
        <div className="hero-text">
          <h1 className="hero-wordmark">
            <span className="jar">JAR</span>FUL
          </h1>
          <p className="hero-line">Keep, shape and share your JSON documents in one bright jar.</p>
          <div className="hero-links">
            <Link className="btn primary hero-cta" to="/signup">Start a project</Link>
            <Link className="link" to="/signin">Sign in</Link>
          </div>
        </div>
        <section aria-label="Stage Sieve sample" className="sieve-card">
          <h2 className="sieve-title">Stage Sieve sample</h2>
          {ops.map((op, i) => (
            <div key={i} className="sieve-sample-band" data-stage-index={i}
              data-stage-count={counts[i]} data-capped="false" data-disabled="false">
              <div className="sieve-band-label">
                <span className="sieve-op">{op}</span>
                <span className="sieve-numeral tabular">{displayNumber(counts[i])}</span>
              </div>
              <SieveBand
                geo={{ input, out: counts[i], disabled: false, capped: false }}
                delayMs={40 * i}
                animate
              />
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}

export function SignupScreen(_props: { onSignedIn: (u: User) => void }): ReactNode {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  return (
    <main className="auth-screen">
      <h1 className="h1">Create your jar</h1>
      <form
        className="stack-form"
        onSubmit={e => {
          e.preventDefault();
          void api.post<{ status: string }>("/api/auth/signup", { email, password, name })
            .then(() => {
              setStatus(copy.account.codeSent(email));
              navigate(`/confirm?email=${encodeURIComponent(email)}`);
            })
            .catch(err => setStatus(apiErrorMessage(err as ApiError)));
        }}
      >
        <label className="field">
          <span className="field-label">Name</span>
          <input aria-label="Name" className="text-input" value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Email</span>
          <input aria-label="Email" className="text-input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input aria-label="Password" className="text-input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        <button className="btn primary" type="submit">Create account</button>
      </form>
      <div role="status" aria-label="Account status" className="form-status">{status}</div>
    </main>
  );
}

export function ConfirmScreen(props: { onSignedIn: (u: User) => void }): ReactNode {
  const navigate = useNavigate();
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get("email") ?? "");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  return (
    <main className="auth-screen">
      <h1 className="h1">Enter your code</h1>
      <form
        className="stack-form"
        onSubmit={e => {
          e.preventDefault();
          void api.post<{ user: User }>("/api/auth/confirm", { email, code })
            .then(res => {
              props.onSignedIn(res.user);
              navigate("/projects");
            })
            .catch(err => setStatus(apiErrorMessage(err as ApiError)));
        }}
      >
        <label className="field">
          <span className="field-label">Email</span>
          <input aria-label="Email" className="text-input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Code</span>
          <input aria-label="Code" className="text-input" value={code} onChange={e => setCode(e.target.value)} />
        </label>
        <button className="btn primary" type="submit">Confirm</button>
        <button
          className="btn"
          type="button"
          onClick={() => {
            void api.post("/api/auth/resend", { email })
              .then(() => setStatus(copy.account.codeSent(email)))
              .catch(err => setStatus(apiErrorMessage(err as ApiError)));
          }}
        >
          Send a new code
        </button>
      </form>
      <div role="status" aria-label="Account status" className="form-status">{status}</div>
    </main>
  );
}

export function SigninScreen(props: { onSignedIn: (u: User) => void; returnTo: string }): ReactNode {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  return (
    <main className="auth-screen">
      <h1 className="h1">Sign in</h1>
      <form
        className="stack-form"
        onSubmit={e => {
          e.preventDefault();
          void api.post<{ user: User }>("/api/auth/signin", { email, password })
            .then(res => {
              props.onSignedIn(res.user);
              navigate(props.returnTo);
            })
            .catch(err => setStatus(apiErrorMessage(err as ApiError)));
        }}
      >
        <label className="field">
          <span className="field-label">Email</span>
          <input aria-label="Email" className="text-input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input aria-label="Password" className="text-input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        <button className="btn primary" type="submit">Sign in</button>
      </form>
      <div role="status" aria-label="Account status" className="form-status">{status}</div>
    </main>
  );
}

export function ProjectsScreen(props: { user: User | null; onRefresh: () => void }): ReactNode {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");
  const [collection, setCollection] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    void api.get<{ projects: ProjectSummary[] }>("/api/projects")
      .then(r => setProjects(r.projects));
  }, [props.user]);
  return (
    <main className="content-narrow">
      <h1 className="h1" style={{ letterSpacing: "0.05em" }}>YOUR JARS</h1>
      <ul aria-label="Projects" className="collection-list">
        {projects.map(p => (
          <li key={p.id}>
            <button className="collection-row" onClick={() => navigate(`/p/${p.id}`)}>
              <span>{p.name}</span>
              <span className="count-pill">{p.role}</span>
            </button>
          </li>
        ))}
      </ul>
      <h2 className="h2" style={{ letterSpacing: "0.05em" }}>PUT IT IN THE JAR</h2>
      <form
        className="stack-form"
        onSubmit={e => {
          e.preventDefault();
          void api.post<{ project: { id: string }; collection: { id: string } }>("/api/projects", { name, collection })
            .then(res => {
              setName("");
              setCollection("");
              navigate(`/p/${res.project.id}/c/${res.collection.id}`);
            })
            .catch(err => setStatus(apiErrorMessage(err as ApiError)));
        }}
      >
        <label className="field">
          <span className="field-label">Project name</span>
          <input aria-label="Project name" className="text-input" value={name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">First collection name</span>
          <input aria-label="First collection name" className="text-input" value={collection} onChange={e => setCollection(e.target.value)} />
        </label>
        <button className="btn primary" type="submit">Create project</button>
      </form>
      <div role="status" className="form-status">{status}</div>
    </main>
  );
}

export function NotFoundScreen(): ReactNode {
  return (
    <main className="content-narrow">
      <h1 className="h1">Not found</h1>
      <p className="muted">This page does not exist, or you cannot open it.</p>
    </main>
  );
}
