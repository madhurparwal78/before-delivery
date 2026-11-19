import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { messageOf } from "../lib/api.ts";
import { useHeadingFocus, useTitle } from "../lib/focus.ts";
import { navigate } from "../lib/router.tsx";
import { useSession } from "../lib/session.tsx";
import { Alert, Button } from "../ui/index.ts";
import "../admin/admin.css";

/** `/signin`: one centred cell with the sign-in form. */
export function SignIn(_props: { params: string[] }): ReactNode {
  const { me, signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTitle("Sign in");
  useHeadingFocus();

  useEffect(() => {
    if (me) navigate("/library", true);
  }, [me]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate("/library", true);
    } catch (failure) {
      setError(messageOf(failure));
      setPending(false);
    }
  }

  return (
    <form className="cell cell-pad auth-cell stack" data-frame noValidate onSubmit={(event) => void submit(event)}>
      <h1>Sign in</h1>
      <div className="field">
        <label htmlFor="signin-email">Email</label>
        <input id="signin-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="signin-password">Password</label>
        <input id="signin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      <Alert message={error} />
      <Button primary type="submit" pending={pending && "signIn"}>
        Sign in
      </Button>
    </form>
  );
}
