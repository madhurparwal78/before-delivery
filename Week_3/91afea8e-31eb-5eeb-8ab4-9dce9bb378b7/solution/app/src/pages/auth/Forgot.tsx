import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { post } from "../../lib/api";
import { useTitle } from "../../lib/hooks";
import { AuthShell, StatusLine, TextField, toIdentifier, useSubmit } from "./parts";

export default function Forgot(): ReactNode {
  useTitle("forgot password");
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [asked, setAsked] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [form, submit] = useSubmit();

  const ask = submit(async () => {
    const reply = await post<{ message: string }>("/api/auth/password/forgot", { identifier: toIdentifier(identifier) });
    setAsked(true);
    return { tone: "info", text: reply.message };
  });

  const reset = submit(async () => {
    await post("/api/auth/password/reset", { identifier: toIdentifier(identifier), code, new_password: password });
    navigate("/signin", { state: { reason: "reset" }, replace: true });
  });

  return (
    <AuthShell title="forgot your password.">
      <form className="stack" onSubmit={asked ? reset : ask} noValidate>
        <StatusLine message={form.message} />
        <TextField
          label="Email or phone"
          value={identifier}
          autoComplete="username"
          readOnly={asked}
          onChange={(event) => setIdentifier(event.target.value)}
          error={form.errors.identifier}
        />
        {asked && (
          <>
            <TextField
              label="6-digit code"
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              error={form.errors.code}
            />
            <TextField
              secret
              label="New password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
              error={form.errors.new_password}
            />
          </>
        )}
        <div className="auth__actions">
          <Button type="submit" variant="primary" busy={form.busy}>
            {asked ? "Reset password" : "Send code"}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
