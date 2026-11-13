import { Link } from '../ui/Link';
import { Sheet } from '../ui/Sheet';

function PostmarkRing() {
  return (
    <svg className="hero__postmark" viewBox="0 0 168 168" width="168" height="168" role="img" aria-label="Halfpenny Post · held until you're back">
      <circle cx="84" cy="84" r="79" fill="none" stroke="currentColor" strokeWidth="5" />
      <circle cx="84" cy="84" r="52" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path id="postmark-arc" d="M84 84 m-64 0 a64 64 0 1 1 128 0 a64 64 0 1 1 -128 0" fill="none" />
      <text fontSize="12.5" fontWeight="600" fill="currentColor">
        <textPath href="#postmark-arc" startOffset="0" textLength="392" lengthAdjust="spacing">
          Halfpenny Post · held until you&apos;re back
        </textPath>
      </text>
      <text x="84" y="94" textAnchor="middle" fontSize="28" fontWeight="600" fill="currentColor">
        Hp
      </text>
    </svg>
  );
}

export function Landing() {
  return (
    <div className="landing">
      <header className="landing__bar">
        <Link to="/" className="monogram" aria-label="Hp, Halfpenny Post Co.">
          Hp
        </Link>
        <nav className="landing__links" aria-label="Site">
          <a href="#how-sealing-works">How sealing works</a>
          <a href="#seal-numbers">Seal numbers</a>
          <Link to="/signin">Sign in</Link>
        </nav>
        <Link to="/signup" className="button button--ink">
          Choose a username
        </Link>
      </header>
      <main>
        <div className="hero">
          <div className="hero__sheet">
            <div className="hero__edge">
              <div className="hero__paper">
              <PostmarkRing />
              <h1 className="hero__title">
                <span className="hero__line hero__line--a">Letters that seal</span> <span className="hero__line hero__line--b">themselves</span>
              </h1>
              <ul className="hero__facts">
                <li>No phone number</li>
                <li>No email</li>
                <li>Sealed in your browser</li>
              </ul>
              <div className="hero__fold" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
        <Sheet className="story" id="how-sealing-works">
          <h2>How sealing works</h2>
          <p>
            Your identity key is made in this browser and never leaves it. Every letter, photo, file, display name and filename is sealed here before it is sent. The exchange only ever holds sealed bytes, and deletes its copy the moment your
            browser has collected them.
          </p>
        </Sheet>
        <Sheet className="story" id="seal-numbers">
          <h2>Seal numbers</h2>
          <p>
            Each pair of people shares one seal number, twelve groups of five digits. Compare it in person and mark the contact verified. If a contact&apos;s key ever changes, letters to them pause until you accept the new seal number.
          </p>
        </Sheet>
      </main>
      <footer className="flap">
        <p className="flap__name">Halfpenny Post Co.</p>
        <p className="flap__address">Return to sender: Packet Lane, Lisbon. No phone, no email, no forwarding.</p>
      </footer>
    </div>
  );
}
