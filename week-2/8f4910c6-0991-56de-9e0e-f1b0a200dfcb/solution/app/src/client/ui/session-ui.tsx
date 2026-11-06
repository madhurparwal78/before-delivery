// "Sign in again" and the ended-session banner the workspace shell shows.

import { Link } from "../router.js";
import { ACCESS_REMOVED_COPY, SESSION_ENDED_COPY, signInAgainHref, useSession } from "../session.js";

export function SignInAgain() {
  return <Link href={signInAgainHref()} className="btn">Sign in again</Link>;
}

export function SessionBanner() {
  const { problem } = useSession();
  if (!problem) return null;
  return (
    <div className="session-banner">
      <p>{problem === "access_removed" ? ACCESS_REMOVED_COPY : SESSION_ENDED_COPY}</p>
      {problem === "session_ended" ? <SignInAgain /> : null}
    </div>
  );
}
