// Sign-up, sign-in, confirm and invite pages: one centred dark panel with a
// light form card.

import { h } from "../runtime";
import { useEffect, useState } from "preact/hooks";
import type { VNode } from "preact";
import { api, navigate } from "../runtime";
import type { ApiError } from "../runtime";
import { Field } from "../ui";

function useProblem() {
  const [problem, setProblem] = useState<{ message: string; field?: string } | null>(null);
  return { problem, setProblem };
}

function ProblemLink(p: { message: string; field?: string }): VNode {
  return h("div", { class: "alert-panel", role: "alert", "aria-label": "Problem" },
    h("a", {
      class: "link-action", href: "#",
      onClick: (e: Event) => {
        e.preventDefault();
        const el = p.field ? document.querySelector(`[aria-label="${CSS.escape(p.field)}"], [name="${p.field}"]`) : null;
        (el as HTMLElement | null)?.focus();
      },
    }, p.message));
}

export function SignUp(): VNode {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const { problem, setProblem } = useProblem();

  const submit = async () => {
    setBusy(true); setProblem(null);
    try {
      await api("/api/auth/sign-up", { method: "POST", body: JSON.stringify({ name, email, password }) });
      setNotice("Check your email to confirm your account");
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 503) setAlert("Email is unavailable. Your account was not created.");
      else setProblem({ message: err.message, field: err.body.field as string | undefined });
    } finally { setBusy(false); }
  };

  return h(AuthShell, { heading: "Create a workspace" },
    h("form", { onSubmit: (e: Event) => { e.preventDefault(); void submit(); } },
      problem ? h(ProblemLink, { message: problem.message, field: problem.field }) : null,
      alert ? h("div", { class: "alert-panel", role: "alert" }, h("p", {}, alert), h("button", { class: "link-action", onClick: () => setAlert(null) }, "Dismiss")) : null,
      h(Field, { label: "Name", value: name, onInput: setName }),
      h(Field, { label: "Email", value: email, onInput: setEmail, type: "email" }),
      h(Field, { label: "Password", value: password, onInput: setPassword, type: "password" }),
      h("button", { class: "pill-btn pill-primary", type: "submit", disabled: busy, "aria-busy": busy ? "true" : "false" }, busy ? "Working..." : "Create account"),
      notice ? h("p", { class: "ok-note", role: "status" }, notice) : null));
}

export function SignIn(): VNode {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const { problem, setProblem } = useProblem();

  const submit = async () => {
    setBusy(true); setProblem(null);
    try {
      const r = await api<{ workspace_id: string }>("/api/auth/sign-in", { method: "POST", body: JSON.stringify({ email, password }) });
      navigate(`/w/${r.workspace_id}`, true);
      location.reload();
    } catch (e) {
      const err = e as ApiError;
      setProblem({ message: err.message });
    } finally { setBusy(false); }
  };

  return h(AuthShell, { heading: "Sign in" },
    h("form", { onSubmit: (e: Event) => { e.preventDefault(); void submit(); } },
      problem ? h(ProblemLink, { message: problem.message }) : null,
      h(Field, { label: "Email", value: email, onInput: setEmail, type: "email" }),
      h(Field, { label: "Password", value: password, onInput: setPassword, type: "password" }),
      h("button", { class: "pill-btn pill-primary", type: "submit", disabled: busy, "aria-busy": busy ? "true" : "false" }, busy ? "Working..." : "Sign in")));
}

export function ConfirmPage(p: { token: string }): VNode {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<{ workspace_id: string }>("/api/auth/confirm", { method: "POST", body: JSON.stringify({ token: p.token }) })
      .then((r) => { navigate(`/w/${r.workspace_id}`, true); location.reload(); })
      .catch(() => setError("We couldn't find that page"));
  }, [p.token]);
  return h(AuthShell, { heading: "Confirming your email" },
    error ? h("p", { class: "ok-note" }, error) : h("p", { class: "ok-note" }, "Working..."));
}

export function InvitePage(p: { token: string }): VNode {
  const [info, setInfo] = useState<{ workspace_name: string; email: string; role: string; has_account: boolean } | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const { problem, setProblem } = useProblem();

  useEffect(() => {
    void api<{ workspace_name: string; email: string; role: string; has_account: boolean }>(`/api/invites/${encodeURIComponent(p.token)}`)
      .then(setInfo).catch(() => setMissing(true));
  }, [p.token]);

  if (missing) {
    return h(AuthShell, { heading: "We couldn't find that page" },
      h("p", {}, "It may have moved, or you may not have access to it."),
      h("a", { class: "link-action", href: "/", onClick: (e: Event) => { e.preventDefault(); navigate("/"); } }, "Back to start"));
  }
  if (!info) return h(AuthShell, { heading: "Join" }, h("p", { class: "ok-note" }, "Working..."));

  const submit = async () => {
    setBusy(true); setProblem(null);
    try {
      const r = await api<{ workspace_id: string }>(`/api/invites/${encodeURIComponent(p.token)}/accept`, {
        method: "POST", body: JSON.stringify({ name, password }),
      });
      navigate(`/w/${r.workspace_id}`, true);
      location.reload();
    } catch (e) {
      const err = e as ApiError;
      setProblem({ message: err.message, field: err.body.field as string | undefined });
    } finally { setBusy(false); }
  };

  return h(AuthShell, { heading: `Join ${info.workspace_name}` },
    h("form", { onSubmit: (e: Event) => { e.preventDefault(); void submit(); } },
      problem ? h(ProblemLink, { message: problem.message, field: problem.field }) : null,
      h("p", { class: "ok-note" }, `Invited as ${info.role}`),
      info.has_account ? null : h(Field, { label: "Name", value: name, onInput: setName }),
      h(Field, { label: "Password", value: password, onInput: setPassword, type: "password" }),
      h("button", { class: "pill-btn pill-primary", type: "submit", disabled: busy, "aria-busy": busy ? "true" : "false" }, busy ? "Working..." : "Join workspace")));
}

function AuthShell(p: { heading: string; children: VNode[] }): VNode {
  return h("div", { class: "auth-page" },
    h("div", { class: "dark-panel auth-panel" },
      h("h1", { class: "auth-heading" }, p.heading),
      h("div", { class: "form-card" }, p.children)));
}
