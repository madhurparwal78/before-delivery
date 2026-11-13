import type { ReactNode } from "react";
import { errorCopy } from "../../shared/copy";
import { Link } from "../lib/router";

export function NotFound(): ReactNode {
  return (
    <main className="plain">
      <p className="title">Gatecut</p>
      <p>{errorCopy("not_found")}</p>
      <p>
        <Link to="/">Projects</Link>
      </p>
    </main>
  );
}
