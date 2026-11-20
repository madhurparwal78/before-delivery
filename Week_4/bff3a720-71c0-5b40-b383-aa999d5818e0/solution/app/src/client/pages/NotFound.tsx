import type { ReactElement } from "react";
import { Link } from "../lib/router";
import { PageHeading } from "../ui/Bits";

export function NotFoundPage(): ReactElement {
  return (
    <div className="not-found">
      <PageHeading>We could not find that page</PageHeading>
      <p>
        <Link href="/search">Back to search</Link>
      </p>
    </div>
  );
}
