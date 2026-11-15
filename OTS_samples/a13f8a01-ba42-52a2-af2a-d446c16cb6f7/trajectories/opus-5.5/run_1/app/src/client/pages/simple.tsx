import { useEffect, useState } from "preact/hooks";
import { starterPens } from "../../shared/starters";
import type { ShelfLibrary, User } from "../../shared/types";
import { api } from "../api";
import { StageCrossfade, StatePanel } from "../components";
import { AccountNotices, Header, Page } from "../layout";
import { refreshLive } from "../live";
import { Link, navigate } from "../router";
import { getState, markVerificationPending, setState } from "../store";

export function NotFound() {
  return (
    <Page class="not-found">
      <h1>Nothing here</h1>
      <p>This pen does not exist, or it is not shared with you.</p>
      <p>
        <Link href="/explore">Go to Explore</Link>
      </p>
    </Page>
  );
}

const sections = [
  {
    title: "Pinned libraries",
    text: "Pens load libraries from a small shelf that Ashlar serves itself, pinned to exact versions. Nothing floats, so nothing quietly breaks.",
  },
  {
    title: "Every save is a version",
    text: "Each save is kept byte for byte. Walk back through the layers, compare any two, and restore the one that worked.",
  },
  {
    title: "Embeds that keep working",
    text: "Share a pen in a post or a lesson. It opens on the tab you chose and runs from the same pinned shelf.",
  },
];

