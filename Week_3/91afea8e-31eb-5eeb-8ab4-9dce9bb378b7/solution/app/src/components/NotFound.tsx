import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTitle } from "../lib/hooks";
import { Empty } from "./Empty";

export function NotFound(): ReactNode {
  useTitle("nothing here");
  return (
    <Empty tone="black" sign="lost" as="h1" actions={<Link className="btn btn--yellow" to="/">back to the bazaar</Link>}>
      nothing here. wrong turn at the chauraha.
    </Empty>
  );
}
