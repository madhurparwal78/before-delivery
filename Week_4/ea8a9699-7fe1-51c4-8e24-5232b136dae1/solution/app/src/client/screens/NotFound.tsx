import { linkClick } from "../lib/router.js";
import { EmptyMark } from "../components/bits.js";

/** Any unknown address, and any workspace screen outside the viewer's reach (brief: Screens > Not found). */
export function NotFound() {
  return (
    <main className="not-found" id="main">
      <EmptyMark />
      <h1 className="page-title">This page does not exist.</h1>
      <p>
        <a href="/explore" onClick={(e) => linkClick(e, "/explore")}>
          Go to Explore
        </a>
      </p>
    </main>
  );
}
