import type { JSX } from "preact";
import { EmptyState, Link } from "../components.js";

export function NotFound(): JSX.Element {
  return (
    <div class="page-narrow">
      <div class="page-head">
        <p class="kicker">Box office</p>
        <h1>We couldn't find that page</h1>
      </div>
      <EmptyState text="The page may have moved, or the performance or offer link is no longer valid.">
        <p><Link href="/" class="button quiet">Back to the programme</Link></p>
      </EmptyState>
    </div>
  );
}
