import { useApp } from '../app-context.js';

export const Landing = (): JSX.Element => {
  const { signedIn } = useApp();
  if (signedIn && typeof window !== 'undefined') {
    window.location.href = '/feed';
  }
  return (
    <>
      <section className="landing-hero">
        <div className="landing-top">
          <a href="/" className="monogram" aria-label="Plainwork">Pw</a>
          <div className="landing-links">
            <a href="/signin" className="text-button">Sign in</a>
            <a href="/join" className="text-button join-link">Join</a>
          </div>
        </div>
        <h1 className="landing-name">
          <span className="plain">Plain-</span>
          <span className="work">work</span>
        </h1>
        <p className="landing-promise">Every rule, stated.</p>
      </section>
      <section className="landing-statements">
        <p>Your degree, in big type.</p>
        <p>Every job shows its stages.</p>
        <p>Block means gone.</p>
      </section>
    </>
  );
};
