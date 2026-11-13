import type { JSX } from "react";
import { s } from "../../common/copy";

export function NotFoundPage(): JSX.Element {
  return (
    <main className="main">
      <h1 className="lead">{s.notFound}</h1>
      <div className="panel">
        <p>{s.notFound}</p>
      </div>
    </main>
  );
}

