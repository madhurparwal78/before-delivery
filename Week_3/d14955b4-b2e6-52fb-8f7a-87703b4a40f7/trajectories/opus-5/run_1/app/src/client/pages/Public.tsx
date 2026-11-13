import { COPY } from '../../shared/copy';
import { linkHandler } from '../lib/router';

export function PublicPage(): React.ReactElement {
  return (
    <div className="public-page">
      <div className="hero">
        <div className="hero-panel" />
        <div className="column hero-top">
          <a className="wordmark" href="/" onClick={linkHandler('/')}>
            Hushline
          </a>
          <nav className="hero-links" aria-label="Sections">
            <a href="#how-it-checks">How it checks</a>
            <a href="#the-widget">The widget</a>
            <a href="#security">Security</a>
            <a href="/signin" onClick={linkHandler('/signin')}>
              Sign in
            </a>
          </nav>
        </div>
        <svg
          className="hero-slab"
          viewBox="0 0 620 300"
          role="img"
          aria-label="A player message seen through Tamperglass"
          preserveAspectRatio="xMinYMid slice"
        >
          <polygon className="slab-body" points="8,46 596,6 614,250 26,286" />
          <polygon className="slab-edge" points="8,46 596,6 598,20 10,60" />
          <polygon className="slab-edge" points="26,286 614,250 613,238 25,274" />
          <line className="slab-rule" x1="48" y1="132" x2="400" y2="108" />
          <text className="slab-message" x="48" y="118">
            {COPY.heroSlabMessage}
          </text>
          <text className="slab-verdict" x="48" y="168">
            signature valid
          </text>
          <text className="slab-verdict" x="48" y="198">
            7 of 8
          </text>
          <text className="slab-verdict" x="48" y="228">
            nothing removed
          </text>
          <text className="slab-verdict" x="48" y="258">
            no link
          </text>
        </svg>
        <div className="column hero-text">
          <h1 className="hero-headline">
            <span>{COPY.heroHeadlineFirst}</span> <span className="muted">{COPY.heroHeadlineSecond}</span>
          </h1>
          <p className="hero-sentence">{COPY.heroSentence}</p>
          <a className="accent-button" href="/inbox" onClick={linkHandler('/inbox')}>
            Open the inbox
          </a>
        </div>
      </div>
      <main className="column public-sections">
        <section>
          <h2 id="how-it-checks">How it checks</h2>
          <p>
            Every player message and every signed game-server event lands in the thread already checked. The
            signature, the player's token bucket, the sanitiser and the first web link each leave a verdict.
          </p>
          <p>
            Tamperglass sits beside the thread and reads those verdicts back, exactly as they were stored when the
            message arrived.
          </p>
        </section>
        <section>
          <h2 id="the-widget">The widget</h2>
          <p>
            Players write from the help window in the game launcher. They are known by the launcher's signature, so
            there is no account to make and no password to lose.
          </p>
          <p>
            Purchases, refunds and match results arrive from the game server, so a question about a receipt is
            answered in the same thread.
          </p>
        </section>
        <section>
          <h2 id="security">Security</h2>
          <p>
            Pasted markup is removed before you read it, and a link preview is fetched only from a public address the
            request was pinned to.
          </p>
          <p>
            A player sees only their own thread. Attachments are served through Hushline alone, under a sandboxed
            content policy.
          </p>
        </section>
      </main>
      <footer className="column public-footer">{COPY.footer}</footer>
    </div>
  );
}
