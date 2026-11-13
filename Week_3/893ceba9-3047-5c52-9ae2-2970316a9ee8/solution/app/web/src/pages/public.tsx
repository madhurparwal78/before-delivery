import { useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  CalendarClock, Check, Cookie, CopyCheck, Gauge, GitMerge, EyeOff, FileCheck, Globe, HardDrive, History, KeyRound, ShieldCheck, Trash2, Users, Webhook,
} from "lucide-preact";
import type { ComponentType } from "preact";
import { ApiError, api, type User } from "../api";
import { HeroCollage, HubDiagram } from "../illustrations";
import { PublicHeader } from "../layout";
import { navigate, useRoute } from "../router";
import { act, loadSession, sessionStore, useStore } from "../store";
import { Button, Field, LinkButton, LiveRegions, useHeadingFocus } from "../ui";

const POSTURE: [string, string, ComponentType<{ size?: number; strokeWidth?: number }>][] = [
  ["One session cookie", "One HttpOnly cookie keeps you signed in for twelve hours, and nothing else is set.", Cookie],
  ["Files kept as submitted", "Every TM file and source locale file is stored byte for byte and downloads exactly as you sent it.", FileCheck],
  ["Exact restore", "Undo an import or a merge and main and the TM read back exactly as they were before.", History],
  ["Erasure on request", "Erase a client project and its rows, files, tokens and webhook application go with it.", Trash2],
  ["Signed webhooks", "Publish and review events reach your CI signed by Svix, with one stable event id and retries.", Webhook],
  ["Scoped reviewer access", "Reviewers see only the projects they were invited to and act only on segments assigned to them.", Users],
  ["Per-project CI tokens", "Each token pulls one project's approved locale files and nothing else.", KeyRound],
  ["Six-month audit log", "Every state change writes an entry, kept for six months and exportable as a CSV.", CalendarClock],
  ["Formula-safe exports", "Spreadsheet formulas in exported cells are neutralised before they reach your sheet.", ShieldCheck],
  ["Same-origin only", "The browser talks only to this origin, with no third-party scripts, fonts or images.", Globe],
  ["Your own storage", "Originals, snapshots and bundles live in your own Postgres and S3-compatible storage.", HardDrive],
  ["No trackers", "No analytics, no advertising cookies and no beacons.", EyeOff],
];

const PERSONAS = [
  {
    tone: "desk" as const,
    title: "The engineer's desk",
    audience: "For the localization engineer who runs several client apps alone.",
    body: "Import a client's legacy translation memory, branch the strings, draft with routed AI, merge without losing a translation and publish what you approved.",
    points: ["Exact matches reused across imports, branches and drafts", "Branches that never overwrite a translation silently", "Any import or merge restored exactly", "Publishing confirmed by the repository host"],
    link: "Open the demo desk",
  },
  {
    tone: "queue" as const,
    title: "The client reviewer's queue",
    audience: "For the client linguist or product owner invited to review.",
    body: "Work an assigned queue of low-scoring segments, often from a phone and only with the keyboard, approving or correcting each one.",
    points: ["Only the projects you were invited to", "Keyboard shortcuts J, K, A and C", "Assignments that expire on the server clock", "Corrections saved and approved in one step"],
    link: "Sign in to review",
  },
];

