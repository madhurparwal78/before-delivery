import { copy } from '../../shared/copy.js';
import { PublicTopBar } from '../components/chrome.js';
import { Link } from '../components/layout.js';

export function NotFoundScreen() {
  return (
    <div class="screen">
      <PublicTopBar />
      <main class="screen__main screen__main--centred">
        <h1 class="heading heading--1">{copy.notFound}</h1>
        <Link href="/">Back to the rail</Link>
      </main>
    </div>
  );
}

export function GoneScreen({ heading }: { heading: string }) {
  return (
    <div class="screen">
      <PublicTopBar />
      <main class="screen__main screen__main--centred">
        <h1 class="heading heading--1">{heading}</h1>
        <Link href="/">Back to the rail</Link>
      </main>
    </div>
  );
}
