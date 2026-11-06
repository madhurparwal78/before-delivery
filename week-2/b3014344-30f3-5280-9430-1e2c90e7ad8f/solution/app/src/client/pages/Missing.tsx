import { Link } from "../lib/router";
import { COPY } from "../../shared/copy";
import { FoldMotif } from "./FoldMotif";

function Refusal({ heading, text }: { heading: string; text: string }) {
  return (
    <section className="refusal">
      <FoldMotif />
      <h1>{heading}</h1>
      <p className="lede">{text}</p>
      <p>
        <Link href="/" className="button button--secondary">
          Go to the home page
        </Link>
      </p>
    </section>
  );
}

export function NotFound() {
  return <Refusal heading={COPY.notFound} text="The address may be mistyped, or the page may have moved or been withdrawn." />;
}

export function AccessEnded() {
  return <Refusal heading={COPY.accessEnded} text="The studio closed this project, so its files are no longer shared with you." />;
}
