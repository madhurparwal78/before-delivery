import { useRef } from "preact/hooks";
import { FormProblems, PegStrip } from "../components/ui";

export function NotFound() {
  const summary = useRef<HTMLDivElement>(null);
  return (
    <div class="page narrow">
      <PegStrip />
      <FormProblems problems={[]} summaryRef={summary} />
      <h1>We couldn't find that page.</h1>
      <p class="lede">The record may belong to someone else, or the address may be mistyped.</p>
      <p>
        <a href="/">Back to the pegboard</a>
      </p>
    </div>
  );
}
