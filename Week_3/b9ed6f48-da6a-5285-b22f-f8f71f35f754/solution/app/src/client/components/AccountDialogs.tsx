// Sign in and Create an account (brief: Public screens › Sign in; Feedback states › Accounts).

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiFailure, type User } from "../api.js";
import { useApp } from "../state.js";
import { Dialog } from "./Dialog.js";
import { ErrorSummary, Field, type FieldErrors } from "./ui.js";
import { COPY, copyFor } from "../../shared/copy.js";

type Mode = "sign-in" | "register" | null;

export function AccountDialogs() {
  const app = useApp();
  const [mode, setMode] = useState<Mode>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  useEffect(() => {
    if (app.dialog.kind === "sign-in") {
      setMode("sign-in");
      setErrors({});
      setMessage("");
    }
  }, [app.dialog]);

  const close = () => {
    setMode(null);
    app.closeDialog();
  };

  const fail = (error: unknown) => {
    if (error instanceof ApiFailure) {
      setErrors(error.error.fields ?? {});
      setMessage(error.error.fields ? "" : error.error.message);
      if (error.error.code === "accounts_unavailable") app.setServiceNotice(COPY.accountsDown);
    } else setMessage(COPY.accountsDown);
  };

  const submit = async (event: FormEvent, path: string, body: Record<string, string>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setMessage("");
    try {
      const { user } = await api<{ user: User }>(path, { body });
      await app.signedIn(user);
      app.announce(copyFor.signedIn(user.name));
      setForm({ name: "", email: "", password: "" });
      close();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const ids = { name: "account-name", email: mode === "register" ? "register-email" : "signin-email", password: mode === "register" ? "register-password" : "signin-password" };
  const update = (name: keyof typeof form) => (e: { currentTarget: HTMLInputElement }) => {
    const value = e.currentTarget.value;
    setForm((f) => ({ ...f, [name]: value }));
  };

  return (
    <>
      <Dialog open={mode === "sign-in"} label="Sign in" onClose={close} returnFocus={() => app.dialog.opener}>
        <h2>Sign in</h2>
        <p className="dialog-lede">Keep your path through the rooms, your bookmarks and your bookings.</p>
        <ErrorSummary errors={errors} message={message} ids={ids} />
        <form noValidate onSubmit={(e) => void submit(e, "/api/auth/login", { email: form.email, password: form.password })}>
          <Field id={ids.email} label="Email" type="email" autoComplete="email" value={form.email} onChange={update("email")} error={errors.email} data-autofocus />
          <Field id={ids.password} label="Password" type="password" autoComplete="current-password" value={form.password} onChange={update("password")} error={errors.password} />
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              Sign in
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                setErrors({});
                setMessage("");
                setMode("register");
              }}
            >
              Create an account
            </button>
          </div>
        </form>
      </Dialog>
      <Dialog open={mode === "register"} label="Create an account" onClose={close} returnFocus={() => app.dialog.opener}>
        <h2>Create an account</h2>
        <ErrorSummary errors={errors} message={message} ids={ids} />
        <form noValidate onSubmit={(e) => void submit(e, "/api/auth/register", form)}>
          <Field id={ids.name} label="Name" autoComplete="name" value={form.name} onChange={update("name")} error={errors.name} data-autofocus />
          <Field id={ids.email} label="Email" type="email" autoComplete="email" value={form.email} onChange={update("email")} error={errors.email} />
          <Field id={ids.password} label="Password" type="password" autoComplete="new-password" hint="10 to 72 characters." value={form.password} onChange={update("password")} error={errors.password} />
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              Create account
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
