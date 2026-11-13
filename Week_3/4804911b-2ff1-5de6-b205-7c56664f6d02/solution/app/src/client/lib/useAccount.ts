import { useEffect, useRef } from "preact/hooks";
import type { Session } from "../../shared/types";
import { useEvery } from "./hooks";
import { ApiFailure, get, watchAuthorisation } from "./net";
import { navigate } from "./router";
import { discardHeld, endSession, homeFor, refreshSession, setSession, type Held } from "./session";

/**
 * Signed-in screens: any 401 ends the session (holding what was typed); any 403 forbidden, or a different account found
 * by the 5-second session read, moves the tab to that account's own screen with nothing of the former one.
 */
export function useAccountWatch(account: string, capture: () => Held | null): void {
  const grab = useRef(capture);
  grab.current = capture;
  const done = useRef(false);
  const toOwn = (s: Session | null) => {
    if (!s) return;
    discardHeld();
    setSession(s);
    navigate(homeFor(s), { replace: true });
  };
  useEffect(() => {
    done.current = false;
    watchAuthorisation((status) => {
      if (done.current) return;
      done.current = true;
      if (status === 401) endSession(() => grab.current());
      else void refreshSession().then(toOwn);
    });
    return () => watchAuthorisation(null);
  }, [account]);
  useEvery(5000, () => {
    if (done.current) return;
    void get<Session>("/api/session", { quiet: true })
      .then((s) => {
        if (s.accountId !== account && !done.current) {
          done.current = true;
          toOwn(s);
        }
      })
      .catch((error) => {
        if (error instanceof ApiFailure && error.status === 401 && !done.current) {
          done.current = true;
          endSession(() => grab.current());
        }
      });
  });
}
