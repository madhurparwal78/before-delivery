import { useState } from "preact/hooks";
import { post } from "../../api";
import { showAlert, startPending } from "../../messages";
import { opsRefusal } from "../../ops";
import { navigate } from "../../router";
import { OPS_TEXT } from "../../../shared/copy";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = async (event: Event): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    startPending(OPS_TEXT.working);
    const result = await post("/api/ops/session", { email, password });
    setBusy(false);
    if (result.status === 204) {
      navigate("/ops/claims");
      return;
    }
    showAlert(opsRefusal(result));
  };

  return (
    <div class="column-form">
      <h1 class="plate-title">Operator sign-in</h1>
      <form noValidate onSubmit={(event) => void signIn(event)}>
        <div class="field">
          <label for="ops-email">Email</label>
          <input id="ops-email" type="email" autoComplete="username" value={email} onInput={(event) => setEmail(event.currentTarget.value)} />
        </div>
        <div class="field">
          <label for="ops-password">Password</label>
          <input id="ops-password" type="password" autoComplete="current-password" value={password} onInput={(event) => setPassword(event.currentTarget.value)} />
        </div>
        <button type="submit" class="primary" disabled={busy}>
          Sign in
        </button>
      </form>
    </div>
  );
}
