import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiFailure } from "../api.ts";
import type { Account } from "../../shared/types.ts";
import { Modal } from "./Modal.tsx";

const BOOTH_BODY = "Build the set in a browser. Play it on any screen in the room.";

function Emblem() {
  const hexagon = (radius: number): string =>
    Array.from({ length: 6 }, (_value, i) => {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      return `${(60 + radius * Math.cos(angle)).toFixed(1)},${(60 + radius * Math.sin(angle)).toFixed(1)}`;
    }).join(" ");
  return (
    <svg className="emblem" width="96" height="96" viewBox="0 0 120 120" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
      {[52, 40, 28, 16].map((radius) => <polygon key={radius} points={hexagon(radius)} />)}
    </svg>
  );
}

type Mode = "welcome" | "signin" | "signup";

export function Booth({ initial = "welcome", onClose, onAuthed }: { initial?: Mode; onClose: () => void; onAuthed: (user: Account) => void }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    form.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [mode]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string): string => String(data.get(name) ?? "");
    setBusy(true);
    try {
      const { user } =
        mode === "signup"
          ? await api.signup({ email: text("email"), password: text("password"), display_name: text("display_name") })
          : await api.login({ email: text("email"), password: text("password") });
      onAuthed(user);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code === "validation") setFields(error.detail.fields ?? {});
      else if (error.code === "email_taken") setFields({ email: error.message });
      else setFields({ password: error.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Afterglass" plain className="booth" onClose={onClose}>
      {(titleId) => (
        <>
          <Emblem />
          <h2 id={titleId} className="modal-title">Afterglass</h2>
          <p className="booth-body">{BOOTH_BODY}</p>
          {mode === "welcome" ? (
            <p className="booth-links">
              <a href="#sign-in" onClick={(event) => { event.preventDefault(); setMode("signin"); }}>Sign in</a>
              <a href="#create-account" onClick={(event) => { event.preventDefault(); setMode("signup"); }}>Create account</a>
            </p>
          ) : (
            <form ref={form} className="booth-form" noValidate onSubmit={(event) => void submit(event)} onChange={() => setFields({})}>
              <label className="row">
                <span className="row-label">Email</span>
                <span className="row-value">
                  <input role="textbox" className="text-input" name="email" type="text" aria-label="Email" autoComplete="email" data-autofocus aria-invalid={fields["email"] ? true : undefined} />
                  {fields["email"] ? <span className="field-error">{fields["email"]}</span> : null}
                </span>
              </label>
              <label className="row">
                <span className="row-label">Password</span>
                <span className="row-value">
                  <input role="textbox" className="text-input" name="password" type="password" aria-label="Password" autoComplete={mode === "signup" ? "new-password" : "current-password"} aria-invalid={fields["password"] ? true : undefined} />
                  {fields["password"] ? <span className="field-error">{fields["password"]}</span> : null}
                </span>
              </label>
              {mode === "signup" ? (
                <label className="row">
                  <span className="row-label">Name</span>
                  <span className="row-value">
                    <input role="textbox" className="text-input" name="display_name" type="text" aria-label="Display name" autoComplete="nickname" aria-invalid={fields["display_name"] ? true : undefined} />
                    {fields["display_name"] ? <span className="field-error">{fields["display_name"]}</span> : null}
                  </span>
                </label>
              ) : null}
              <div className="booth-actions">
                <button type="submit" className="btn" disabled={busy}>{mode === "signup" ? "Create account" : "Sign in"}</button>
                <a href={mode === "signup" ? "#sign-in" : "#create-account"} onClick={(event) => { event.preventDefault(); setFields({}); setMode(mode === "signup" ? "signin" : "signup"); }}>
                  {mode === "signup" ? "I already have an account" : "I need an account"}
                </a>
              </div>
            </form>
          )}
          <button type="button" className="btn booth-close" onClick={onClose}>Close</button>
        </>
      )}
    </Modal>
  );
}

export function JoinDialog({ name, role, onJoin, onClose, problem }: { name: string; role: string; onJoin: () => void; onClose: () => void; problem: string }) {
  return (
    <Modal title={`Join ${name}`} plain className="booth" onClose={onClose}>
      {(titleId) => (
        <>
          <Emblem />
          <h2 id={titleId} className="modal-title">Join {name}</h2>
          <p className="booth-body">You are invited to this set as {role === "viewer" ? "a viewer" : "an editor"}.</p>
          {problem ? <p className="field-error centered">{problem}</p> : null}
          <div className="booth-actions centered">
            <button type="button" className="btn" data-autofocus onClick={onJoin}>Join as {role}</button>
          </div>
          <button type="button" className="btn booth-close" onClick={onClose}>Close</button>
        </>
      )}
    </Modal>
  );
}

export function UsedInvite({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Afterglass" plain className="booth" onClose={onClose}>
      {(titleId) => (
        <>
          <Emblem />
          <h2 id={titleId} className="modal-title">Afterglass</h2>
          <p className="booth-body">This invite link has already been used</p>
          <button type="button" className="btn booth-close" data-autofocus onClick={onClose}>Close</button>
        </>
      )}
    </Modal>
  );
}
