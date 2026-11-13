import { useEffect, useState } from "react";
import { ApiFailure, call, get } from "./api";
import { NotFound } from "./Screens";
import { Link, navigate } from "./router";
import type { Account, InviteInfo } from "../shared/types";

export function InvitePage({ token, me }: { token: string; me: Account | null }) {
  const [info, setInfo] = useState<InviteInfo | "missing" | null>(null);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    void get<InviteInfo>(`/api/invites/${token}`).then(setInfo, (error: unknown) => {
      if (error instanceof ApiFailure && error.status === 404) setInfo("missing");
      else throw error;
    });
  }, [token]);

  if (info === "missing") return <NotFound />;
  if (!info) return <main className="page narrow" aria-busy="true" />;
  const join = async (): Promise<void> => {
    try {
      const joined = await call<{ board_id: string }>("POST", `/api/invites/${token}/accept`);
      navigate(`/b/${joined.board_id}`);
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.status !== 410) throw error;
      setExpired(true);
    }
  };
  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <main className="page narrow">
      <Link href="/" className="brand">
        Pinsheet
      </Link>
      {info.expired || expired ? (
        <h1>This invite has expired.</h1>
      ) : (
        <>
          <h1>{info.board_title}</h1>
          <p>{`${info.inviter_name} invited you to this board.`}</p>
          {me ? (
            <button type="button" onClick={() => void join()}>
              Join board
            </button>
          ) : (
            <p className="row">
              <Link href={`/signin?next=${next}`} className="button">
                Sign in
              </Link>
              <Link href={`/signup?next=${next}`} className="button quiet">
                Create account
              </Link>
            </p>
          )}
        </>
      )}
    </main>
  );
}
