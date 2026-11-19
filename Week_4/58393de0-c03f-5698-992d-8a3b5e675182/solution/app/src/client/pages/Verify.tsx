import { useEffect, useRef, useState } from "react";
import { copy } from "../../shared/copy";
import type { Account } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { Link, useRouter } from "../lib/router";
import { homePath, useSession } from "../lib/session";
import { useStatus } from "../lib/status";
import "./pages.css";

type Outcome = { state: "checking" } | { state: "verified" } | { state: "failed"; message: string };

export default function Verify() {
  const { location } = useRouter();
  const { account, refresh } = useSession();
  const { announce } = useStatus();
  const [outcome, setOutcome] = useState<Outcome>({ state: "checking" });
  const token = location.search.get("token") ?? "";
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (started.current === token) return;
    started.current = token;
    const finish = (next: Outcome, message: string) => {
      setOutcome(next);
      announce(message);
    };
    if (!token) {
      finish({ state: "failed", message: copy.linkExpired }, copy.linkExpired);
      return;
    }
    api.post<{ account: Account }>("/api/auth/verify", { token }).then(
      async () => {
        await refresh();
        finish({ state: "verified" }, copy.verified);
      },
      (error: unknown) => {
        if (!(error instanceof ApiError)) throw error;
        finish({ state: "failed", message: error.message }, error.message);
      },
    );
  }, [token, announce, refresh]);

  const heading = outcome.state === "verified" ? copy.verified : outcome.state === "failed" ? outcome.message : "Checking your link…";
  return (
    <div className="column page-body">
      <div className="card auth-card" aria-busy={outcome.state === "checking"}>
        <h1>{heading}</h1>
        {outcome.state === "checking" ? null : account ? (
          <Link className="pill stretch-narrow" to={homePath(account)}>{account.kind === "educator" ? "Go to your dashboard" : "Go to your projects"}</Link>
        ) : (
          <Link className="pill stretch-narrow" to="/signin">Sign in</Link>
        )}
      </div>
    </div>
  );
}
