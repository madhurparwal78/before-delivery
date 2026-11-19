import { FernPrint, MothPrint } from "../ui/Prints";
import { Link } from "../ui/Link";

/** The signed-out landing page: two prints in darkness. */
export function Landing() {
  return (
    <main className="landing">
      <header className="landing-bar">
        <Link to="/" className="wordmark">MOTHLIGHT</Link>
        <nav aria-label="Browse" className="landing-links">
          <Link to="/">Feed</Link>
          <Link to="/boards">Boards</Link>
          <Link to="/search">Search</Link>
        </nav>
        <Link to="/signin" className="button button--primary">Save a pin</Link>
      </header>
      <div className="hero">
        <MothPrint className="hero-moth" />
        <FernPrint className="hero-fern" />
        <h1 className="hero-headline">
          Keep what you find.
          <br />
          Leave the rest in the dark.
        </h1>
        <p className="hero-sentence">Every pin keeps its source, its alt text and its credit.</p>
        <p className="hero-links">
          <Link to="/signin">Sign in</Link>
          <Link to="/signup">Sign up</Link>
        </p>
        <p className="closing">KEEP THE SOURCE. KEEP THE CREDIT.</p>
      </div>
    </main>
  );
}
