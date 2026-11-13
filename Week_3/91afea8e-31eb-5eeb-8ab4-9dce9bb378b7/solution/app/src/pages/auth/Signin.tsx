import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { post } from "../../lib/api";
import { useTitle } from "../../lib/hooks";
import { COPY, AuthShell, StatusLine, TextField, nextQuery, toIdentifier, useSubmit, type Message } from "./parts";

function arrivalMessage(state: unknown): Message {
  const reason = (state as { reason?: string } | null)?.reason;
  if (reason === "signed_out") return { tone: "info", text: COPY.signedOut };
  if (reason === "reset") return { tone: "info", text: COPY.passwordChanged };
  return { tone: "info", text: "" };
}

export default function Signin(): ReactNode {
  useTitle("sign in");
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [form, submit] = useSubmit();
  const arrived = arrivalMessage(location.state);
  const message = form.message.text ? form.message : arrived;

  const send = submit(async () => {
    const reply = await post<{ message: string; resend_in: number }>("/api/auth/signin", { identifier: toIdentifier(identifier), password });
    navigate(`/signin/code${nextQuery(params)}`, { state: { message: reply.message, deadline: Date.now() + reply.resend_in * 1000 } });
  });

  return (
    <AuthShell title="sign in.">
      <form className="stack" onSubmit={send} noValidate>
        <StatusLine message={message} />
        <TextField
          label="Email or phone"
          value={identifier}
          autoComplete="username"
          onChange={(event) => setIdentifier(event.target.value)}
          error={form.errors.identifier}
        />
        <TextField
          secret
          label="Password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          error={form.errors.password}
        />
        <div className="auth__actions">
          <Button type="submit" variant="primary" busy={form.busy}>
            Continue
          </Button>
          <Link to="/forgot">Forgot password?</Link>
        </div>
        <p className="muted">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </form>
    </AuthShell>
  );
}
