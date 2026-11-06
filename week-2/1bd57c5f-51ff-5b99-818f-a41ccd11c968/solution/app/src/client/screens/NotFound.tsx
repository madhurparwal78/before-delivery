import { COPY } from "../copy";
import { followLink } from "../router";

export function NotFound() {
  return (
    <div className="page">
      <div className="notice">
        <h1>{COPY.notFound}</h1>
        <a href="/jobs" onClick={followLink}>
          {COPY.backToJobs}
        </a>
      </div>
    </div>
  );
}
