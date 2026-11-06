import { useState } from "react";
import { api, ApiCallError } from "../lib/api";
import type { User } from "../../shared/types";

export function VerifyPage({ onSignedIn }: { onSignedIn: (user: User, landing: string) => void }): React.ReactElement {
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const finish = async () => {
    if (pending) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? "";
    setPending(true);
    setStatus("Signing you in…");
    try {
      const res = await api<{ user: User; landing: string }>("POST", "/api/auth/verify", { token });
      if (res.data) {
        setDone(true);
        onSignedIn(res.data.user, res.data.landing);
      }
    } catch (err) {
      if (err instanceof ApiCallError) {
        if (err.code === "link_used") setStatus("This sign-in link has already been used. Request a new one.");
        else if (err.code === "link_expired") setStatus("This sign-in link has expired. Request a new one.");
        else if (err.code === "link_not_found") setStatus("This sign-in link isn't valid. Request a new one.");
        else setStatus("Something went wrong. Try again.");
      } else {
        setStatus("Something went wrong. Try again.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="signin-page">
      <main className="signin-card">
        <h1 className="product-name">Relay Bench</h1>
        <button onClick={finish} disabled={pending || done}>
          Finish signing in
        </button>
        <p className="status" role="status" aria-label="Sign-in status">
          {status}
        </p>
      </main>
    </div>
  );
}
