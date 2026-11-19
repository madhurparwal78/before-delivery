import { Link } from 'react-router-dom';
import '../landing/landing.css';

export default function Landing() {
  return (
    <div className="landing">
      <section className="landing-hero">
        <nav className="landing-bar" aria-label="Plainwork">
          <Link to="/" className="landing-monogram" aria-label="Plainwork">
            <span className="sr-only">Pw</span>
          </Link>
          <span className="landing-links">
            <Link to="/signin" className="landing-link">
              Sign in
            </Link>
            <Link to="/join" className="landing-link landing-join">
              Join
            </Link>
          </span>
        </nav>
        <main className="landing-main">
          <h1 className="landing-name" aria-label="Plainwork">
            <span aria-hidden="true" className="landing-line landing-line-first">
              Plain-
            </span>
            <span aria-hidden="true" className="landing-line landing-line-second">
              work
            </span>
          </h1>
        </main>
        <p className="landing-promise">Every rule, stated.</p>
      </section>
      <section className="landing-statements">
        <p className="statement statement-one">Your degree, in big type.</p>
        <p className="statement statement-two">Every job shows its stages.</p>
        <p className="statement statement-three">Block means gone.</p>
      </section>
    </div>
  );
}
