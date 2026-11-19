import type { ReactNode } from "react";
import { Page } from "../components/Page.js";
import { Link } from "../router.js";
import { useKnownSession } from "../session.js";

export function NotFound(): ReactNode {
  const { state } = useKnownSession();
  return (
    <Page signedIn={state.status === "in"}>
      <h1>Not found</h1>
      <p className="muted">There is nothing here. It may not exist, or you may not have access to it.</p>
      <p>
        <Link to={state.status === "in" ? "/projects" : "/"} className="btn btn-lime">
          {state.status === "in" ? "Back to your jars" : "Back to the start"}
        </Link>
      </p>
    </Page>
  );
}