export function Landing() {
  useHeadingFocus("Keep every string");
  return (
    <>
      <PublicHeader />
      <main className="landing">
        <section className="band band-white hero">
          <div className="container hero-grid">
            <div className="hero-copy">
              <h1 className="display">
                <span>Keep every string.</span> <span>Branch without losing one.</span> <span>Publish what you approved.</span>
              </h1>
              <p className="lead">Translation memory, branches, AI drafts and MQM review for the engineer who runs several client apps alone.</p>
              <LinkButton variant="primary" arrow href="/sign-in">Open the demo desk</LinkButton>
            </div>
            <div className="hero-art panel">
              <HeroCollage />
              <div className="chip chip-a"><span className="chip-icon"><Gauge size={16} strokeWidth={1.5} aria-hidden="true" /></span><span><strong>MQM 96</strong><small>Example</small></span></div>
              <div className="chip chip-b"><span className="chip-icon"><CopyCheck size={16} strokeWidth={1.5} aria-hidden="true" /></span><span><strong>312 exact matches reused</strong><small>Example</small></span></div>
              <div className="chip chip-c"><span className="chip-icon"><GitMerge size={16} strokeWidth={1.5} aria-hidden="true" /></span><span><strong>2 branch conflicts open</strong><small>Example</small></span></div>
            </div>
          </div>
        </section>

        <section className="band band-grey">
          <div className="container">
            <h2 id="who-heading" className="section-title">Who works here</h2>
            <div role="region" aria-label="Who works here" className="persona-grid">
              {PERSONAS.map((p) => (
                <article key={p.title} className="card persona">
                  <HubDiagram tone={p.tone} />
                  <div className="persona-body">
                    <h3>{p.title}</h3>
                    <p className="audience">{p.audience}</p>
                    <p>{p.body}</p>
                    <ul className="ticks">{p.points.map((t) => <li key={t}><Check size={18} strokeWidth={2} aria-hidden="true" />{t}</li>)}</ul>
                    <LinkButton variant="outline" arrow href="/sign-in">{p.link}</LinkButton>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="band band-white">
          <div className="container">
            <div role="region" aria-label="Security and hosting">
              <h2 id="posture-heading" className="section-title">How your clients' strings are kept</h2>
              <ul className="posture-grid">
                {POSTURE.map(([title, text, Icon]) => (
                  <li key={title} className="posture-item">
                    <span className="icon-tile plain"><Icon size={40} strokeWidth={1.25} /></span>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </li>
                ))}
              </ul>
              <div className="center"><LinkButton variant="primary" arrow href="/sign-in">Open the demo desk</LinkButton></div>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="container"><p>Interline Desk by Marlow &amp; Quill Language Works.</p></div>
      </footer>
    </>
  );
}

export function SignIn() {
  useHeadingFocus("Sign in");
  const route = useRoute();
  const user = useStore(sessionStore);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const next = (u: User) => {
    const asked = route.query.get("next");
    if (asked && asked.startsWith("/") && !asked.startsWith("//")) return asked;
    return u.role === "owner" ? "/desk" : "/review";
  };
  useLayoutEffect(() => { if (user) navigate(next(user), true); }, [user?.id]);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const out = await act("Signing you in.", () => api<{ user: User }>("POST", "/api/session", { email, password }));
    setBusy(false);
    if (out.ok) {
      sessionStore.set(out.value.user);
      void loadSession();
      navigate(next(out.value.user));
    } else {
      setError(out.error instanceof ApiError && out.error.status === 401 ? "That email and password don't match." : out.error.message);
      emailRef.current?.focus();
    }
  };
  return (
    <>
      <PublicHeader />
      <main className="page page-narrow">
        <LiveRegions />
        <form className="card sign-in" onSubmit={submit} noValidate>
          <h1 className="h2">Sign in</h1>
          <p className="muted">Owners and invited reviewers sign in with an email and password.</p>
          <Field label="Email">
            {(p) => <input {...p} ref={emailRef} type="email" autocomplete="username" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />}
          </Field>
          <Field label="Password">
            {(p) => <input {...p} type="password" autocomplete="current-password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />}
          </Field>
          {error && <p className="field-note field-note-error">{error}</p>}
          <Button type="submit" busy={busy}>Sign in</Button>
        </form>
      </main>
    </>
  );
}

export function NotFound({ kind = "page" }: { kind?: "project" | "page" }) {
  const user = useStore(sessionStore);
  useHeadingFocus("Not found");
  const back = !user ? { to: "/", label: "Back to the landing page" }
    : user.role === "owner" ? { to: "/desk", label: "Back to your desk" } : { to: "/review", label: "Back to your review queue" };
  const body = (
    <section className="card not-found">
      <h1 className="h2">{kind === "project" ? "We couldn't find that project" : "We couldn't find that page"}</h1>
      <p>{kind === "project" ? "It may have been erased, or the link is wrong." : "The address may be mistyped, or the page may have moved."}</p>
      <LinkButton variant="primary" arrow href={back.to}>{back.label}</LinkButton>
    </section>
  );
  return user ? body : <><PublicHeader /><main className="page page-narrow">{body}</main></>;
}

const NOTICE_KEY = "interline-notice-hidden";

export function Notice() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(NOTICE_KEY) === "1"; } catch { return false; }
  });
  const [more, setMore] = useState(false);
  if (hidden) return null;
  return (
    <section className="notice" aria-label="Cookie and data notice">
      <p>Interline Desk sets one session cookie to keep you signed in. No tracking or advertising cookies.</p>
      {more && <p>Your choice to hide this notice is remembered in this browser only.</p>}
      <div className="notice-actions">
        <Button variant="outline" aria-expanded={more} onClick={() => setMore(!more)}>Details</Button>
        <Button variant="primary" onClick={() => { try { localStorage.setItem(NOTICE_KEY, "1"); } catch { /* the choice just isn't remembered */ } setHidden(true); }}>Got it</Button>
      </div>
    </section>
  );
}
