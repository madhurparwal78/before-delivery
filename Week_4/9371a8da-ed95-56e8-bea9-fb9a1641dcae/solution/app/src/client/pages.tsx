import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { InvitePreview, ProjectSummary,TemplateId, User, Workspace } from "../shared/api.ts";
import { api, get, post } from "./api.ts";
import { Dialog, Field } from "./dialog.tsx";
import { navigate, safeNext, takeAccessNotice } from "./router.ts";
import { looksUnstorable } from "./text.ts";

const UNSTORABLE = "This text contains a character that cannot be stored.";

export function SignIn({ next }: { next: string | null }): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailField = useRef<HTMLInputElement>(null);

  // A signed-in visitor is sent on to Projects, replacing this entry.
  useLayoutEffect(() => {
    void get<{ user: User }>("/api/me")
      .then((answer) => {
        if (answer.ok) navigate("/", true);
      })
      .catch(() => undefined);
  }, []);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const answer = await post<{ user: User }>("/api/session", { email, password });
      if (answer.ok) {
        navigate(safeNext(next), true);
        return;
      }
      setError(answer.status === 401 ? "Email or password is incorrect." : "Something went wrong. Try again.");
      emailField.current?.focus();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main class="paper-page">
      <form class="sign-in" onSubmit={submit} noValidate>
        <p class="brand">Quillwork Labs · Marginalia</p>
        <h1>Sign in to Marginalia</h1>
        <div class="field">
          <label for="signin-email">Email</label>
          <input ref={emailField} id="signin-email" type="email" autocomplete="username" value={email}
            aria-describedby={error ? "signin-error" : undefined} aria-invalid={error ? "true" : undefined}
            onInput={(e) => setEmail(e.currentTarget.value)} />
        </div>
        <div class="field">
          <label for="signin-password">Password</label>
          <input id="signin-password" type="password" autocomplete="current-password" value={password}
            aria-describedby={error ? "signin-error" : undefined} aria-invalid={error ? "true" : undefined}
            onInput={(e) => setPassword(e.currentTarget.value)} />
          {error ? <p class="field-error" id="signin-error">{error}</p> : null}
        </div>
        <button type="submit" class="primary" disabled={pending} aria-busy={pending ? "true" : undefined}>
          Sign in
        </button>
      </form>
    </main>
  );
}

interface Me {
  user: User;
  workspace: Workspace | null;
}

