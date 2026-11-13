// The expired, revoked and invalid link pages (brief: Feedback states > Access, links and sharing).
import { Logo } from '../art/Logo.tsx';
import { Link } from '../router.tsx';

export type LinkEndState = 'expired' | 'revoked' | 'invalid';

export const LINK_END_HEADINGS: Record<LinkEndState, string> = {
  expired: 'This link has expired.',
  revoked: 'This link was revoked by the owner.',
  invalid: 'This link is not valid.',
};

const ADVICE: Record<LinkEndState, string> = {
  expired: 'Ask the drafter who shared it for a new link.',
  revoked: 'Ask the drafter who shared it for a new link.',
  invalid: 'Check the address, or paste the link from your invite email.',
};

/** `timeZone` is the studio zone the link's expiry day was counted in; it is named on the expired page. */
export function LinkEnded({ state, timeZone }: { state: LinkEndState; timeZone?: string }) {
  return (
    <>
      <header className="public-header">
        <Link to="/" className="logo-link"><Logo /></Link>
      </header>
      <main className="public-main link-ended">
        <div className="public-panel">
          <h1>{LINK_END_HEADINGS[state]}</h1>
          <p className="lead">{ADVICE[state]}</p>
          {state === 'expired' && timeZone ? <p className="muted">Share links end at 11:59 PM in the studio time zone, {timeZone}.</p> : null}
          <div className="form-actions"><Link to="/open" className="btn btn-outline">Open a shared drawing</Link></div>
        </div>
      </main>
    </>
  );
}
