import { useState, type FormEvent } from "react";
import { TextField } from "../components/Fields";
import { ApiFail, api } from "../lib/api";
import { useParams } from "../lib/router";
import { afterSignIn, nextPath } from "./SignIn";
import "../styles/shop.css";

export function Register(_props: object) {
  const next = nextPath(useParams().get("next"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors({});
    setFailure(null);
    try {
      await api.post("/api/accounts", { name, email, password });
      await afterSignIn(next);
    } catch (thrown) {
      if (thrown instanceof ApiFail && thrown.status === 422) setErrors(thrown.fields);
      else setFailure(thrown instanceof ApiFail ? thrown.message : "Something went wrong on our side. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page">
      <div className="axis">
        <div className="zone" />
        <div className="main auth-form">
          <h1>Create an account</h1>
          {failure && (
            <div role="alert" className="notice tone-red">
              {failure}
            </div>
          )}
          <form onSubmit={(event) => void submit(event)} noValidate>
            <TextField name="name" label="Name" autoComplete="name" value={name} onChange={setName} error={errors.name} />
            <TextField name="email" label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} error={errors.email} />
            <TextField name="password" label="Password" type="password" role="textbox" autoComplete="new-password" value={password} onChange={setPassword} error={errors.password} />
            <p>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                Create account
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
