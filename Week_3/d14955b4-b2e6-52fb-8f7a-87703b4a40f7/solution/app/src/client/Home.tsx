import { useEffect } from 'react';
import { Link } from './WorkspacePage.js';

function Slab() {
  return (
    <svg className="slab" viewBox="0 0 900 340" role="img" aria-label="A player message seen through Tamperglass" preserveAspectRatio="xMinYMid meet">
      <defs>
        <linearGradient id="slab-sheen" x1="0" y1="0" x2="1" y2="0.45">
          <stop offset="0" stopColor="#1B46C9" stopOpacity="0.8" />
          <stop offset="0.38" stopColor="#1B46C9" stopOpacity="0.75" />
          <stop offset="0.52" stopColor="#1B46C9" stopOpacity="0.8" />
          <stop offset="1" stopColor="#1B46C9" stopOpacity="0.77" />
        </linearGradient>
      </defs>
      <rect width="900" height="340" fill="url(#slab-sheen)" />
      <rect width="900" height="170" fill="#1B46C9" fillOpacity="0.1" />
      <rect x="12" y="12" width="876" height="316" fill="none" stroke="#1B46C9" strokeWidth="2" />
      <g className="slab-wide">
        <text x="40" y="96" className="slab-message">i never got the lantern pack</text>
        <text x="40" y="160" className="slab-line">signature valid</text>
        <text x="40" y="206" className="slab-line">7 of 8</text>
        <text x="40" y="252" className="slab-line">nothing removed</text>
        <text x="40" y="298" className="slab-line">no link</text>
      </g>
      <g className="slab-narrow">
        <text x="36" y="76" className="slab-message">i never got</text>
        <text x="36" y="112" className="slab-message">the lantern</text>
        <text x="36" y="148" className="slab-message">pack</text>
        <text x="36" y="196" className="slab-line">signature valid</text>
        <text x="36" y="228" className="slab-line">7 of 8</text>
        <text x="36" y="260" className="slab-line">nothing removed</text>
        <text x="36" y="292" className="slab-line">no link</text>
      </g>
    </svg>
  );
}

export function HomePage() {
  useEffect(() => {
    document.title = 'Hushline';
  }, []);
  return (
    <>
      <div className="hero">
        <div className="hero-panel">
          <div className="panel-row">
            <Link href="/" className="wordmark">Hushline</Link>
            <a href="#how-it-checks">How it checks</a>
            <a href="#the-widget">The widget</a>
            <a href="#security">Security</a>
            <Link href="/signin">Sign in</Link>
          </div>
        </div>
        <Slab />
        <h1 className="hero-title">
          <span>Every message,</span> <span className="hero-second">already checked.</span>
        </h1>
      </div>
      <main className="home">
        <div className="column">
          <p className="invitation">Answer your players from inside the game, with every purchase, match and pasted link checked before you read it.</p>
          <Link href="/inbox" className="button primary small">Open the inbox</Link>
          <section id="how-it-checks">
            <h2>How it checks</h2>
            <p>Every player message and game-server event lands in the thread already checked. Beside it sits Tamperglass, which shows the signature, the bucket, the sanitiser and the link, each as a short sentence.</p>
            <p>Signed purchases are compared with the game server's own record, so you can answer whether something really happened without leaving the thread.</p>
          </section>
          <section id="the-widget">
            <h2>The widget</h2>
            <p>Players write from a small help window inside the game launcher. They see only their own thread, their own receipts and your replies.</p>
            <p>When the launcher retries a send, the message arrives once.</p>
          </section>
          <section id="security">
            <h2>Security</h2>
            <p>Player text is shown through a short allowlist, so a script tag or a script link is only ever harmless words. Link previews never reach the server's own network.</p>
            <p>Attachments are classified from their bytes and served only through Hushline, never from a bucket address.</p>
          </section>
        </div>
      </main>
      <footer className="footer">
        <div className="column">Fernwick Software. Hushline answers players from inside the game.</div>
      </footer>
    </>
  );
}