export function Landing() {
  const [starter, setStarter] = useState(1);
  useEffect(() => {
    const update = () => {
      const headings = [...document.querySelectorAll<HTMLElement>(".landing-section h2")];
      const passed = headings.filter((heading) => heading.getBoundingClientRect().top < window.innerHeight / 2).length;
      setStarter(1 + passed);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  const pen = starterPens[starter - 1] ?? starterPens[0];
  return (
    <div class="landing">
      <Header inverse />
      <AccountNotices />
      <main class="landing-main">
        <div role="region" aria-label="Starter pen" class="hero-inset" data-starter={String(starter)}>
          {pen && <StageCrossfade source={{ files: pen.files, libraries: pen.libraries }} sourceKey={`starter-${starter}`} />}
        </div>
        <h1 class="wordmark">ashlar</h1>
        <div class="landing-column">
          <p class="hero-sentence">Write a little HTML, CSS and JavaScript. Watch it run. Keep every version.</p>
          {sections.map((section) => (
            <section class="landing-section" key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.text}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

function AccountStage() {
  const pen = starterPens[0];
  return <div class="stage">{pen && <StageCrossfade source={{ files: pen.files, libraries: pen.libraries }} sourceKey="account" />}</div>;
}

function signedIn(user: User): void {
  setState({ user, accountStatus: "" });
  refreshLive();
  navigate("/dashboard");
}

function fieldId(field: string): string {
  return `account-${field}`;
}

const fieldOrder = ["handle", "email", "password"];

function AccountField(props: { name: string; label: string; error?: string | undefined; autocomplete: string; password?: boolean }) {
  const id = fieldId(props.name);
  return (
    <div class={`field${props.error ? " has-error" : ""}`}>
      <label for={id}>{props.label}</label>
      {props.error && (
        <p class="field-error" id={`${id}-error`}>
          {props.error}
        </p>
      )}
      <input
        id={id}
        name={props.name}
        type={props.password ? "password" : "text"}
        role={props.password ? "textbox" : undefined}
        autocomplete={props.autocomplete}
        spellcheck={false}
        autocapitalize="none"
        aria-invalid={props.error ? "true" : undefined}
        aria-describedby={props.error ? `${id}-error` : undefined}
      />
    </div>
  );
}

export function Signup() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    setBusy(true);
    const result = await api<{ user: User; verification: "sent" | "pending" }>("POST", "/api/signup", {
      handle: form.get("handle"),
      email: form.get("email"),
      password: form.get("password"),
    });
    setBusy(false);
    if (result.ok) {
      markVerificationPending(result.data.user.id, result.data.verification === "pending");
      signedIn(result.data.user);
      return;
    }
    setFields(result.error.fields ?? { handle: result.error.message });
    window.setTimeout(() => document.getElementById("account-problem")?.focus(), 0);
  };
  const errors = fieldOrder.filter((field) => fields[field]);
  return (
    <Page class="split account-page">
      <AccountStage />
      <div class="column">
        <h1>Create an account</h1>
        {errors.length > 0 && (
          <div role="alert" class="error-summary" id="account-problem" tabIndex={-1}>
            <h2>There is a problem</h2>
            <ul>
              {errors.map((field) => (
                <li key={field}>
                  <a
                    href={`#${fieldId(field)}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(fieldId(field))?.focus();
                    }}
                  >
                    {fields[field]}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <form onSubmit={(event) => void submit(event)} noValidate>
          <AccountField name="handle" label="Handle" error={fields.handle} autocomplete="username" />
          <AccountField name="email" label="Email" error={fields.email} autocomplete="email" />
          <AccountField name="password" label="Password" error={fields.password} autocomplete="new-password" password />
          <button type="submit" class="primary" disabled={busy}>
            Create account
          </button>
        </form>
        <p>
          Already have an account? <Link href="/signin">Sign in</Link>
        </p>
      </div>
    </Page>
  );
}

export function Signin() {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    setBusy(true);
    const result = await api<{ user: User }>("POST", "/api/signin", { email: form.get("email"), password: form.get("password") });
    setBusy(false);
    if (result.ok) signedIn(result.data.user);
    else setFailed(true);
  };
  return (
    <Page class="split account-page">
      <AccountStage />
      <div class="column">
        <h1>Sign in</h1>
        {failed && (
          <div role="alert" class="error-summary">
            <p>That email or password is not right.</p>
          </div>
        )}
        <form onSubmit={(event) => void submit(event)} noValidate>
          <AccountField name="email" label="Email" autocomplete="email" />
          <AccountField name="password" label="Password" autocomplete="current-password" password />
          <button type="submit" class="primary" disabled={busy}>
            Sign in
          </button>
        </form>
        <p>
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </div>
    </Page>
  );
}

const verifiedHeading = "Your email is verified";
const expiredHeading = "This link has expired. Sign in and use Resend link to get a new one.";

export function Verify({ token }: { token: string }) {
  const [heading, setHeading] = useState("");
  useEffect(() => {
    void api<{ user: User }>("POST", "/api/verify", { token }).then((result) => {
      if (result.ok) {
        const user = getState().user;
        if (user && user.id === result.data.user.id) setState({ user: result.data.user });
        setHeading(verifiedHeading);
      } else if (result.error.error === "token_expired") {
        setHeading(expiredHeading);
      } else {
        setHeading("This link is not valid. It may have been used already.");
      }
    });
  }, [token]);
  return (
    <Page class="split account-page">
      <AccountStage />
      <div class="column">
        {heading ? <h1>{heading}</h1> : <StatePanel>Checking your link…</StatePanel>}
        {heading === verifiedHeading && (
          <p>
            <Link href="/dashboard">Go to your dashboard</Link>
          </p>
        )}
        {heading === expiredHeading && (
          <p>
            <Link href="/signin">Sign in</Link>
          </p>
        )}
      </div>
    </Page>
  );
}

export function Shelf() {
  const [libraries, setLibraries] = useState<ShelfLibrary[] | null>(null);
  useEffect(() => {
    void api<{ libraries: ShelfLibrary[] }>("GET", "/api/shelf").then((result) => {
      if (result.ok) setLibraries(result.data.libraries);
    });
  }, []);
  return (
    <Page class="shelf-page">
      <h1>The shelf</h1>
      <p class="lede">Pens load libraries only from this pinned shelf, served by Ashlar itself.</p>
      {libraries === null ? (
        <StatePanel>Loading the shelf…</StatePanel>
      ) : (
        <table aria-label="Pinned libraries">
          <thead>
            <tr>
              <th scope="col">Library</th>
              <th scope="col">Version</th>
              <th scope="col">Global</th>
              <th scope="col">Licence</th>
              <th scope="col">Size (bytes)</th>
            </tr>
          </thead>
          <tbody>
            {libraries.map((library) => (
              <tr key={library.id}>
                <th scope="row">{library.name}</th>
                <td class="figure">{library.version}</td>
                <td>{library.global}</td>
                <td>{library.license}</td>
                <td class="figure">{library.bytes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}
