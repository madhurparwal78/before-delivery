import { useId, useState, type FormEvent } from "react";
import type { Account } from "../../shared/types";
import { copy } from "../../shared/copy";
import { Field } from "../forms/Field";
import { fieldErrors } from "../forms/fields";
import { api, ApiError } from "../lib/api";
import { useNotices } from "../lib/notices";
import { Link, useRouter } from "../lib/router";
import { homePath, useSession } from "../lib/session";
import { useStatus } from "../lib/status";
import "./pages.css";

type AccountType = "educator" | "personal";
type SignupField = "displayName" | "email" | "password";

const MAIL_UNAVAILABLE_NOTICE_ID = "mail-unavailable";

export default function Signup() {
  const { location, navigate } = useRouter();
  const { setAccount } = useSession();
  const { announce } = useStatus();
  const { setNotice } = useNotices();
  const typeLabel = useId();
  const [accountType, setAccountType] = useState<AccountType>(location.search.get("type") === "educator" ? "educator" : "personal");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Partial<Record<SignupField, string>>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      const created = await api.post<{ account: Account; verificationEmailSent: boolean }>("/api/auth/signup", {
        email: email.trim(), password, displayName: displayName.trim(), accountType,
      });
      setAccount(created.account);
      if (!created.verificationEmailSent) setNotice({ id: MAIL_UNAVAILABLE_NOTICE_ID, message: copy.mailUnavailable });
      navigate(homePath(created.account));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const found = error.code === "email_taken" ? { email: error.message } : fieldErrors(error, ["displayName", "email", "password"]);
      setErrors(found);
      const messages = Object.values(found);
      announce(messages.length > 0 ? messages.join(" ") : error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="column page-body">
      <form className="card auth-card" onSubmit={(event) => void submit(event)} noValidate>
        <h1>Create your account</h1>
        <p className="hint">Educators run classrooms. Personal makers design at home. Both verify their email.</p>
        <Field label="Name" error={errors.displayName}>
          {(control) => <input {...control} type="text" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(control) => <input {...control} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Password" error={errors.password} hint="At least 10 characters.">
          {(control) => <input {...control} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <div className="field">
          <span className="label" id={typeLabel}>Account type</span>
          <div className="radio-row" role="radiogroup" aria-labelledby={typeLabel}>
            <label>
              <input type="radio" name="account-type" value="educator" checked={accountType === "educator"} onChange={() => setAccountType("educator")} />
              Educator
            </label>
            <label>
              <input type="radio" name="account-type" value="personal" checked={accountType === "personal"} onChange={() => setAccountType("personal")} />
              Personal maker
            </label>
          </div>
        </div>
        <button className="pill stretch-narrow" type="submit" disabled={busy}>Create account</button>
        <p className="hint auth-switch">Already have an account? <Link to="/signin">Sign in</Link></p>
      </form>
    </div>
  );
}
