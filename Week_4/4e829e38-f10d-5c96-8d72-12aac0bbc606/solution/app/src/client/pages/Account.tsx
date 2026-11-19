import { useRef, useState } from "preact/hooks";
import { api } from "../api";
import { Icon } from "../icons";
import { navigate, useRoute } from "../router";
import { announce, session, unreadStore } from "../store";
import type { Me } from "../types";
import { FieldError, Pill, Status, useBusy } from "../ui";

const sentence = (errors: Record<string, string>, key: string) => errors[key];

function Field({ id, label, type = "text", value, onInput, error, autocomplete }: {
  id: string; label: string; type?: string; value: string; onInput: (v: string) => void; error?: string; autocomplete?: string;
}) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input id={id} type={type as "text"} value={value} autocomplete={autocomplete as "off"} aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : undefined} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
      <FieldError id={`${id}-error`} text={error} />
    </div>
  );
}

export function Account({ me }: { me: Me | null }) {
  const route = useRoute();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(route.query.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [signupErrors, setSignupErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [signinEmail, setSigninEmail] = useState("");
  const [signinPassword, setSigninPassword] = useState("");
  const [signinError, setSigninError] = useState("");
  const [team, setTeam] = useState("");
  const [teamError, setTeamError] = useState("");
  const [signingUp, runSignup] = useBusy();
  const [verifying, runVerify] = useBusy();
  const [signingIn, runSignin] = useBusy();
  const [joining, runJoin] = useBusy();
  const verifyBox = useRef<HTMLInputElement>(null);

  const signUp = (event: Event) => {
    event.preventDefault();
    void runSignup(async () => {
      const result = await api("POST", "/api/signup", { name, email, password });
      setSignupErrors(result.errors);
      if (result.ok) {
        setPending(email);
        announce("Account status", `We sent a 6-digit code to ${email}`);
        queueMicrotask(() => verifyBox.current?.focus());
      }
    });
  };
  const verify = (event: Event) => {
    event.preventDefault();
    void runVerify(async () => {
      const result = await api("POST", "/api/verify", { email: pending ?? email, code });
      setCodeError(result.errors.code ?? "");
      if (result.ok) announce("Account status", "Email verified");
    });
  };
  const signIn = (event: Event) => {
    event.preventDefault();
    void runSignin(async () => {
      const result = await api<Me>("POST", "/api/signin", { email: signinEmail, password: signinPassword });
      if (!result.ok) {
        setSigninError("That email and password do not match");
        return;
      }
      setSigninError("");
      const profile = await api<Me>("GET", "/api/me");
      if (profile.ok) {
        session.set(profile.data);
        unreadStore.set(0);
        announce("Account status", `Signed in as ${profile.data.name}`);
        if (profile.data.teams.length) navigate("/");
      }
    });
  };
  const join = (event: Event) => {
    event.preventDefault();
    void runJoin(async () => {
      const result = await api<{ teamId: string; name: string }>("POST", "/api/teams/join", { code: team });
      if (result.ok) {
        setTeamError("");
        announce("Account status", `You joined ${result.data.name}`);
        const profile = await api<Me>("GET", "/api/me");
        if (profile.ok) session.set(profile.data);
      } else if (result.code === "not_verified") {
        setTeamError("Verify your email before joining a team");
        announce("Account status", "Verify your email before joining a team");
      } else if (result.status === 401) {
        setTeamError("Sign in before joining a team");
      } else {
        setTeamError("That team code is not right");
      }
    });
  };

  return (
    <div class="page narrow account-page">
      <h1>Account</h1>
      <Status name="Account status" visible />
      <section class="card form-card" aria-labelledby="signup-title">
        <h2 id="signup-title">Create an account</h2>
        <form onSubmit={signUp} noValidate>
          <Field id="signup-name" label="Name" value={name} onInput={setName} error={sentence(signupErrors, "name")} autocomplete="name" />
          <Field id="signup-email" label="Email" type="email" value={email} onInput={setEmail} error={sentence(signupErrors, "email")} autocomplete="email" />
          <Field id="signup-password" label="Password" type="password" value={password} onInput={setPassword} error={sentence(signupErrors, "password")} autocomplete="new-password" />
          <Pill type="submit" busy={signingUp} onClick={signUp}>Create account</Pill>
        </form>
      </section>
      <section class="card form-card" aria-labelledby="verify-title">
        <h2 id="verify-title">Verify your email</h2>
        <form onSubmit={verify} noValidate>
          <div class="field">
            <label for="verify-code">Verification code</label>
            <input id="verify-code" ref={verifyBox} inputMode="numeric" autocomplete="one-time-code" value={code}
              aria-invalid={codeError ? "true" : undefined} aria-describedby={codeError ? "verify-code-error" : undefined}
              onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
            <FieldError id="verify-code-error" text={codeError} />
          </div>
          <Pill type="submit" busy={verifying} onClick={verify}>Verify</Pill>
        </form>
      </section>
      <section class="card form-card" aria-labelledby="signin-title">
        <h2 id="signin-title">Sign in</h2>
        <form onSubmit={signIn} noValidate>
          <Field id="signin-email" label="Sign-in email" type="email" value={signinEmail} onInput={setSigninEmail} autocomplete="username" />
          <Field id="signin-password" label="Sign-in password" type="password" value={signinPassword} onInput={setSigninPassword} error={signinError} autocomplete="current-password" />
          <Pill type="submit" busy={signingIn} onClick={signIn}>Sign in</Pill>
        </form>
      </section>
      <section class="card form-card" aria-labelledby="join-title">
        <h2 id="join-title">Join a team</h2>
        <form onSubmit={join} noValidate>
          <Field id="team-code" label="Team code" value={team} onInput={setTeam} error={teamError} />
          <Pill type="submit" busy={joining} onClick={join}><Icon name="user" size={18} />Join team</Pill>
        </form>
        {me && <p class="muted">Signed in as {me.name}. Teams: {me.teams.map((t) => t.name).join(", ") || "none yet"}.</p>}
      </section>
    </div>
  );
}
