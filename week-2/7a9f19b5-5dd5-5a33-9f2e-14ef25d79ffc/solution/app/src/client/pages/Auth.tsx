import { useEffect, useId, useState, type FormEvent } from "react";
import type { User } from "../../shared/types";
import { request } from "../lib/api";
import { Link, navigate, previousPath, useLocation } from "../lib/router";
import { useSession } from "../lib/session";

/** Only in-app paths are followed after sign-in. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/catalogue";
}

export function SignIn() {
  const id = useId();
  const { search } = useLocation();
  const { signedIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Sign in · Lightfall";
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const reply = await request<{ user: User }>("/api/auth/signin", { method: "POST", body: { email, password } });
    setBusy(false);
    if (!reply.ok) {
      setError("Email or password is incorrect.");
      return;
    }
    signedIn(reply.data.user);
    const before = previousPath();
    navigate(safeNext(search.get("next") ?? (before && !/^\/sign(in|up)/.test(before) ? before : null)));
  };

  return (
    <div className="auth">
      <header className="page-head">
        <p className="eyebrow">Welcome back</p>
        <h1>Sign in</h1>
      </header>
      <form className="form-stack auth__form" onSubmit={(event) => void submit(event)} noValidate>
        {error && (
          <p role="alert" className="alert alert--inline">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor={`${id}-email`}>Email</label>
          <input id={`${id}-email`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-password`}>Password</label>
          <input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" className="button button--primary button--block" disabled={busy}>
          {busy ? "Signing in" : "Sign in"}
        </button>
        <p className="auth__switch">
          New to Lightfall? <Link href="/signup">Create an account</Link>
        </p>
      </form>
    </div>
  );
}

const OCCUPATIONS = [
  { label: "Electrician", value: "electrician" },
  { label: "Architect", value: "architect" },
  { label: "Lighting designer", value: "lighting_designer" },
  { label: "Wholesaler", value: "wholesaler" },
];

const SIGNUP_COPY: Record<string, string> = {
  email_taken: "An account with this email already exists.",
  nzbn: "Enter a 13-digit NZBN starting with 94.",
  password: "Use at least 10 characters.",
};

export function SignUp() {
  const id = useId();
  const { search } = useLocation();
  const { signedIn } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState<"retail" | "trade">(search.get("account") === "trade" ? "trade" : "retail");
  const [business, setBusiness] = useState("");
  const [nzbn, setNzbn] = useState("");
  const [occupation, setOccupation] = useState("electrician");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    document.title = "Create an account · Lightfall";
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: string[] = [];
    if (password.length < 10) found.push(SIGNUP_COPY.password!);
    if (accountType === "trade" && !/^94\d{11}$/.test(nzbn.trim())) found.push(SIGNUP_COPY.nzbn!);
    setErrors(found);
    if (found.length) return;
    setBusy(true);
    const reply = await request<{ user: User }>("/api/auth/signup", {
      method: "POST",
      body: {
        name,
        email,
        password,
        account_type: accountType,
        ...(accountType === "trade" ? { trade: { business_name: business, nzbn: nzbn.trim(), occupation } } : {}),
      },
    });
    setBusy(false);
    if (reply.ok) {
      signedIn(reply.data.user);
      navigate("/account");
      return;
    }
    if (reply.error.error === "email_taken") setErrors([SIGNUP_COPY.email_taken!]);
    else {
      const fieldErrors = reply.error.errors ?? {};
      setErrors(
        Object.keys(fieldErrors).map((field) =>
          field === "nzbn" ? SIGNUP_COPY.nzbn! : field === "password" ? SIGNUP_COPY.password! : "This field is required.",
        ),
      );
    }
  };

  return (
    <div className="auth">
      <header className="page-head">
        <p className="eyebrow">Retail or trade</p>
        <h1>Create an account</h1>
      </header>
      <form className="form-stack auth__form" onSubmit={(event) => void submit(event)} noValidate>
        {errors.length > 0 && (
          <div role="alert" className="alert alert--inline">
            {errors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-email`}>Email</label>
          <input id={`${id}-email`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-password`}>Password</label>
          <input id={`${id}-password`} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="field__hint">At least 10 characters.</p>
        </div>
        <fieldset role="radiogroup" aria-label="Account type" className="choice-group">
          <legend>Account type</legend>
          {(["retail", "trade"] as const).map((option) => (
            <label key={option} className="choice">
              <input type="radio" name={`${id}-type`} checked={accountType === option} onChange={() => setAccountType(option)} />
              <span>{option === "retail" ? "Retail customer" : "Trade"}</span>
            </label>
          ))}
        </fieldset>
        {accountType === "trade" && (
          <div className="form-stack trade-fields">
            <p className="form-note">Trade accounts see trade prices, projects and monthly account once our team approves the application.</p>
            <div className="field">
              <label htmlFor={`${id}-business`}>Business name</label>
              <input id={`${id}-business`} autoComplete="organization" value={business} onChange={(e) => setBusiness(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-nzbn`}>NZBN</label>
              <input id={`${id}-nzbn`} inputMode="numeric" maxLength={13} value={nzbn} onChange={(e) => setNzbn(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-occupation`}>Occupation</label>
              <select id={`${id}-occupation`} value={occupation} onChange={(e) => setOccupation(e.target.value)}>
                {OCCUPATIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <button type="submit" className="button button--primary button--block" disabled={busy}>
          {busy ? "Creating account" : "Create account"}
        </button>
        <p className="auth__switch">
          Already have an account? <Link href="/signin">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
