import { useState, type MouseEvent } from "react";
import { ERRORS } from "../../../shared/copy.js";
import { Alert, playMotion } from "../ui.js";

const LOGIN = "/auth/login";

/** The way in: checks the identity service answers before leaving, so its outage shows here instead of on a blank page. */
export const SignIn = () => {
  const [refused, setRefused] = useState("");
  const start = async (event: MouseEvent<HTMLAnchorElement>): Promise<void> => {
    event.preventDefault();
    playMotion(event.currentTarget, "press");
    const reply = await fetch(LOGIN, { redirect: "manual" }).catch(() => null);
    if (reply?.status === 503) {
      setRefused(ERRORS.identity_unreachable.message());
      return;
    }
    location.assign(LOGIN);
  };
  return (
    <div className="staff-signin">
      <a className="btn btn--primary" href={LOGIN} data-motion="press" onClick={(event) => void start(event)}>Staff sign-in</a>
      {refused ? <Alert label="Sign-in message" className="error">{refused}</Alert> : null}
    </div>
  );
};
