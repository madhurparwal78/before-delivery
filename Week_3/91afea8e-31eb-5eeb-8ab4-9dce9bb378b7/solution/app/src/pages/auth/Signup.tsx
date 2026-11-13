import { useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { post } from "../../lib/api";
import { useTitle } from "../../lib/hooks";
import { AuthShell, StatusLine, TextField, nextQuery, toIdentifier, useSubmit } from "./parts";

export default function Signup(): ReactNode {
  useTitle("sign up");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [form, submit] = useSubmit();

  const send = submit(async () => {
    const reply = await post<{ message: string }>("/api/auth/signup", { name, email: email.trim(), phone: toIdentifier(phone), password });
    navigate(`/signup/code${nextQuery(params)}`, { state: { message: reply.message } });
  });

  return (
    <AuthShell title="sign up.">
      <form className="stack" onSubmit={send} noValidate>
        <StatusLine message={form.message} />
        <TextField label="Name" value={name} autoComplete="name" onChange={(event) => setName(event.target.value)} error={form.errors.name} />
        <TextField label="Email" type="email" value={email} autoComplete="email" onChange={(event) => setEmail(event.target.value)} error={form.errors.email} />
        <TextField label="Phone" type="tel" value={phone} autoComplete="tel" onChange={(event) => setPhone(event.target.value)} error={form.errors.phone} />
        <TextField
          secret
          label="Password"
          value={password}
          autoComplete="new-password"
          onChange={(event) => setPassword(event.target.value)}
          error={form.errors.password}
        />
        <div className="auth__actions">
          <Button type="submit" variant="primary" busy={form.busy}>
            Create account
          </Button>
        </div>
        <p className="muted">
          <Link to={`/signin${nextQuery(params)}`}>I already have an account</Link>
        </p>
      </form>
    </AuthShell>
  );
}
