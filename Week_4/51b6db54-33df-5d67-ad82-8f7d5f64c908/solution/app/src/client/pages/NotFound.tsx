import type { JSX } from 'preact';
import { Shell } from './Shell';

export function NotFound(): JSX.Element {
  return (
    <Shell>
      <main class="narrow">
        <section class="card">
          <h1 class="page-title">Page not found</h1>
          <a class="pill" href="/" data-route>
            Back to Celmate
          </a>
        </section>
      </main>
    </Shell>
  );
}
