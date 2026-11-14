import type { ComponentChildren } from 'preact';
import { api } from '../api.js';
import { useApp } from '../app-context.js';

export const TRAINING_NOTICE = 'Training only. Fictional aerodromes. Not for real air traffic control.';

function Nav() {
  const { me, setMe, navigate } = useApp();
  if (!me) {
    return (
      <nav aria-label="Account" class="site-nav">
        <a href="/signin">Sign in</a>
        <a href="/signup">Create account</a>
      </nav>
    );
  }
  return (
    <nav aria-label="Account" class="site-nav">
      <a href="/">Your classes</a>
      <a href="/settings">Settings</a>
      <button
        type="button"
        class="link-button"
        onClick={async () => {
          await api('DELETE', '/api/session');
          setMe(null);
          navigate('/');
        }}
      >
        Sign out
      </button>
    </nav>
  );
}

export function Shell({ path, children }: { path: string; children: ComponentChildren }) {
  const { me } = useApp();
  const sessionPage = /^\/sessions\/[^/]+$/.test(path);
  const landing = path === '/' && !me;
  if (sessionPage) {
    return (
      <div class="page page-session">
        <main id="main" class="guides">
          {children}
        </main>
        <footer class="site-footer">
          <p class="notice">{TRAINING_NOTICE}</p>
          <a class="brand" href="/">
            Runup Bay
          </a>
          <Nav />
        </footer>
      </div>
    );
  }
  return (
    <div class={`page${landing ? ' page-landing' : ''}`}>
      <header class="site-header guides">
        <a class="brand" href="/">
          Runup Bay
        </a>
        <Nav />
      </header>
      <main id="main" class={landing ? '' : 'guides'}>
        {children}
      </main>
      <footer class="site-footer guides">
        <p class="notice">{TRAINING_NOTICE}</p>
      </footer>
    </div>
  );
}

export function NotFound() {
  return (
    <section class="cell">
      <h1>Not found.</h1>
      <p>
        <a href="/">Back to Runup Bay</a>
      </p>
    </section>
  );
}

export function Loading() {
  return <div class="loading-guides" aria-hidden="true" />;
}
