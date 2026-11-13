// The not-found page (brief: Screens and layout › Not found). The server answers these
// addresses with status 404; the page carries the published heading and a way back.

import { Link } from "../router.js";
import { EmptyMark } from "../components/ui.js";
import { COPY } from "../../shared/copy.js";

export function NotFound() {
  return (
    <div className="page not-found-page">
      <div className="museum-card not-found-card">
        <p className="catalogue">HRR-404</p>
        <EmptyMark />
        <h1>{COPY.notFoundHeading}</h1>
        <p className="lede">The room you asked for is closed, or it never opened.</p>
        <Link href="/" className="button button-primary">
          Back to the chapter index
        </Link>
      </div>
    </div>
  );
}