export function Projects(): JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [notice] = useState(() => takeAccessNotice());
  const [dialog, setDialog] = useState<"profile" | "new" | null>(null);

  const load = async () => {
    try {
      const who = await get<Me>("/api/me");
      if (!who.ok) {
        if (who.status === 401) navigate("/signin", true);
        return;
      }
      setMe(who.data);
      const list = await get<{ projects: ProjectSummary[] }>("/api/projects");
      if (list.ok) setProjects(list.data.projects);
    } catch {
      /* a dropped connection leaves the page as it is */
    }
  };
  useLayoutEffect(() => {
    void load();
  }, []);

  const signOut = async () => {
    try {
      await api("DELETE", "/api/session");
    } finally {
      navigate("/signin");
    }
  };

  return (
    <div class="paper-page projects-page">
      <header class="page-header">
        <p class="brand">Marginalia</p>
        <div class="header-actions">
          {me ? (
            <button type="button" class="quiet" onClick={() => setDialog("profile")}>
              {me.user.displayName}
            </button>
          ) : null}
          <button type="button" class="quiet" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main class="projects-main">
        <div class="title-row">
          <h1>Projects</h1>
          {me?.workspace?.role === "owner" ? (
            <button type="button" class="primary" onClick={() => setDialog("new")}>
              New project
            </button>
          ) : null}
        </div>
        <div role="status" aria-label="Access notice" class="access-notice">
          {notice ?? ""}
        </div>
        {projects === null ? (
          <p class="muted">Loading projects…</p>
        ) : projects.length === 0 ? (
          <p class="muted">You are not a member of any project yet.</p>
        ) : (
          <ul class="project-list">
            {projects.map((project) => (
              <li key={project.id}>
                <a href={`/p/${project.id}`} onClick={(e) => { e.preventDefault(); navigate(`/p/${project.id}`); }}>
                  {project.title}
                </a>{" "}
                <span class="role-word">{project.role}</span>{" "}
                <span class="rev">r{project.projectRevision}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
      {dialog === "profile" && me ? (
        <ProfileDialog user={me.user} onClose={() => setDialog(null)} onSaved={(user) => setMe({ ...me, user })} />
      ) : null}
      {dialog === "new" ? <NewProjectDialog onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function ProfileDialog(props: { user: User; onClose: () => void; onSaved: (user: User) => void }): JSX.Element {
  const [name, setName] = useState(props.user.displayName);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const submit = async (event: Event) => {
    event.preventDefault();
    setPending(true);
    try {
      const answer = await api<{ user: User }>("PATCH", "/api/me", { displayName: name });
      if (answer.ok) {
        setError(null);
        props.onSaved(answer.data.user);
        setMessage("Display name saved.");
      } else if (answer.status === 422) {
        setError(looksUnstorable(name) ? UNSTORABLE : "Enter a display name of 1 to 80 characters.");
        field.current?.focus();
      } else setMessage("Something went wrong. Try again.");
    } catch {
      setMessage("Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog title="Profile" onClose={props.onClose}>
      <form onSubmit={submit} noValidate>
        <Field id="profile-name" label="Display name" error={error}>
          {(described) => (
            <input ref={field} id="profile-name" type="text" value={name} aria-describedby={described}
              aria-invalid={error ? "true" : undefined} onInput={(e) => setName(e.currentTarget.value)} />
          )}
        </Field>
        <p class="dialog-note" role="status">{message}</p>
        <div class="dialog-actions">
          <button type="submit" class="primary" disabled={pending} aria-busy={pending ? "true" : undefined}>
            Save name
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const TEMPLATES: { id: TemplateId; name: string }[] = [
  { id: "thesis-numbered", name: "Thesis, numbered chapters" },
  { id: "article-single", name: "Article, single file" },
];

function NewProjectDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<TemplateId>("thesis-numbered");
  const [errors, setErrors] = useState<{ title?: string; template?: string; form?: string }>({});
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const submit = async (event: Event) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const answer = await post<{ project: ProjectSummary }>("/api/projects", { title, template });
      if (answer.ok) {
        navigate(`/p/${answer.data.project.id}?file=main.tex`);
        return;
      }
      if (answer.status === 422) {
        const fields = answer.error.errors ?? {};
        setErrors({
          ...(fields.title ? { title: looksUnstorable(title) ? UNSTORABLE : "Enter a title of 1 to 120 characters." } : {}),
          ...(fields.template ? { template: "Choose a template." } : {}),
        });
        field.current?.focus();
      } else setErrors({ form: answer.status === 403 ? "Only workspace owners create projects." : "Something went wrong. Try again." });
    } catch {
      setErrors({ form: "Something went wrong. Try again." });
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog title="New project" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Field id="project-title" label="Title" error={errors.title ?? null}>
          {(described) => (
            <input ref={field} id="project-title" type="text" value={title} aria-describedby={described}
              aria-invalid={errors.title ? "true" : undefined} onInput={(e) => setTitle(e.currentTarget.value)} />
          )}
        </Field>
        <div role="radiogroup" aria-labelledby="template-label" class="radio-group">
          <p id="template-label" class="group-label">Template</p>
          {TEMPLATES.map((item) => (
            <label key={item.id} class="radio">
              <input type="radio" name="template" value={item.id} checked={template === item.id}
                onChange={() => setTemplate(item.id)} />
              <span>{item.name}</span>
            </label>
          ))}
          {errors.template ? <p class="field-error">{errors.template}</p> : null}
        </div>
        {errors.form ? <p class="field-error">{errors.form}</p> : null}
        <div class="dialog-actions">
          <button type="submit" class="primary" disabled={pending} aria-busy={pending ? "true" : undefined}>
            Create project
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function InvitePage({ token }: { token: string }): JSX.Element {
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [state, setState] = useState<"loading" | "open" | "gone">("loading");
  const [memberOf, setMemberOf] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ displayName?: string; password?: string; form?: string }>({});
  const [pending, setPending] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    void (async () => {
      try {
        const answer = await get<{ invite: InvitePreview }>(`/api/invites/${encodeURIComponent(token)}`);
        if (answer.ok) {
          setInvite(answer.data.invite);
          setState("open");
        } else setState("gone");
      } catch {
        setState("gone");
      }
    })();
  }, [token]);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      const answer = await post<{ projectId: string }>(`/api/invites/${encodeURIComponent(token)}/accept`, {
        displayName: name,
        password,
      });
      if (answer.ok) {
        navigate(`/p/${answer.data.projectId}`, true);
        return;
      }
      if (answer.status === 410 || answer.status === 404) {
        setState("gone");
        return;
      }
      if (answer.status === 401) {
        setErrors({ password: "That password does not match this account." });
        passwordField.current?.focus();
      } else if (answer.status === 422) {
        const fields = answer.error.errors ?? {};
        const next: typeof errors = {};
        if (fields.displayName) next.displayName = looksUnstorable(name) ? UNSTORABLE : "Enter a display name of 1 to 80 characters.";
        if (fields.password) next.password = "Use at least 10 characters.";
        setErrors(next);
        (next.displayName ? nameField : passwordField).current?.focus();
      } else if (answer.status === 409 && answer.error.projectId) {
        setMemberOf(answer.error.projectId);
      } else setErrors({ form: "Something went wrong. Try again." });
    } catch {
      setErrors({ form: "Something went wrong. Try again." });
    } finally {
      setPending(false);
    }
  };

  if (state === "loading") return <main class="paper-page"><p class="muted">Loading invitation…</p></main>;
  if (state === "gone" || !invite) {
    return (
      <main class="paper-page">
        <div class="sign-in">
          <h1>This invitation is no longer valid</h1>
          <p class="muted">Ask the project owner to send a new invitation.</p>
        </div>
      </main>
    );
  }
  if (memberOf) {
    const href = `/p/${memberOf}?file=main.tex`;
    return (
      <main class="paper-page">
        <div class="sign-in">
          <p class="brand">Marginalia</p>
          <h1>Join {invite.projectTitle}</h1>
          <p>{`You already belong to ${invite.projectTitle}.`}</p>
          <p>
            <a href={href} onClick={(e) => { e.preventDefault(); navigate(href); }}>Open {invite.projectTitle}</a>
          </p>
        </div>
      </main>
    );
  }
  return (
    <main class="paper-page">
      <form class="sign-in" onSubmit={submit} noValidate>
        <p class="brand">Marginalia</p>
        <h1>Join {invite.projectTitle}</h1>
        <p>{`${invite.inviterName} invited you to join as ${invite.role}.`}</p>
        <Field id="invite-name" label="Display name" error={errors.displayName ?? null}>
          {(described) => (
            <input ref={nameField} id="invite-name" type="text" value={name} autocomplete="name"
              aria-describedby={described} aria-invalid={errors.displayName ? "true" : undefined}
              onInput={(e) => setName(e.currentTarget.value)} />
          )}
        </Field>
        <Field id="invite-password" label="Password" error={errors.password ?? null}>
          {(described) => (
            <input ref={passwordField} id="invite-password" type="password" value={password} autocomplete="new-password"
              aria-describedby={described ? `${described} invite-hint` : "invite-hint"} aria-invalid={errors.password ? "true" : undefined}
              onInput={(e) => setPassword(e.currentTarget.value)} />
          )}
        </Field>
        <p class="hint" id="invite-hint">
          If you already use Marginalia, enter your existing password; your display name stays as it is.
        </p>
        {errors.form ? <p class="field-error">{errors.form}</p> : null}
        <button type="submit" class="primary" disabled={pending} aria-busy={pending ? "true" : undefined}>
          Accept invitation
        </button>
      </form>
    </main>
  );
}

export function NotFound(): JSX.Element {
  return (
    <main class="paper-page">
      <div class="sign-in">
        <h1>Page not found</h1>
        <p>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>Go to Projects</a>
        </p>
      </div>
    </main>
  );
}
