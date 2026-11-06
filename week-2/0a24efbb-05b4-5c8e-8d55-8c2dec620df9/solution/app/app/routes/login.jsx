import { useLoaderData } from "react-router";
import { Icon } from "../icons.jsx";
import { Page } from "../page.jsx";

const SCREEN = "Sign in to Rostara";
const ENDED = "Your session has ended. Sign in again.";
const UNAVAILABLE = "Sign-in is unavailable right now. Try again shortly.";

export function loader({ context }) {
  return context.login;
}

export default function LoginScreen() {
  const { next, ended, realm } = useLoaderData();
  const notice = ended ? ENDED : realm ? "" : UNAVAILABLE;
  return (
    <Page title={SCREEN} polite={notice} layout="gate">
      <section className="gate-card" aria-labelledby="login-title">
        <h1 id="login-title">{SCREEN}</h1>
        {notice && (
          <p className="callout info" data-notice>
            <Icon name="bell" />
            {notice}
          </p>
        )}
        <p className="callout danger" data-login-alert hidden />
        <form className="login" method="post" action="/api/session" data-login data-next={next ?? undefined} noValidate>
          <div className="field">
            <span className="label-row">
              <label className="label" htmlFor="login-address">Work address</label>
              <span className="req" id="login-address-req">Required</span>
            </span>
            <input id="login-address" name="work_address" type="email" autoComplete="username" required
              aria-required="true" aria-describedby="login-address-req" spellCheck={false} />
          </div>
          <div className="field">
            <span className="label-row">
              <label className="label" htmlFor="login-password">Password</label>
              <span className="req" id="login-password-req">Required</span>
            </span>
            <input id="login-password" name="password" type="password" autoComplete="current-password" required
              aria-required="true" aria-describedby="login-password-req" />
          </div>
          <button type="submit" className="btn primary wide" data-signin>
            <Icon name="user" />
            <span data-signin-label>Sign in</span>
          </button>
        </form>
      </section>
    </Page>
  );
}
